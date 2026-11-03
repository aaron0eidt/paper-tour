/** Explicit live smoke check: local inference and optional configured ElevenLabs consume real resources. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../src/config';
import { speechConfig } from '../src/speech/config';
import { SpeechProviders } from '../src/speech/providers';
const config = speechConfig();
const providers = new SpeechProviders(config);
const folder = resolve(ROOT, '.data/tts-validation');
await mkdir(folder, { recursive: true });
const notes = [];
for (const provider of ['local', ...(process.argv.includes('--elevenlabs') ? ['elevenlabs'] : [])] as (
  | 'local'
  | 'elevenlabs'
)[]) {
  for (const [language, text] of [
    ['en-US', 'This paper explains how attention connects words in a sentence.'],
    ['de-DE', 'Dieses Paper erklärt, wie Aufmerksamkeit die Wörter in einem Satz miteinander verbindet.'],
  ]) {
    const start = performance.now();
    try {
      const audio = await providers.synthesize({
        provider,
        text,
        language,
        model: provider === 'local' ? config.localModel : 'eleven_multilingual_v2',
        voice: provider === 'local' ? 'Ryan' : 'JBFqnCBsd6RMkjVDRZzb',
        apiKey: provider === 'local' ? '' : config.elevenlabsKey,
      });
      const bytes = Buffer.from(audio.audioBase64, 'base64');
      const path = resolve(folder, `${provider}-${language}.${audio.mimeType === 'audio/wav' ? 'wav' : 'mp3'}`);
      await writeFile(path, bytes);
      notes.push({
        provider,
        language,
        text,
        generationMs: Math.round(performance.now() - start),
        durationMs: audio.durationMs,
        bytes: bytes.length,
        timing: audio.timing,
        wordTimesMs: audio.wordTimesMs,
        path,
      });
    } catch (error) {
      notes.push({ provider, language, error: error instanceof Error ? error.message : 'Generation failed.' });
    }
  }
}
await writeFile(resolve(folder, 'validation.json'), JSON.stringify({ date: new Date().toISOString(), notes }, null, 2));
console.log(JSON.stringify(notes, null, 2));
