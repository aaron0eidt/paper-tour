import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { SettingsService } from '../src/settings';
import { DocumentService, type Enqueue } from '../src/service';
import { createApp } from '../src/app';
import type { MuseConfig } from '../src/config';
import type { Config } from '../src/config';
import type { FileStorage } from '../src/storage';
import { AnalysisWorker, type PreparedAnalysis } from '../src/worker';
import { TourWorker } from '../src/tour-worker';
import type { TourGenerator } from '../src/tour-generator';

test('account settings keep credentials encrypted, isolated and out of API responses', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const db = new Database(process.env.TEST_DATABASE_URL!);
  const owner = randomUUID(), other = randomUUID();
  const keyA = `test-personal-A-${randomUUID()}-1111`, keyB = `test-personal-B-${randomUUID()}-2222`;
  const appKey = 'test-shared-app-key-3333';
  const seen: string[] = [];
  const base: MuseConfig = { apiKey: appKey, model: 'muse-spark-1.3', baseUrl: 'https://provider.invalid/v1', language: 'en-US', timeoutMs: 1000 };
  const transport: typeof fetch = async (_url, init) => {
    const key = new Headers(init?.headers).get('authorization')!.slice(7); seen.push(key);
    if (key.startsWith('invalid')) return new Response(key, { status: 401 });
    return Response.json({ data: (key === keyB ? ['muse-wonder-1.0'] : ['muse-spark-1.3', 'muse-wonder-1.0', 'muse-spark-1.3-contributor']).map((id) => ({ id })) });
  };
  const settings = new SettingsService(db, base, transport);
  const jobs: unknown[] = [];
  const enqueue: Enqueue = async (kind, data) => { jobs.push({ kind, ...data }); };
  const storage: FileStorage = { info: async () => ({ size: 8 }), download: async () => Buffer.from(''), upload: async () => {}, sign: async () => '', remove: async () => {}, list: async () => [] };
  const service = new DocumentService(db, storage, enqueue, 26214400, base.model, undefined, settings);
  const api = await createApp({ service, settings, authenticate: async (token) => token === 'owner' ? owner : token === 'other' ? other : null });
  const request = (method: 'GET' | 'PATCH' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: object, token = 'owner') => api.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  try {
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, `${owner}@example.test`, other, `${other}@example.test`]);
    await t.test('settings endpoints require an authenticated identity', async () => {
      for (const [method, url] of [['GET', '/api/settings'], ['PATCH', '/api/settings'], ['PUT', '/api/settings/meta-key'], ['DELETE', '/api/settings/meta-key'], ['POST', '/api/settings/test']] as const) {
        const response = await api.inject({ method, url, ...(method === 'PUT' ? { payload: { apiKey: keyA } } : method === 'PATCH' ? { payload: {} } : {}) });
        assert.equal(response.statusCode, 401);
      }
    });
    await t.test('defaults keep the current app connection explicit', async () => {
      const value = (await request('GET', '/api/settings')).json();
      assert.equal(value.credentialSource, 'app'); assert.equal(value.defaultModel, base.model);
      assert.equal(value.appKeyAvailable, true); assert.equal(value.personalKey.configured, false);
    });
    await t.test('saving a key verifies it and returns only its masked suffix', async () => {
      const response = await request('PUT', '/api/settings/meta-key', { apiKey: keyA });
      assert.equal(response.statusCode, 200, response.body);
      assert(!response.body.includes(keyA)); assert(!response.body.includes(appKey));
      assert.equal(response.json().personalKey.masked, '••••1111'); assert.equal(response.json().credentialSource, 'personal');
      const { rows: [row] } = await db.query('select s.secret_id,v.secret,v.decrypted_secret from user_settings s join vault.decrypted_secrets v on v.id=s.secret_id where s.owner_id=$1', [owner]);
      assert.equal(row.decrypted_secret, keyA); assert.notEqual(String(row.secret), keyA);
    });
    await t.test('the model catalog uses each account key and isolates its cache', async () => {
      await settings.saveKey(other, keyB);
      const a = await settings.models(owner), b = await settings.models(other);
      assert.equal(a.models.find((m) => m.id === 'muse-spark-1.3')?.available, true);
      assert.equal(b.models.find((m) => m.id === 'muse-spark-1.3')?.available, false);
      const before = seen.length; await settings.models(owner); await settings.models(other); assert.equal(seen.length, before);
      assert.equal((await settings.resolveMuse(owner)).config.apiKey, keyA);
      assert.equal((await settings.resolveMuse(other)).config.apiKey, keyB);
    });
    await t.test('profile model preferences persist and apply to new documents', async () => {
      const updated = await request('PATCH', '/api/settings', { defaultModel: 'muse-wonder-1.0' });
      assert.equal(updated.statusCode, 200); assert.equal(updated.json().defaultModel, 'muse-wonder-1.0');
      assert.equal((await settings.get(other)).defaultModel, base.model);
      const reserved = await service.reserve(owner, 'settings-test.pdf', 8);
      assert.equal((await db.query('select tour_model from documents where id=$1', [reserved.documentId])).rows[0].tour_model, 'muse-wonder-1.0');
      assert(!JSON.stringify(jobs).includes(keyA));
      assert.equal((await request('PATCH', '/api/settings', { owner_id: other })).statusCode, 400);
    });
    await t.test('saving a Contributor preference never grants request consent', async () => {
      assert.equal((await request('PATCH', '/api/settings', { defaultModel: 'muse-spark-1.3-contributor' })).statusCode, 200);
      await assert.rejects(service.reserve(owner, 'needs-consent.pdf', 8), (error: any) => error.code === 'contributor_training_consent_required');
      await settings.update(owner, { defaultModel: base.model });
    });
    await t.test('client roles cannot read Vault plaintext, call Vault functions or write settings directly', async () => {
      await db.transaction(async (tx) => {
        await tx.query('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
        assert.equal((await tx.query('select owner_id from user_settings')).rows.length, 1);
      });
      for (const sql of ['select decrypted_secret from vault.decrypted_secrets', "select vault.create_secret('do-not-store-this-test-value')", "update user_settings set default_model='bad'"]) {
        await assert.rejects(db.transaction(async (tx) => { await tx.query('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]); await tx.query(sql); }), (error: any) => error.code === '42501');
      }
      const foreign = (await request('GET', '/api/settings', undefined, 'other')).json();
      assert.equal(foreign.personalKey.masked, '••••2222'); assert(!JSON.stringify(foreign).includes(keyA));
    });
    await t.test('invalid replacements preserve the original credential and never echo the submitted key', async () => {
      const bad = 'invalid-personal-secret-4444';
      const response = await request('PUT', '/api/settings/meta-key', { apiKey: bad });
      assert.equal(response.statusCode, 400); assert(!response.body.includes(bad));
      assert.equal((await settings.resolveMuse(owner)).config.apiKey, keyA);
    });
    await t.test('workers resolve the document owner key and pause without downloading when it is removed', async () => {
      const reservation = await service.reserve(owner, 'owner-key.pdf', 8, { model: base.model });
      const { analysisId } = await service.complete(owner, reservation.documentId);
      const c = { muse: base } as Config;
      const prepared: PreparedAnalysis = {
        doc: { schema: 'paper-tour/doc@0.1', source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' }, pages: [{ n: 1, width: 600, height: 800 }], blocks: [], sentences: [], sections: [], figures: [], equations: [] },
        tour: null, sha: 'a'.repeat(64), folder: '', result: { parser_version: 'test', sha256: 'a'.repeat(64), page_count: 1, title: 'Owner key', status: 'ready', warnings: [], assets: [] },
      };
      await db.transaction((tx) => new AnalysisWorker(db, storage, c, enqueue).publish(tx, reservation.documentId, analysisId, prepared, []));
      let personalCalls = 0, preparations = 0;
      const fallback: TourGenerator = { model: base.model, configured: true, generate: async () => { throw new Error('Shared generator must not run'); } };
      const worker = new TourWorker(db, storage, c, fallback, async () => { preparations++; return []; }, async (actualOwner, model) => {
        assert.equal(actualOwner, owner);
        const resolved = await settings.resolveMuse(actualOwner, model);
        return { source: resolved.source, version: resolved.version, secret: resolved.config.apiKey, generator: {
          model, configured: Boolean(resolved.config.apiKey), generate: async () => {
            assert.equal(resolved.config.apiKey, keyA); personalCalls++;
            return { tour: { schema: 'paper-tour/tour@0.1', paper: reservation.documentId, title: 'Owner tour', doc_sha256: prepared.sha, chapters: [{ id: 'c', title: 'Page', steps: [{ id: 's', say: 'Page.', actions: [{ type: 'focus', target: 'page1' }] }] }] }, metadata: {} };
          },
        } };
      });
      const initial = (await db.query('select id from tour_generations where analysis_id=$1', [analysisId])).rows[0].id;
      await worker.generate(reservation.documentId, analysisId, initial);
      const complete = (await db.query('select status,metadata from tour_generations where id=$1', [initial])).rows[0];
      assert.equal(complete.status, 'ready'); assert.equal(complete.metadata.credentialSource, 'personal');
      assert(!JSON.stringify(complete).includes(keyA)); assert.equal(personalCalls, 1);
      const next = await service.generateTour(owner, reservation.documentId, true, { model: base.model });
      await settings.removeKey(owner);
      await worker.generate(reservation.documentId, analysisId, next.generation.id);
      assert.equal((await db.query('select status from tour_generations where id=$1', [next.generation.id])).rows[0].status, 'needs_configuration');
      assert.equal(personalCalls, 1); assert.equal(preparations, 1);
      await settings.saveKey(owner, keyA);
    });
    await t.test('replacing and removing a key erase its prior Vault entry and never fall back to the app key', async () => {
      const previous = (await db.query('select secret_id from user_settings where owner_id=$1', [owner])).rows[0].secret_id;
      await settings.saveKey(owner, keyB);
      assert.equal((await db.query('select id from vault.secrets where id=$1', [previous])).rowCount, 0);
      const current = (await db.query('select secret_id from user_settings where owner_id=$1', [owner])).rows[0].secret_id;
      assert.equal((await request('DELETE', '/api/settings/meta-key')).statusCode, 200);
      assert.equal((await db.query('select id from vault.secrets where id=$1', [current])).rowCount, 0);
      const resolved = await settings.resolveMuse(owner); assert.equal(resolved.config.apiKey, ''); assert.equal(resolved.source, 'personal');
      assert.equal((await settings.models(owner)).availability, 'not_configured');
      await settings.update(owner, { credentialSource: 'app' });
      assert.equal((await settings.resolveMuse(owner)).config.apiKey, appKey);
    });
    await t.test('account deletion removes its encrypted secret', async () => {
      const secret = (await db.query('select secret_id from user_settings where owner_id=$1', [other])).rows[0].secret_id;
      await db.query('delete from auth.users where id=$1', [other]);
      assert.equal((await db.query('select id from vault.secrets where id=$1', [secret])).rowCount, 0);
    });
  } finally { await api.close(); await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]); await db.close(); }
});
