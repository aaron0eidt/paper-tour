#!/usr/bin/env python3
"""Small loopback-only Qwen3-TTS bridge. Reuses an installed MLX-Audio/model; never downloads implicitly.

Example (existing oMLX runtime):
  ~/.omlx/bin/omlx-python scripts/local-tts.py
Otherwise install mlx-audio into a project venv and pass --model-path to a downloaded CustomVoice checkpoint.
"""
import argparse
import io
import json
import logging
from pathlib import Path
import time
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model-path', type=Path, default=Path.home() / '.omlx/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice')
parser.add_argument('--port', type=int, default=8045)
args = parser.parse_args()
if not (args.model_path / 'config.json').is_file():
    parser.error('CustomVoice model not found. Pass --model-path to a local Qwen3-TTS CustomVoice model.')

# MLX-Audio is optional for the web app and imported only by this separately started local process.
import numpy as np
from mlx_audio.tts.utils import load_model

MODEL_ID = 'qwen3-tts-0.6b'
model = None

class SpeechHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log submitted paper text, URL parameters or request headers.

    def send_json(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != '/v1/models':
            return self.send_json(404, {'error': 'Not found'})
        self.send_json(200, {'data': [{'id': MODEL_ID, 'languages': ['en', 'de'], 'voices': ['Ryan', 'Aiden', 'Serena', 'Vivian']}]})

    def do_POST(self):
        global model
        if self.path != '/v1/audio/speech':
            return self.send_json(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 20000:
                return self.send_json(400, {'error': 'Send a bounded JSON speech request.'})
            value = json.loads(self.rfile.read(size))
            text = value.get('input', '')
            language = str(value.get('language', 'en-US')).split('-')[0].split('_')[0].lower()
            voice = value.get('voice', 'Ryan')
            if not isinstance(text, str) or not text.strip() or len(text) > 2500 or language not in ['en', 'de'] or voice not in ['Ryan', 'Aiden', 'Serena', 'Vivian'] or value.get('model', MODEL_ID) != MODEL_ID:
                return self.send_json(400, {'error': 'Use the configured model, a preset voice, English/German and 1-2500 text characters.'})
            started = time.monotonic()
            if model is None:
                model = load_model(args.model_path)
            token_limit = min(3072, max(256, len(text) * 3))
            results = list(model.generate_custom_voice(text=text, speaker=voice, language={'en': 'English', 'de': 'German'}[language], max_tokens=token_limit))
            if sum(result.token_count for result in results) >= token_limit:
                return self.send_json(502, {'error': 'Speech reached the generation limit. Split the text into shorter passages and retry.'})
            if not results:
                return self.send_json(502, {'error': 'The model generated no audio.'})
            audio = np.concatenate([np.asarray(result.audio).reshape(-1) for result in results])
            if not np.isfinite(audio).all() or audio.size == 0 or float(abs(audio).max()) < 0.001:
                return self.send_json(502, {'error': 'The model generated invalid or silent audio.'})
            output = io.BytesIO()
            with wave.open(output, 'wb') as wav:
                wav.setparams((1, 2, results[0].sample_rate, 0, 'NONE', 'not compressed'))
                wav.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
            body = output.getvalue()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('X-Generation-Ms', str(round((time.monotonic() - started) * 1000)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_json(400, {'error': 'Invalid speech input.'})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            logging.error('Local speech generation failed; check the installed MLX-Audio and CustomVoice model versions.')
            self.send_json(500, {'error': 'Local model generation failed. Check MLX-Audio and the CustomVoice checkpoint.'})

print(f'Local Qwen3-TTS listening at http://127.0.0.1:{args.port}/v1 (English/German; audio stays on this computer)', flush=True)
HTTPServer(('127.0.0.1', args.port), SpeechHandler).serve_forever()
