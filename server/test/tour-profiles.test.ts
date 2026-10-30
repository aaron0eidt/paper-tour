import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BUILTIN_TOUR_PROFILES,
  profileSnapshot,
  sameTourProfile,
  tourProfileGuidance,
} from '../../shared/tourProfiles';
import type { TourProfileDraft, TourProfileSnapshot } from '../../shared/tourProfiles';
import type { Doc, Tour } from '../../shared/paper';
import { TourProfileStore, profileDraft } from '../src/tour-profiles';
import { Database } from '../src/db';
import { createApp } from '../src/app';
import { DocumentService, type Library } from '../src/service';
import { HttpError } from '../src/errors';
import { AnalysisWorker, type PreparedAnalysis } from '../src/worker';
import { TourWorker } from '../src/tour-worker';
import type { Config } from '../src/config';
import type { FileStorage } from '../src/storage';

const draft: TourProfileDraft = {
  name: 'Methods seminar',
  structure: 'paper',
  instructions: 'Explain assumptions before interpreting evidence.',
  depth: 'deep',
  audience: 'expert',
};
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;

test('profile snapshots keep depth independent from structure and do not change builtins', () => {
  const original = BUILTIN_TOUR_PROFILES[0];
  const snapshot = profileSnapshot(original, { depth: 'deep', audience: 'general' });
  assert.equal(snapshot.structure, 'concepts');
  assert.equal(snapshot.depth, 'deep');
  assert.equal(original.depth, 'standard');
  snapshot.instructions = 'Changed local copy';
  assert.equal(original.instructions, '');
  assert.equal(tourProfileGuidance(profileSnapshot(original)), '');
  assert.match(tourProfileGuidance(profileSnapshot(BUILTIN_TOUR_PROFILES[2])), /original order/);
  assert.match(tourProfileGuidance({ ...snapshot, structure: 'paper', instructions: '' }), /original order/);
  assert(sameTourProfile(profileSnapshot(original), { ...original }));
  assert(!sameTourProfile(snapshot, original));
  assert(!sameTourProfile(null, original));
  assert.deepEqual(profileDraft({ ...draft, name: '  Methods seminar  ' }), draft);
  for (const invalid of [
    { ...draft, name: ' ' },
    { ...draft, instructions: 'x'.repeat(6001) },
    { ...draft, depth: 'unlimited' },
  ])
    assert.throws(() => profileDraft(invalid as TourProfileDraft), status(400));
});

