import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SiriSetupStatus, SiriVoice, SpeechAudio } from '../../../shared/speech';
import type { SiriConfig } from './config';
import { findSiriBinary, installSiriBinary, siriCommand, type SiriCommand } from './siri-install';
import { HttpError } from '../errors';

/** Native ranges and JavaScript string offsets both use UTF-16, including emoji. */
export function siriWordTimes(text: string, timings: unknown[], durationMs: number): number[] | undefined {
  const words = [...text.matchAll(/\S+/gu)];
  const valid = timings.filter((value): value is { start: number; utf16Location: number; utf16Length: number } => {
    if (!value || typeof value !== 'object') return false;
    const t = value as { start: number; utf16Location: number; utf16Length: number };
    return Number.isFinite(t.start) && t.start >= 0 && t.start * 1000 <= durationMs &&
      Number.isInteger(t.utf16Location) && t.utf16Location >= 0 && Number.isInteger(t.utf16Length) &&
      t.utf16Length > 0 && t.utf16Location + t.utf16Length <= text.length;
  });
  const times = words.map((word) => valid.find((t) => t.utf16Location < word.index! + word[0].length &&
    t.utf16Location + t.utf16Length > word.index!)?.start).map((time) => time === undefined ? undefined : time * 1000);
  if (!times.some((time) => time !== undefined)) return;
  for (let i = 0; i < times.length; i++) {
    if (times[i] !== undefined) continue;
    const from = i;
    while (i < times.length && times[i] === undefined) i++;
    const left = from ? times[from - 1]! : 0, right = times[i] ?? durationMs;
    for (let j = from; j < i; j++) times[j] = left + (right - left) * (j - from + Number(from > 0)) / (i - from + Number(from > 0));
  }
  let last = 0;
  return times.map((time) => (last = Math.max(last, Math.min(durationMs, Math.round(time!)))));
}

export class SiriRuntime {
  private binary?: string;
  private checkedAt = 0;
  private checking?: Promise<SiriSetupStatus>;
  private job?: Promise<void>;
  private controller?: AbortController;
  private queue: string[] = [];
  private active = 0;
  private unreadyExpressive = new Set<string>();
  private restored?: Promise<void>;
  private state: SiriSetupStatus;

  constructor(readonly config: SiriConfig, private readonly run: SiriCommand = siriCommand,
    private readonly install = installSiriBinary, machine = { platform: process.platform as string, arch: process.arch as string }) {
    const supported = machine.platform === 'darwin' && machine.arch === 'arm64';
    this.state = { supported, canInstall: supported && config.allowInstall, cliReady: false, running: false,
      phase: supported ? 'idle' : 'unsupported', message: supported ? 'Siri has not been set up on this Mac.' : 'Siri requires an Apple silicon Mac running the local server.',
      catalogComplete: false, installed: 0, total: 0, voices: [], failures: [] };
  }

