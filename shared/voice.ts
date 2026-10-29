/** Browser-to-server audio format: mono PCM16 WAV at 16 kHz. */
export const VOICE_RATE = 16000;
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid audio rate.');
  const count = Math.floor((samples.length * VOICE_RATE) / sampleRate);
  const bytes = new Uint8Array(44 + count * 2),
    view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_RATE, true);
  view.setUint32(28, VOICE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * sampleRate) / VOICE_RATE),
      to = Math.max(from + 1, Math.floor(((i + 1) * sampleRate) / VOICE_RATE));
    let sum = 0;
    for (let j = from; j < to; j++) sum += Number.isFinite(samples[j]) ? samples[j] : 0;
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function validWav(bytes: Uint8Array): boolean {
  if (bytes.length <= 44 || bytes.length % 2) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n));
  return (
    text(0, 4) === 'RIFF' &&
    text(8, 4) === 'WAVE' &&
    text(12, 4) === 'fmt ' &&
    text(36, 4) === 'data' &&
    v.getUint32(4, true) === bytes.length - 8 &&
    v.getUint32(16, true) === 16 &&
    v.getUint16(20, true) === 1 &&
    v.getUint16(22, true) === 1 &&
    v.getUint32(24, true) === VOICE_RATE &&
    v.getUint32(28, true) === VOICE_RATE * 2 &&
    v.getUint16(32, true) === 2 &&
    v.getUint16(34, true) === 16 &&
    v.getUint32(40, true) === bytes.length - 44
  );
}
