import type { SpeechAudio, SpeechInput, SpeechSettings } from '../../../shared/speech';
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
function audioUrl(audio: SpeechAudio): string {
  const bytes = Uint8Array.from(atob(audio.audioBase64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: audio.mimeType }));
}
export class ProviderNarrator implements Narrator {
  readonly name: string;
  private readonly prefetched = new Set<string>();
  constructor(
    readonly settings: SpeechSettings,
    readonly cache: SpeechAudioCache,
  ) {
    this.name = settings.preferences.provider;
  }
  async preload(req: SpeakRequest): Promise<void> {
    const chunk = audioChunks(req.words)[0];
    if (!chunk) return;
    await this.preloadInput({ text: chunk.text, language: req.voice?.lang ?? 'en-US', version: this.settings.version });
  }
  private async preloadInput(input: SpeechInput): Promise<void> {
    const key = JSON.stringify(input);
    if (this.prefetched.has(key)) return;
    if (this.prefetched.size >= 256) this.prefetched.delete(this.prefetched.values().next().value!);
    this.prefetched.add(key);
    // A failed background request waits for explicit foreground playback before retrying.
    await this.cache.get(input);
  }

  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    const chunks = audioChunks(req.words),
      n = req.words.length;
    let rate = clamp(voiceRate(req), 0.5, 4),
      cancelled = false,
      finished = false,
      last = Math.max(0, req.startWord ?? 0) - 1;
    let element: HTMLAudioElement | undefined, objectUrl: string | undefined;
    let poll: ReturnType<typeof setInterval> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
    const language = req.voice?.lang ?? 'en-US';
    const clear = () => {
      clearInterval(poll);
      clearTimeout(watchdog);
      if (element) {
        element.onended = element.onerror = element.onloadedmetadata = null;
        element.pause();
        element.removeAttribute('src');
        element.load();
        element = undefined;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = undefined;
      }
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
      cb.onState?.('generating');
      try {
        const current = this.cache.get({ text: chunk.text, language, version: this.settings.version });
        // Play explicitly authorizes only current + ONE following chunk. Start them together,
        // then roll forward one at a time; nothing runs on provider selection or page load.
        const next = chunks[index + 1];
        if (next) void this.preloadInput({ text: next.text, language, version: this.settings.version }).catch(() => {});
        const audio = await current;
        if (cancelled || finished) return;
        clear();
        objectUrl = audioUrl(audio);
        const el = new Audio(objectUrl);
        element = el;
        el.playbackRate = rate;
        cb.onTiming?.(audio.timing);
        const given = audio.wordTimesMs?.length === chunk.count ? audio.wordTimesMs : undefined;
        const times = () =>
          given ??
          Array.from({ length: chunk.count }, (_, i) => i * ((audio.durationMs ?? el.duration * 1000) / chunk.count));
        const from = Math.min(chunk.count - 1, Math.max(0, (req.startWord ?? 0) - chunk.start));
        let started = false;
        const ready = () => {
          if (started) return;
          started = true;
          if (cancelled || finished || element !== el) return;
          if (from > 0) el.currentTime = times()[from] / 1000;
          void el.play().then(
            () => {
              if (cancelled || finished || element !== el) return;
              cb.onState?.('playing');
              emit(chunk.start + from);
              poll = setInterval(() => {
                const at = el.currentTime * 1000,
                  offsets = times();
                let word = from;
                while (word + 1 < chunk.count && offsets[word + 1] <= at) word++;
                emit(chunk.start + word);
              }, 40);
            },
            () => fail(new Error('Audio playback was blocked. Press Play to retry and allow audio in this browser.')),
          );
        };
        el.onloadedmetadata = ready;
        el.onended = () => {
          emit(chunk.start + chunk.count - 1);
          clear();
          void playChunk(index + 1);
        };
        el.onerror = () =>
          fail(new Error('The generated audio could not be played. Retry or choose another provider.'));
        watchdog = setTimeout(
          () => fail(new Error('Audio did not become playable. Retry the selected speech provider.')),
          20_000,
        );
        el.addEventListener(
          'playing',
          () => {
            clearTimeout(watchdog);
          },
          { once: true },
        );
        if (el.readyState >= 1) ready();
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
      cancel() {
        cancelled = true;
        clear();
      },
      setRate(value) {
        rate = clamp(value * (req.voice?.rate ?? 1), 0.5, 4);
        if (element) element.playbackRate = rate;
      },
    };
  }
}
