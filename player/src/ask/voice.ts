import { useEffect, useRef, useState } from 'react';
import { encodeWav, VOICE_SECONDS } from '../../../shared/voice';
import { apiRequest, ApiRequestError } from '../library/client';
import type { AskSource } from './api';

export async function transcribeQuestion(source: AskSource, wav: Uint8Array, signal: AbortSignal): Promise<string> {
  const options: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array(wav),
    signal,
  };
  let result: { transcript: string };
  if ('documentId' in source)
    result = await apiRequest(`/api/documents/${encodeURIComponent(source.documentId)}/transcribe`, options);
  else {
    const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
    const response = await fetch(`${base}/api/demo/${encodeURIComponent(source.paper)}/transcribe`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiRequestError(
        data?.error?.message ?? 'Voice input needs the local API and a Meta connection.',
        response.status,
        'voice_unavailable',
      );
    result = data;
  }
  if (!result || typeof result.transcript !== 'string' || !result.transcript.trim() || result.transcript.length > 500)
    throw new Error('No usable transcript came back. Try a shorter question.');
  return result.transcript;
}

type Recording = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  cancelled: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
export function useVoiceInput(
  source: AskSource,
  callbacks: { onStart(): void; onCancel(): void; onTranscript(text: string): void },
) {
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Recording | null>(null),
    request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const available = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const cancel = () => {
    generation.current++;
    const r = current.current;
    current.current = null;
    if (r) {
      r.cancelled = true;
      clearTimeout(r.timer);
      if (r.recorder.state !== 'inactive') r.recorder.stop();
      r.stream.getTracks().forEach((t) => t.stop());
    }
    request.current?.abort();
    request.current = null;
    setPhase('idle');
    latest.current.onCancel();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const key = 'documentId' in source ? source.documentId : source.paper;
  useEffect(
    () => () => {
      cancelRef.current();
    },
    [key],
  );
  const stop = () => {
    const r = current.current;
    if (!r) {
      if (phase === 'permission') cancel();
      return;
    }
    clearTimeout(r.timer);
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    r.stream.getTracks().forEach((t) => t.stop());
  };
  const begin = async () => {
    if (!available || phase !== 'idle') return;
    const token = ++generation.current;
    setError(null);
    setPhase('permission');
    latest.current.onStart();
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (token !== generation.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      const r: Recording = { recorder, stream, chunks: [], cancelled: false };
      current.current = r;
      recorder.ondataavailable = (e) => {
        if (e.data.size) r.chunks.push(e.data);
      };
      recorder.onerror = () => {
        setError('Recording failed. Try again or type your question.');
        cancelRef.current();
      };
      recorder.onstop = async () => {
        current.current = null;
        clearTimeout(r.timer);
        r.stream.getTracks().forEach((t) => t.stop());
        if (r.cancelled || token !== generation.current) return;
        setPhase('transcribing');
        const controller = new AbortController();
        request.current = controller;
        let audio: AudioContext | null = null;
        try {
          audio = new AudioContext();
          const decoded = await audio.decodeAudioData(
            await new Blob(r.chunks, { type: recorder.mimeType }).arrayBuffer(),
          );
          if (token !== generation.current) return;
          const samples = new Float32Array(decoded.length);
          for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
            const channel = decoded.getChannelData(ch);
            for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / decoded.numberOfChannels;
          }
          const text = await transcribeQuestion(source, encodeWav(samples, decoded.sampleRate), controller.signal);
          if (token === generation.current) {
            setPhase('idle');
            latest.current.onTranscript(text);
          }
        } catch (e) {
          if (token === generation.current) {
            setPhase('idle');
            setError(e instanceof Error ? e.message : 'Transcription failed.');
            latest.current.onCancel();
          }
        } finally {
          await audio?.close().catch(() => {});
          if (request.current === controller) request.current = null;
        }
      };
      recorder.start();
      setPhase('recording');
      r.timer = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }, VOICE_SECONDS * 1000);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (token === generation.current) {
        setPhase('idle');
        setError('Microphone unavailable or permission denied. You can type your question.');
        latest.current.onCancel();
      }
    }
  };
  return { available, phase, error, begin, stop, cancel };
}