  snapshot(): SiriSetupStatus { return structuredClone(this.state); }
  private restore() {
    return this.restored ??= (async () => {
      try {
        const saved = JSON.parse(await readFile(join(this.config.dataDir, 'setup.json'), 'utf8'));
        for (const failure of Array.isArray(saved.failures) ? saved.failures : [])
          if (typeof failure?.id === 'string' && failure.id.includes(':fmvoice:')) this.unreadyExpressive.add(failure.id);
      } catch { /* A fresh install has no saved verification results. */ }
    })();
  }
  private async save() {
    try {
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      const file = join(this.config.dataDir, 'setup.json');
      await writeFile(`${file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    } catch { /* Native installed inventory remains authoritative if the progress file cannot be written. */ }
  }
  private async inventory(signal?: AbortSignal) {
    if (!this.binary) return;
    const result = JSON.parse((await this.run(this.binary, ['voices', '--available', '--json'], { signal, timeout: 30_000 })).stdout);
    if (!Array.isArray(result.voices)) throw new Error('Siri returned no voice catalog. Retry setup.');
    const seen = new Set<string>();
    this.state.voices = result.voices.filter((v: Record<string, unknown>) => v && v.engine === 'siri' &&
      typeof v.assetKey === 'string' && typeof v.name === 'string' && typeof v.language === 'string')
      .map((v: { assetKey: string; name: string; language: string; installed: boolean }): SiriVoice => ({
        id: v.assetKey, name: v.name, language: v.language, installed: v.installed === true && !this.unreadyExpressive.has(v.assetKey),
        generation: v.assetKey.includes(':fmvoice:') ? 'expressive' : 'legacy',
      })).filter((v: SiriVoice) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
    this.state.total = this.state.voices.length;
    this.state.installed = this.state.voices.filter((v) => v.installed).length;
    this.state.catalogComplete = result.catalogScope === 'available';
    this.checkedAt = Date.now();
  }
  async status(refresh = false): Promise<SiriSetupStatus> {
    if (!this.state.supported || this.state.running || (!refresh && Date.now() - this.checkedAt < 30_000)) return this.snapshot();
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        await this.restore();
        this.binary ??= await findSiriBinary(this.config, this.run);
        this.state.cliReady = !!this.binary;
        if (this.binary) {
          await this.inventory();
          this.state.phase = this.state.catalogComplete && this.state.installed === this.state.total && this.state.total ? 'ready' : 'partial';
          this.state.message = this.state.catalogComplete ? `${this.state.installed} of ${this.state.total} Siri voices installed.` : 'Apple exposed installed voices only. The full downloadable catalog could not be verified.';
        }
      } catch { this.state.phase = 'error'; this.state.message = 'Siri could not be reached. Retry setup on this Mac.'; }
      this.checkedAt = Date.now();
      return this.snapshot();
    })().finally(() => { this.checking = undefined; });
    return this.checking;
  }

  start(voiceId?: string): SiriSetupStatus {
    if (!this.state.canInstall) throw new HttpError(403, 'siri_setup_unavailable', 'Siri setup must run locally on an Apple silicon Mac.');
    if (this.job) {
      if (voiceId) {
        const voice = this.state.voices.find((v) => v.id === voiceId);
        const priority = voice?.generation === 'expressive' ? this.state.voices.filter((v) => v.generation === 'legacy' && v.language === voice.language && !v.installed).map((v) => v.id) : [voiceId];
        this.queue = [...priority, ...this.queue.filter((id) => !priority.includes(id))];
      }
      return this.snapshot();
    }
    const controller = new AbortController();
    this.controller = controller;
    this.state.running = true;
    this.state.failures = [];
    this.state.phase = 'discovering';
    this.state.message = 'Checking Siri and installed voices…';
    this.job = this.setup(controller.signal, voiceId).catch((error) => {
      this.state.phase = controller.signal.aborted ? 'paused' : 'error';
      this.state.message = controller.signal.aborted ? 'Setup paused. macOS may finish downloads already requested.' :
        error instanceof Error && error.message.startsWith('Apple developer tools') ? error.message :
        error instanceof Error && /helper could not be built|compatibility update|different version|another Paper Tour process/.test(error.message) ? error.message : 'Siri setup could not finish. Check the network and Apple developer tools, then retry.';
    }).finally(async () => {
      this.state.running = false;
      delete this.state.currentVoice;
      await this.save();
      this.job = undefined;
      this.controller = undefined;
    });
    return this.snapshot();
  }
  pause() { this.controller?.abort(); return this.snapshot(); }
  async settled() { await this.job; }
  async close() { this.pause(); await this.settled(); }

  private async setup(signal: AbortSignal, voiceId?: string) {
    // Finish a read-only discovery already in progress before updating the same inventory.
    await this.checking;
    await this.restore();
    this.binary ??= await findSiriBinary(this.config, this.run);
    if (!this.binary) {
      this.state.phase = 'installing'; this.state.message = 'Installing the local Siri helper. This can take several minutes…';
      this.binary = await this.install(this.config, signal, this.run);
    }
    this.state.cliReady = true;
    await this.inventory(signal);
    if (voiceId && !this.state.voices.some((v) => v.id === voiceId)) throw new Error('Voice is not in the Apple catalog.');
    const selected = this.state.voices.find((v) => v.id === voiceId);
    this.queue = selected?.generation === 'expressive' ? this.state.voices.filter((v) =>
      v.generation === 'legacy' && v.language === selected.language && !v.installed).map((v) => v.id) :
      voiceId ? [voiceId] : this.state.voices.filter((v) => !v.installed && v.generation === 'legacy')
        .sort((a, b) => {
          const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
          const score = (v: SiriVoice) => v.language.toLowerCase() === locale ? 3 : v.language.split('-')[0] === locale.split('-')[0] ? 2 : v.language === 'en-US' ? 1 : 0;
          return score(b) - score(a) || a.language.localeCompare(b.language);
        }).map((v) => v.id);
    while (this.queue.length) {
      signal.throwIfAborted();
      const id = this.queue.shift()!;
      const voice = this.state.voices.find((v) => v.id === id);
      if (!voice || voice.installed) continue;
      this.state.phase = 'downloading'; this.state.currentVoice = `${voice.name} (${voice.language})`;
      this.state.message = `Downloading ${this.state.currentVoice}…`;
      await this.save();
      try {
        const result = JSON.parse((await this.run(this.binary, ['voices', '--install', id, '--wait', '--timeout', '300', '--json'], { signal, timeout: 315_000 })).stdout);
        if (result.state !== 'installed') throw new Error('Not installed');
        voice.installed = true;
        this.state.installed = this.state.voices.filter((v) => v.installed).length;
      } catch {
        signal.throwIfAborted();
        this.state.failures.push({ id, name: voice.name, message: 'macOS has not confirmed this voice. Retry to check or request it again.' });
      }
    }
    await this.inventory(signal);
    // Expressive presets share language resources. Apple can list them before those resources work.
    for (const voice of this.state.voices.filter((v) => v.generation === 'expressive' && (!voiceId || v.id === voiceId))) {
      signal.throwIfAborted();
      this.state.currentVoice = `${voice.name} (${voice.language})`;
      this.state.message = `Checking ${this.state.currentVoice}…`;
      try {
        const report = JSON.parse((await this.run(this.binary, ['capabilities', '--voice', voice.id, '--generation', 'expressive', '--probe', '--json'], { signal, timeout: 60_000 })).stdout);
        voice.installed = ['verified', 'audio-only'].includes(report.voices?.[0]?.readiness);
      } catch { signal.throwIfAborted(); voice.installed = false; }
      if (voice.installed) this.unreadyExpressive.delete(voice.id);
      else {
        this.unreadyExpressive.add(voice.id);
        this.state.failures.push({ id: voice.id, name: voice.name, message: 'The expressive voice could not be verified. Retry after its language resources finish downloading.' });
      }
    }
    this.state.installed = this.state.voices.filter((v) => v.installed).length;
    const doctor = JSON.parse((await this.run(this.binary, ['doctor', '--json'], { signal, timeout: 60_000 })).stdout);
    if (doctor.probe?.succeeded !== true || doctor.probe?.nonSilent !== true) throw new Error('The native synthesis probe failed.');
    this.state.phase = this.state.catalogComplete && this.state.installed === this.state.total && this.state.total ? 'ready' : 'partial';
    this.state.message = !this.state.catalogComplete ? 'Installed voices are ready. Apple did not expose the full downloadable catalog; all voices could not be verified.' :
      this.state.phase === 'ready' ? `All ${this.state.total} Siri voices are installed. Speech is ready.` :
      `${this.state.installed} of ${this.state.total} voices installed. Available voices can already be used. Retry to finish missing downloads.`;
    await this.save();
  }

  async synthesize(text: string, language: string, requested: string, signal?: AbortSignal): Promise<Omit<SpeechAudio, 'cached'>> {
    await this.status();
    if (!this.binary) throw new HttpError(503, 'siri_setup_required', 'Set up Siri voices in Audio settings before playing.');
    const candidates = this.state.voices.filter((v) => v.installed);
    const normalized = language.toLowerCase().replace('_', '-');
    const voice = requested === 'auto' ? candidates.filter((v) => v.language.toLowerCase().split('-')[0] === normalized.split('-')[0])
      .sort((a, b) => Number(b.language.toLowerCase() === normalized) - Number(a.language.toLowerCase() === normalized) ||
        Number(a.generation === 'expressive') - Number(b.generation === 'expressive') || a.name.localeCompare(b.name))[0] : candidates.find((v) => v.id === requested);
    if (!voice) throw new HttpError(409, 'siri_voice_missing', 'This Siri voice is not installed. Download it in Audio settings, or choose an installed voice.');
    if (this.active >= 2) throw new HttpError(429, 'speech_busy', 'Siri is preparing audio. Retry in a moment.');
    const folder = await mkdtemp(join(tmpdir(), 'paper-tour-siri-'));
    this.active++;
    try {
      const input = join(folder, 'input.txt'), output = join(folder, 'speech.wav');
      await writeFile(input, text, 'utf8');
      const result = JSON.parse((await this.run(this.binary, ['synthesize', '--engine', 'siri', '--generation', voice.generation,
        '--voice', voice.id, '--format', 'wav', '--input-file', input, '--output', output, '--json'], { signal, timeout: 60_000 })).stdout);
      const durationMs = result.audio?.durationSeconds * 1000;
      if (!result.audio?.nonSilent || !Number.isFinite(durationMs) || durationMs <= 0 || (await stat(output)).size > 24 * 1024 * 1024) throw new Error('Unusable audio');
      const audio = await readFile(output);
      if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not WAV');
      const wordTimesMs = result.timingsSupported && Array.isArray(result.timings) ? siriWordTimes(text, result.timings, durationMs) : undefined;
      return { provider: 'siri', model: voice.generation, voice: voice.id, audioBase64: audio.toString('base64'),
        mimeType: 'audio/wav', durationMs, wordTimesMs, timing: wordTimesMs ? 'provider' : 'estimated' };
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw new HttpError(503, 'siri_unavailable', 'Siri could not generate audio. Retry, or check Siri setup in Audio settings. No other provider was used.');
    } finally { this.active--; await rm(folder, { recursive: true, force: true }); }
  }
}
