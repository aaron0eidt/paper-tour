import type { SpeechAudio, SpeechInput, SpeechSettings } from '../../../shared/speech';
import { PreparedAudio } from './preparedAudio';
import {
  clamp,
  sentenceStarts,
  voiceRate,
  type Narrator,
  type SpeakRequest,
  type SpeakCallbacks,
  type NarrationHandle,
} from './narrator';

/** Bounded sentence groups keep first-audio latency bounded; global PDF word indexes stay intact. */
export function audioChunks(words: readonly string[], limit = 300): { text: string; start: number; count: number }[] {
  const starts = sentenceStarts(words),
    chunks: { text: string; start: number; count: number }[] = [];
  for (let sentence = 0; sentence < starts.length; sentence++) {
    const end = starts[sentence + 1] ?? words.length;
    let at = starts[sentence];
    while (at < end) {
      let next = at,
        length = 0;
      while (next < end && (next === at || length + words[next].length + 1 <= limit))
        length += words[next++].length + 1;
      const previous = chunks.at(-1),
        text = words.slice(at, next).join(' ');
      if (previous && previous.text.length < 80 && previous.text.length + text.length + 1 <= limit) {
        previous.text += ` ${text}`;
        previous.count += next - at;
      } else chunks.push({ text, start: at, count: next - at });
      at = next;
    }
  }
  return chunks;
}
export type SpeechTransport = (input: SpeechInput) => Promise<SpeechAudio>;
/** No generated text or keys in localStorage. Promise sharing prevents repeated charges on pause/resume. */
export class SpeechAudioCache {
  private readonly entries = new Map<string, SpeechAudio>();
  private readonly pending = new Map<string, Promise<SpeechAudio>>();
  private bytes = 0;
  constructor(readonly transport: SpeechTransport) {}
  has(input: SpeechInput): boolean {
    return this.entries.has(JSON.stringify(input));
  }
  get(input: SpeechInput): Promise<SpeechAudio> {
    const key = JSON.stringify(input),
      cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const run = this.transport(input)
      .then((audio) => {
        const size = audio.audioBase64.length;
        if (size <= 32 * 1024 * 1024) {
          while (this.bytes + size > 32 * 1024 * 1024 && this.entries.size) {
            const oldest = this.entries.keys().next().value!;
            this.bytes -= this.entries.get(oldest)!.audioBase64.length;
            this.entries.delete(oldest);
          }
          this.entries.set(key, audio);
          this.bytes += size;
        }
        return audio;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, run);
    return run;
  }
}
interface PreparedEntry {
  key: string;
  promise: Promise<PreparedAudio | undefined>;
  clip?: PreparedAudio;
  cancelled: boolean;
}
function disposeEntry(entry: PreparedEntry): void {
  entry.cancelled = true;
  entry.clip?.dispose();
}
export class ProviderNarrator implements Narrator {
  readonly name: string;
  readonly deferInitialCues = true;
  private readonly prefetched = new Set<string>();
  // One following chunk and, near a step boundary, the next step's opening clip.
  private readonly prepared = new Map<string, PreparedEntry>();
  constructor(
    readonly settings: SpeechSettings,
    readonly cache: SpeechAudioCache,
  ) {
    this.name = settings.preferences.provider;
  }
  private chunks(req: SpeakRequest) {
    return audioChunks(req.words);
  }
  async preload(req: SpeakRequest): Promise<void> {
    const chunk = this.chunks(req)[0];
    if (!chunk) return;
    await this.preloadInput({ text: chunk.text, language: req.voice?.lang ?? 'en-US', version: this.settings.version });
  }
  private entry(input: SpeechInput): PreparedEntry {
    const entry: PreparedEntry = { key: JSON.stringify(input), cancelled: false, promise: Promise.resolve(undefined) };
    entry.promise = this.cache.get(input).then((data) => {
      if (entry.cancelled) return;
      return entry.clip = new PreparedAudio(data);
    });
    return entry;
  }
  private take(input: SpeechInput): PreparedEntry {
    const key = JSON.stringify(input), ready = this.prepared.get(key);
    if (ready) { this.prepared.delete(key); return ready; }
    return this.entry(input);
  }
  private async preloadInput(input: SpeechInput): Promise<void> {
    const key = JSON.stringify(input);
    const pending = this.prepared.get(key);
    if (pending) { await pending.promise; return; }
    if (this.prefetched.has(key) && !this.cache.has(input)) return;
    if (this.prefetched.size >= 256) this.prefetched.delete(this.prefetched.values().next().value!);
    this.prefetched.add(key);
    while (this.prepared.size >= 2) {
      const oldest = this.prepared.keys().next().value!;
      disposeEntry(this.prepared.get(oldest)!);
      this.prepared.delete(oldest);
    }
    const entry = this.entry(input);
    this.prepared.set(key, entry);
    try { await entry.promise; }
    catch (error) {
      if (this.prepared.get(key) === entry) this.prepared.delete(key);
      throw error;
    }
  }
  dispose(): void {
    for (const entry of this.prepared.values()) disposeEntry(entry);
    this.prepared.clear();
  }

  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    const chunks = this.chunks(req),
      n = req.words.length;
    let rate = clamp(voiceRate(req), 0.5, 4),
      cancelled = false,
      finished = false,
      last = Math.max(0, req.startWord ?? 0) - 1;
    let element: HTMLAudioElement | undefined, current: PreparedEntry | undefined;
    let poll: ReturnType<typeof setInterval> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
    const language = req.voice?.lang ?? 'en-US';
    const clear = () => {
      clearInterval(poll);
      clearTimeout(watchdog);
      if (current) disposeEntry(current);
      current = undefined;
      element = undefined;
    };
    const emit = (word: number) => {
      if (!cancelled && !finished && word > last) {
        last = Math.min(word, n - 1);
        cb.onWord(last);
      }
    };
    const fail = (error: unknown) => {
      if (cancelled || finished) return;
      finished = true;
      clear();
      this.dispose();
      cb.onError?.(
        error instanceof Error
          ? error
          : new Error('Speech playback failed. Retry or choose another provider in Settings.'),
      );
    };
    const playChunk = async (index: number) => {
      if (cancelled || finished) return;
      if (index >= chunks.length) {
        finished = true;
        clear();
        cb.onEnd();
        return;
      }
      const chunk = chunks[index];
      try {
        current = this.take({ text: chunk.text, language, version: this.settings.version });
        if (!current.clip?.playable) cb.onState?.('generating');
        // Start current + one following chunk together; near a step boundary the reader
        // may also prime the next step. Nothing runs on provider selection or page load.
        const next = chunks[index + 1];
        if (next) void this.preloadInput({ text: next.text, language, version: this.settings.version }).catch(() => {});
        const clip = await current.promise;
        if (cancelled || finished || !clip) return;
        const audio = clip.data;
        const el = clip.element;
        element = el;
        el.playbackRate = rate;
        cb.onTiming?.(audio.timing);
        const given = audio.wordTimesMs?.length === chunk.count ? audio.wordTimesMs : undefined;
        const times = () =>
          given ??
          Array.from({ length: chunk.count }, (_, i) => i * ((audio.durationMs ?? el.duration * 1000) / chunk.count));
        const from = Math.min(chunk.count - 1, Math.max(0, (req.startWord ?? 0) - chunk.start));
        el.onended = () => {
          emit(chunk.start + chunk.count - 1);
          clear();
          void playChunk(index + 1);
        };
        el.onerror = () =>
          fail(new Error('The generated audio could not be played. Retry or choose another provider.'));
        await clip.ready;
        if (cancelled || finished || element !== el) return;
        if (from > 0) el.currentTime = times()[from] / 1000;
        watchdog = setTimeout(
          () => fail(new Error('Audio did not start. Retry the selected speech provider.')),
          20_000,
        );
        try { await el.play(); }
        catch { throw new Error('Audio playback was blocked. Press Play to retry and allow audio in this browser.'); }
        if (cancelled || finished || element !== el) return;
        clearTimeout(watchdog);
        cb.onState?.('playing');
        if (times()[from] <= el.currentTime * 1000) emit(chunk.start + from);
        let lastAudioTime = el.currentTime, progressedAt = Date.now();
        poll = setInterval(() => {
          const at = el.currentTime * 1000, offsets = times();
          if (el.currentTime > lastAudioTime) { lastAudioTime = el.currentTime; progressedAt = Date.now(); }
          else if (Date.now() - progressedAt > 15_000) { fail(new Error('Audio stopped progressing. Press Play to retry the selected voice.')); return; }
          let word = from - 1;
          while (word + 1 < chunk.count && offsets[word + 1] <= at) word++;
          emit(chunk.start + word);
        }, 40);
      } catch (error) {
        fail(error);
      }
    };
    const first = Math.max(
      0,
      chunks.findIndex((chunk) => chunk.start + chunk.count > (req.startWord ?? 0)),
    );
    void playChunk(first);
    return {
      cancel: () => {
        cancelled = true;
        clear();
        this.dispose();
      },
      setRate(value) {
        rate = clamp(value * (req.voice?.rate ?? 1), 0.5, 4);
        if (element) element.playbackRate = rate;
      },
    };
  }
}
