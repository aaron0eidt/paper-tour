/** Explicit real API smoke check. The required flag acknowledges use of configured ElevenLabs credits. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../src/config';
import { speechConfig } from '../src/speech/config';
import { SpeechProviders } from '../src/speech/providers';
if (!process.argv.includes('--elevenlabs')) throw new Error('Pass --elevenlabs to explicitly run real API generation.');
const config = speechConfig(),
  providers = new SpeechProviders(config);
if (!config.elevenlabsKey) throw new Error('Configure the server-only ELEVENLABS_API_KEY first.');
const folder = resolve(ROOT, '.data/tts-validation');
await mkdir(folder, { recursive: true });
const notes = [];
for (const [language, text] of [
  ['en-US', 'This paper explains how attention connects words in a sentence.'],
  ['de-DE', 'Dieses Paper erklärt, wie Aufmerksamkeit die Wörter in einem Satz miteinander verbindet.'],
]) {
  const start = performance.now();
  try {
    const audio = await providers.synthesize({
      provider: 'elevenlabs',
      text,
      language,
      model: 'eleven_multilingual_v2',
      voice: 'JBFqnCBsd6RMkjVDRZzb',
      apiKey: config.elevenlabsKey,
    });
    const bytes = Buffer.from(audio.audioBase64, 'base64'),
      path = resolve(folder, `elevenlabs-${language}.${audio.mimeType === 'audio/wav' ? 'wav' : 'mp3'}`);
    await writeFile(path, bytes);
    notes.push({
      provider: audio.provider,
      language,
      text,
      generationMs: Math.round(performance.now() - start),
      bytes: bytes.length,
      timing: audio.timing,
      wordTimesMs: audio.wordTimesMs,
      path,
    });
  } catch (error) {
    notes.push({ language, error: error instanceof Error ? error.message : 'Generation failed.' });
  }
}
await writeFile(
  resolve(folder, 'api-validation.json'),
  JSON.stringify({ date: new Date().toISOString(), notes }, null, 2),
);
console.log(JSON.stringify(notes, null, 2));
