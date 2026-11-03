# Browser voices and speech APIs

Speech selection applies to guided tours, source-text reading and answers. **Browser voices** preserves the existing Google/native Web Speech selection and remains the compatibility default. Available voices depend on the browser. **ElevenLabs** is the working cloud option for German and English. **OpenAI** remains optional; its supported Speech API models shut down on 6 January 2027, which Settings discloses. OpenAI has not been live-tested.

The Audio menu selects providers and voices directly. ElevenLabs has an editable voice ID with explicit Save and an account link; browser voices retain their existing picker. Profile reuses the API voice field and owns model/credential configuration. Selecting a provider or voice pauses playback, saves preferences and invalidates audio versions. It does not synthesize speech. Failed generation pauses with a visible error and never selects another provider.

## Rolling sentence preparation

API speech uses bounded sentence groups, normally at most 300 characters. Very short sentences share a small natural group to avoid a request per tiny utterance. Splitting preserves every original word, order and global word index; it never truncates a paragraph to fit a limit.

Pressing Play requests the current chunk and **one** following chunk concurrently. While the current audio plays, the following audio is already being generated or cached. Advancing reuses it and requests only the next chunk. At the last chunk, the reader prepares the next already-authored passage. Reading lookahead only inspects already prepared scripts; it adds no language-model calls. Nothing precomputes the entire paper or starts generation on selection/page load.

The browser shares pending requests and caches up to 32 MiB. Server caches are private per account/version, bounded to 128 MiB per account and seven days. Pause/seek cancel old playback callbacks; already requested audio can finish into cache rather than causing another charge on resume. Provider requests have timeouts and two simultaneous generations per account. Failed background requests are not retried by word/camera updates; foreground playback can explicitly retry.

ElevenLabs character alignment becomes word timestamps only when it matches the exact input and is monotonic. Unmatchable alignment and OpenAI audio are labeled estimated. Audio time drives PDF/visual word callbacks, including speed changes. Browser speech retains its native boundary handling.

## Credentials and adoption

`ELEVENLABS_API_KEY` and `OPENAI_TTS_API_KEY` are optional server-only variables. Personal profile keys are encrypted in the existing Supabase Vault; only configured state and masked suffixes are returned. Deleting a personal key leaves that connection unconfigured rather than falling back to a server key. Keys are absent from browser localStorage, URLs, logs and audio caches.

Apply the normal migrations without resetting data. `202611030002_speech_providers.sql` creates speech settings and Vault references. `202611030003_api_only_speech.sql` retires GPU Qwen preferences by explicitly mapping them to **Browser voices**, preserving existing Browser/ElevenLabs/OpenAI selections and invalidating old audio versions. It removes obsolete local/precompute fields. This never migrates private/local readers to a paid API automatically. After adoption, explicitly select ElevenLabs to use its API and automatic sentence preparation.

GPU-model adapters, startup scripts and the four-button local test harness have been removed from the current application. Their earlier experimental implementation/research remains in Git history at `1f43999`; no model download, Python service or GPU is required for the normal speech flow.

## Verification and limits

On 3 November 2026, authorized real ElevenLabs multilingual-v2 generation produced valid English and German MP3s with exact-input alignment: 1.462 s generation / 3.669 s audio in English and 0.447 s / 5.248 s in German. Samples and timing metadata are under ignored `.data/tts-validation/`. Native Chrome playback exercised the production narrator/engine with real media, with zero media errors. These short samples do not establish long-paper pronunciation or teaching quality. No additional paid generation was needed for the rolling-lookahead change.

Focused tests cover current+next startup ordering, rolling one-chunk lookahead, short-sentence grouping, no word omissions, shared flights, cancellation, cache reuse, German language propagation and no background retry loops. Server checks cover encrypted keys, client-role denial, deletion, account/version cache isolation and explicit rejection of retired GPU settings. The key supplied for live testing is synthesis-scoped: catalog/quota reads return `missing_permissions`, so no remaining-credit number is claimed.

The API model/voice selectors were adopted into the signed-in main app through its normal migration workflow. Further API calls occur only through user playback/preview or an explicitly invoked smoke test:

```sh
cd server
node --import tsx scripts/validate-speech-live.ts --elevenlabs
```

Sources: [ElevenLabs timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps), [pricing/account limits](https://elevenlabs.io/pricing/api), [official OpenAI speech documentation and shutdown notice](https://developers.openai.com/api/docs/guides/text-to-speech). No hosted trial is promised as a permanent free API.
