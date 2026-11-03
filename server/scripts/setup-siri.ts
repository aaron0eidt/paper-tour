import { speechConfig } from '../src/speech/config';
import { SiriRuntime } from '../src/speech/siri';

const config = speechConfig().siri!;
const siri = new SiriRuntime({ ...config, allowInstall: true });
const voiceId = process.argv.find((value) => value.startsWith('--voice='))?.slice(8);
let last = '';
function report() {
  const status = siri.snapshot();
  const line = `${status.installed}/${status.total} voices · ${status.message}`;
  if (line !== last) { console.log(line); last = line; }
}
process.once('SIGINT', () => siri.pause());
process.once('SIGTERM', () => siri.pause());
try {
  siri.start(voiceId);
  report();
  const timer = setInterval(report, 1000);
  try { await siri.settled(); } finally { clearInterval(timer); report(); }
  const status = siri.snapshot();
  if (status.phase !== 'ready' && !(voiceId && status.voices.some((voice) => voice.id === voiceId && voice.installed))) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Siri setup failed.');
  process.exitCode = 1;
}
