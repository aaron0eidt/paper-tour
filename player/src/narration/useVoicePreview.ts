import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechAudio, SpeechProvider } from '../../../shared/speech';
import { apiRequest } from '../library/client';
import { browserSpeech, voiceId } from './voices';

export interface PreviewVoice {
  value: string;
  label: string;
  language?: string;
}
interface PreviewState {
  voice: string;
  label: string;
  index: number;
  total: number;
  phase: 'preparing' | 'playing';
}

/** Each comparison owns its abort signal, so a stopped request can never start playing late. */
export function useVoicePreview() {
  const controller = useRef<AbortController | undefined>(undefined);
  const [current, setCurrent] = useState<PreviewState | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = undefined;
    setCurrent(null);
  }, []);
  useEffect(() => () => controller.current?.abort(), []);

  const play = async (
    voices: readonly PreviewVoice[],
    provider: SpeechProvider,
    text: string,
    language: string,
    version: string,
    browserVoices: readonly SpeechSynthesisVoice[],
  ) => {
    stop();
    const run = new AbortController();
    controller.current = run;
    const { signal } = run;
    setError('');
    setNotice('');
    const failures: string[] = [];
    let played = 0;
    for (const [index, voice] of voices.entries()) {
      if (signal.aborted) return;
      setCurrent({
        voice: voice.value,
        label: voice.label,
        index: index + 1,
        total: voices.length,
        phase: 'preparing',
      });
      try {
        if (provider === 'browser') {
          const synth = browserSpeech(),
            selected = browserVoices.find((v) => voiceId(v) === voice.value);
          if (!synth || !selected) throw new Error('This browser voice is unavailable. Refresh the voice list.');
          await new Promise<void>((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = selected;
            utterance.lang = selected.lang;
            const cleanup = () => signal.removeEventListener('abort', cancel);
            const cancel = () => {
              cleanup();
              synth.cancel();
              reject(new DOMException('Preview stopped', 'AbortError'));
            };
            utterance.onstart = () => {
              if (!signal.aborted) setCurrent((value) => (value ? { ...value, phase: 'playing' } : null));
            };
            utterance.onend = () => {
              cleanup();
              resolve();
            };
            utterance.onerror = () => {
              cleanup();
              reject(new Error('The browser could not play this voice. Try another voice.'));
            };
            signal.addEventListener('abort', cancel, { once: true });
            synth.speak(utterance);
          });
        } else {
          const audio = await apiRequest<SpeechAudio>('/api/speech/preview', {
            method: 'POST',
            signal,
            body: JSON.stringify({ provider, voice: voice.value, text, language: voice.language ?? language, version }),
          });
          if (signal.aborted) return;
          const bytes = Uint8Array.from(atob(audio.audioBase64), (char) => char.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: audio.mimeType }));
          try {
            await new Promise<void>((resolve, reject) => {
              const element = new Audio(url);
              const cleanup = () => {
                signal.removeEventListener('abort', cancel);
                element.pause();
                element.onended = null;
                element.onerror = null;
              };
              const cancel = () => {
                cleanup();
                reject(new DOMException('Preview stopped', 'AbortError'));
              };
              element.onended = () => {
                cleanup();
                resolve();
              };
              element.onerror = () => {
                cleanup();
                reject(new Error('Audio playback failed. Retry this voice.'));
              };
              signal.addEventListener('abort', cancel, { once: true });
              void element
                .play()
                .then(() => {
                  if (!signal.aborted) setCurrent((value) => (value ? { ...value, phase: 'playing' } : null));
                })
                .catch(() => {
                  cleanup();
                  reject(new Error('Allow audio playback in this browser, then retry.'));
                });
            });
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        played++;
      } catch (cause) {
        if (signal.aborted) return;
        failures.push(`${voice.label}: ${cause instanceof Error ? cause.message : 'Preview failed.'}`);
      }
    }
    if (!signal.aborted) {
      controller.current = undefined;
      setCurrent(null);
      setError(failures.join(' '));
      setNotice(
        `${played} ${played === 1 ? 'voice' : 'voices'} played${failures.length ? ` · ${failures.length} could not be played` : ''}.`,
      );
    }
  };
  return { current, notice, error, play, stop };
}
