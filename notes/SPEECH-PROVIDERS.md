# Speech providers

Speech selection now applies to guided tours, source-text read-aloud and answers. Script preparation and its durable cache remain independent of speech generation. No language-model calls are added by audio generation or lookahead. Browser voices remain an explicit selection; mute remains intentional timed narration. Failed audio generation pauses with an actionable error and never changes providers.

Choose a provider under **Profile & Settings → Speech**, save its voice/connection, then preview it. The player's **Audio** menu can select a provider too. Both local Qwen and ElevenLabs can speak English and German; read-aloud carries the prepared passage's actual language through to synthesis, and answers use their response language.

## Local Qwen3-TTS

The recommended free local option for this installation is Qwen3-TTS 0.6B CustomVoice. It already exists in the user's oMLX model directory, so validation required no downloads or system package changes. Start the separate, loopback-only bridge from the repository root:

```sh
~/.omlx/bin/omlx-python scripts/local-tts.py
```

The script uses installed MLX-Audio; alternatively use a project virtual environment containing `mlx-audio` and pass `--model-path /absolute/path/to/CustomVoice`. It does not start oMLX itself or download a model implicitly. Default port: 8045. `LOCAL_TTS_URL` and `LOCAL_TTS_MODEL` are server configuration; profile requests cannot supply arbitrary URLs or local filesystem paths. The current bridge exposes English/German and Ryan, Aiden, Serena, Vivian. Ryan/Aiden are native English presets; German accent/pronunciation should be judged with actual samples rather than presumed equivalent to a native German voice.

Qwen's [official model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) lists German and English among ten languages and Apache-2.0 licensing. The 0.6B name refers to the speech model variant; the existing model directory including tokenizer occupied 2.3 GiB. The [MLX-Audio implementation](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md) provides `generate_custom_voice`. These are capability and license observations, not a claim that this model has the best voice quality.

## Cloud connections

`ELEVENLABS_API_KEY` and `OPENAI_TTS_API_KEY` are optional server-only environment variables. Each signed-in profile can instead save a personal key, encrypted in the existing Supabase Vault. Responses expose only configured state and the masked suffix. Deleting a personal key keeps that connection personal/unconfigured, without falling back to a server key. Account deletion removes its Vault secret through the database trigger. No keys go into browser localStorage, URLs or audio-cache files.

ElevenLabs uses its [with-timestamps endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps) and configurable model/voice ID. Character timings become word starts only if they match every original input character and are monotonic. A key restricted to synthesis may lack catalog and subscription permissions; such a key can still be saved, without claiming a verified connection. The supplied key successfully synthesized English and German but could not list voices or read quota (`missing_permissions`). No remaining-credit number is available. [Pricing/account limits](https://elevenlabs.io/pricing/api) apply; this implementation does not promise a permanent free API or purchase anything.

OpenAI uses the existing `/v1/audio/speech` contract. **It was not live-tested: no OpenAI key or paid call was authorized.** Current [official documentation](https://developers.openai.com/api/docs/guides/text-to-speech) says `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` shut down on **6 January 2027**. That limitation is shown in settings. The recommended replacement uses a different Realtime workflow and is not silently substituted. OpenAI audio has estimated word timing.

## Timing, playback and caching

Local audio has no word timestamps. Its word highlighting/word seek uses an estimate from decoded audio duration and is labeled as such. ElevenLabs uses real mapped timing when available; unmatchable alignment is explicitly estimated. Audio time, including playback speed, drives word callbacks used by PDF highlights, annotations and visuals. Pause/seek cancel old callbacks and revoke old media URLs; resume reuses audio. Long text is divided into bounded sentence groups, preserving every word and its global index. Local generation that reaches its token limit is rejected rather than treated as complete.

The browser caches at most 32 MiB of audio, with in-flight request sharing. The server caches per account/version, with private filesystem permissions, a 128 MiB account limit and seven-day retention. Cache read/write/pruning failures cannot turn successful synthesis into failure. Credential or preference changes invalidate audio through an opaque version. Local lookahead is enabled; cloud lookahead is explicitly opt-in because it uses credits. A request already started may finish and be cached when playback pauses or disconnects; provider timeouts and a two-request account limit still apply. Failed background requests do not automatically retry on word updates; foreground playback can retry visibly.

## Live validation on 3 November 2026

Machine: Apple M5 Pro, 64 GiB; existing MLX-Audio 0.5.7 and Qwen CustomVoice model. Files and raw timing metadata are saved locally under `.data/tts-validation/` (ignored, no credentials). Initial measured samples:

| Provider | Language | Generation latency | Audio duration | Word timing |
| --- | --- | --- | --- | --- |
| Local Qwen | English | 3.751 s including cold load | 6.160 s | Estimated |
| Local Qwen | German | 1.959 s warm | 6.880 s | Estimated |
| ElevenLabs multilingual v2 | English | 1.462 s | 3.669 s | Provider alignment |
| ElevenLabs multilingual v2 | German | 0.447 s | 5.248 s | Provider alignment |

All four outputs decoded as real audio with `ffprobe`. A separate native Chrome test page used the production ProviderNarrator, TourEngine, production speech route functions under an isolated test identity, real providers and a **new disposable database**, on ports 5187/3017. Observed telemetry: seven actual media playing events, zero media errors, decoded durations including both WAV and MP3, and completed global word progression. The user then tried the four combinations and asked to keep them. This is a small subjective check, not a benchmark of long scientific narration, mathematical pronunciation or pedagogical quality.

Checks: full player suite (including pause/resume, seek, cache, cancellation, German language and no background retry-loop regressions); server speech tests plus existing API tests; Vault encryption, client-role denial, deletion and owner/version cache isolation against the disposable database; server/player builds. The full signed-in production Settings flow against the main application database has not been exercised: the main database, API and worker were deliberately left untouched. Apply `202611030002_speech_providers.sql` with the normal migration workflow when adopting this branch.

Reproduce audio generation explicitly (the flag consumes ElevenLabs credits only when its key is configured):

```sh
cd server
node --import tsx scripts/validate-speech-live.ts
node --import tsx scripts/validate-speech-live.ts --elevenlabs
```

The temporary local playback harness is `player/speech-validation.html`, backed by `server/scripts/serve-speech-validation.ts`. Its API rejects production mode, requires the disposable test database manifest and binds only to loopback. To recreate that isolated database, run `node --import tsx scripts/speech-test-database.ts` from `server`; remove it with the same command plus `--remove` after stopping its validation API. It never resets the application's database. To use a different API during development, set `PAPER_TOUR_API_PROXY` when starting Vite.

## Other small options researched

[Pocket TTS](https://github.com/kyutai-labs/pocket-tts) is an attractive CPU option: the current project lists German/English, a 100M model and smaller English variants down to 1.9M. Its code is MIT; current [official weights](https://huggingface.co/kyutai/pocket-tts) are CC-BY-4.0 and require accepting access conditions, including sharing Hugging Face information. No acceptance or download was performed. It was not implemented or live-tested in this change because an existing ungated local Qwen installation already worked.

[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) is smaller with Apache-licensed weights, but its [official voice list](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) does not list German. It was not selected as the German/English local default. No hosted demonstration or temporary trial quota was treated as a reliable free API.