test('tour-profile APIs authenticate, validate and forward only the verified owner and explicit selection', async () => {
  const id = randomUUID();
  const calls: unknown[] = [];
  const value = { ...draft, id, revision: 1, builtin: false };
  const service = {
    tourProfiles: async (owner: string) => {
      calls.push(owner);
      return { profiles: [value], defaultDepth: 'standard' };
    },
    createTourProfile: async (owner: string, input: TourProfileDraft) => {
      calls.push({ owner, input });
      return value;
    },
    reviseTourProfile: async (owner: string, profile: string, revision: number, input: TourProfileDraft) => {
      calls.push({ owner, profile, revision, input });
      return { ...value, revision: revision + 1 };
    },
    generateTour: async (...args: unknown[]) => {
      calls.push(args);
      return { generation: { profile: value } };
    },
  } as unknown as Library;
  const app = await createApp({
    service,
    authenticate: async (token) => (token === 'valid' ? 'verified-owner' : null),
  });
  const headers = { authorization: 'Bearer valid' };
  try {
    for (const [method, url, payload] of [
      ['GET', '/api/tour-profiles', undefined],
      ['POST', '/api/tour-profiles', draft],
      ['PUT', `/api/tour-profiles/${id}`, { ...draft, expectedRevision: 1 }],
    ] as const) {
      assert.equal((await app.inject({ method, url, payload })).statusCode, 401);
    }
    assert.equal((await app.inject({ headers, url: '/api/tour-profiles' })).statusCode, 200);
    assert.equal(calls.pop(), 'verified-owner');
    assert.equal(
      (await app.inject({ headers, method: 'POST', url: '/api/tour-profiles', payload: draft })).statusCode,
      201,
    );
    assert.deepEqual(calls.pop(), { owner: 'verified-owner', input: draft });
    assert.equal(
      (
        await app.inject({
          headers,
          method: 'PUT',
          url: `/api/tour-profiles/${id}`,
          payload: { ...draft, expectedRevision: 1 },
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(calls.pop(), { owner: 'verified-owner', profile: id, revision: 1, input: draft });
    const selection = {
      profileId: id,
      profileRevision: 1,
      depth: 'quick',
      audience: 'general',
      model: 'chosen-model',
      allowTraining: false,
    };
    assert.equal(
      (
        await app.inject({
          headers,
          method: 'POST',
          url: `/api/documents/${id}/tours`,
          payload: { ...selection, regenerate: true },
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(calls.pop(), ['verified-owner', id, true, selection]);
    for (const payload of [
      { ...draft, owner_id: 'foreign' },
      { ...draft, depth: 'unlimited' },
      { ...draft, structure: 'invented' },
      { ...draft, audience: 'child' },
      { ...draft, instructions: 'x'.repeat(6001) },
    ])
      assert.equal((await app.inject({ headers, method: 'POST', url: '/api/tour-profiles', payload })).statusCode, 400);
    for (const payload of [{ profileRevision: 0 }, { depth: 'unlimited' }, { audience: 'child' }])
      assert.equal(
        (await app.inject({ headers, method: 'POST', url: `/api/documents/${id}/tours`, payload })).statusCode,
        400,
      );
  } finally {
    await app.close();
  }
});

test(
  'profiles isolate owners, retain revisions and pin effective snapshots through publication',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    const owner = randomUUID(),
      other = randomUUID();
    const store = new TourProfileStore(db, 'quick');
    const enqueue = async () => {};
    const storage: FileStorage = {
      info: async () => ({ size: 8 }),
      download: async () => Buffer.from(''),
      upload: async () => {},
      sign: async () => '',
      remove: async () => {},
      list: async () => [],
    };
    const config = {
      muse: {
        apiKey: 'test-only',
        baseUrl: 'https://never-called.invalid',
        model: 'test-model',
        language: 'en-US',
        timeoutMs: 1000,
      },
    } as Config;
    const service = new DocumentService(db, storage, enqueue, 26214400, 'test-model');
    const doc: Doc = {
      schema: 'paper-tour/doc@0.1',
      source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
      pages: [{ n: 1, width: 600, height: 800 }],
      blocks: [],
      sentences: [],
      sections: [],
      figures: [],
      equations: [],
    };
    const tour: Tour = {
      schema: 'paper-tour/tour@0.1',
      title: 'Profile test',
      paper: 'test',
      doc_sha256: doc.source.sha256,
      chapters: [
        {
          id: 'intro',
          title: 'Introduction',
          steps: [{ id: 'hello', say: 'A sourced explanation.', actions: [{ type: 'focus', target: 'page1' }] }],
        },
      ],
    };
    const prepared: PreparedAnalysis = {
      doc,
      tour,
      sha: doc.source.sha256,
      folder: '',
      result: {
        parser_version: 'test',
        sha256: doc.source.sha256,
        page_count: 1,
        title: 'Profile test',
        status: 'ready',
        warnings: [],
        assets: [],
      },
    };
    try {
      await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
        owner,
        `${owner}@example.test`,
        other,
        `${other}@example.test`,
      ]);
      const first = await store.create(owner, draft);
      const foreign = await store.create(other, { ...draft, name: 'Foreign' });
      await t.test('owner filtering, historic revision resolution and optimistic edits', async () => {
        const initial = (await store.list(owner)).profiles;
        assert(initial.some((p) => p.id === first.id));
        assert(!initial.some((p) => p.id === foreign.id));
        assert.equal((await store.resolve(owner)).depth, 'quick');
        assert.equal((await store.resolve(owner, { profileId: first.id })).depth, 'deep');
        await assert.rejects(store.resolve(other, { profileId: first.id }), status(404));
        await assert.rejects(store.revise(other, first.id, 1, draft), status(404));
        await assert.rejects(store.resolve(owner, { profileId: first.id, profileRevision: 0 }), status(400));
        const second = await store.revise(owner, first.id, 1, {
          ...draft,
          name: 'Updated seminar',
          instructions: 'New teaching notes.',
        });
        assert.equal(second.revision, 2);
        await assert.rejects(store.revise(owner, first.id, 1, draft), status(409));
        assert.equal(
          (await store.resolve(owner, { profileId: first.id, profileRevision: 1 })).instructions,
          draft.instructions,
        );
        assert.equal((await store.resolve(owner, { profileId: first.id })).instructions, 'New teaching notes.');
      });
      await t.test('database roles can read their own revisions but cannot mutate profiles directly', async () => {
        await db.transaction(async (tx) => {
          await tx.query('set local role authenticated');
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
          assert.deepEqual(
            (await tx.query('select id from tour_profiles')).rows.map((r) => r.id),
            [first.id],
          );
          assert.equal((await tx.query('select * from tour_profile_revisions')).rowCount, 2);
        });
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query('update tour_profiles set current_revision=99');
          }),
          (error: any) => error.code === '42501',
        );
      });
      await t.test(
        'generation snapshots survive profile edits, model selection stays independent, and saved metadata describes the actual run',
        async () => {
          const reserved = await service.reserve(owner, 'profile.pdf', 8);
          const { analysisId } = await service.complete(owner, reserved.documentId);
          await db.transaction((tx) =>
            new AnalysisWorker(db, storage, config, enqueue).publish(tx, reserved.documentId, analysisId, prepared, []),
          );
          const selection = {
            profileId: first.id,
            profileRevision: 1,
            depth: 'quick' as const,
            audience: 'general' as const,
          };
          const requested = await service.generateTour(owner, reserved.documentId, true, selection);
          const pinned = requested.generation.profile!;
          assert.equal(requested.generation.model, 'test-model');
          assert.equal(pinned.revision, 1);
          assert.equal(pinned.depth, 'quick');
          assert.equal(pinned.audience, 'general');
          await store.revise(owner, first.id, 2, { ...draft, name: 'Latest seminar' });
          assert.equal((await service.generateTour(owner, reserved.documentId)).generation.id, requested.generation.id);
          await assert.rejects(
            service.generateTour(owner, reserved.documentId, true, { profileId: first.id }),
            status(409),
          );
          await assert.rejects(
            service.generateTour(owner, reserved.documentId, true, { profileId: foreign.id }),
            status(404),
          );
          await db.query("update tour_generations set status='failed' where id=$1", [requested.generation.id]);
          const retry = await service.generateTour(owner, reserved.documentId);
          assert.equal(retry.generation.id, requested.generation.id);
          assert.deepEqual(retry.generation.profile, pinned);
          let received: TourProfileSnapshot | undefined;
          const worker = new TourWorker(
            db,
            storage,
            config,
            {
              model: 'test-model',
              configured: true,
              generate: async (input) => {
                received = input.profile;
                return { tour, metadata: {} };
              },
            },
            async () => [
              { targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
            ],
          );
          await worker.generate(reserved.documentId, analysisId, requested.generation.id);
          assert.deepEqual(received, pinned);
          const saved = (
            await db.query('select status,profile,metadata from tour_generations where id=$1', [
              requested.generation.id,
            ])
          ).rows[0];
          assert.equal(saved.status, 'ready');
          assert.deepEqual(saved.profile, pinned);
          assert.deepEqual(saved.metadata.profile, pinned);
          const manifest = await service.manifest(owner, reserved.documentId);
          assert.deepEqual(
            manifest.tours?.find((value) => value.id === manifest.tourGeneration?.tourId)?.profile,
            pinned,
          );
          await assert.rejects(
            service.generateTour(owner, reserved.documentId, false, { profileId: first.id }),
            status(409),
          );
          const next = await service.generateTour(owner, reserved.documentId, true, { profileId: first.id });
          assert.equal(next.generation.profile?.revision, 3);
          assert.equal(next.generation.profile?.depth, 'deep');
          await db.query("update tour_generations set status='failed' where id=$1", [next.generation.id]);
          const changed = await service.generateTour(owner, reserved.documentId, true, {
            profileId: 'overview',
            depth: 'standard',
          });
          assert.notEqual(changed.generation.id, next.generation.id);
          assert.deepEqual(
            (await db.query('select profile from tour_generations where id=$1', [next.generation.id])).rows[0].profile,
            next.generation.profile,
          );
          assert.deepEqual(
            (await db.query('select profile from tour_generations where id=$1', [requested.generation.id])).rows[0]
              .profile,
            pinned,
          );
        },
      );
    } finally {
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
    }
  },
);
