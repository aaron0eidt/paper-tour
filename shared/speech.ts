/** Synthesized speech is independent of script preparation and never changes source words. */
export const SPEECH_PROVIDERS = ['browser', 'local', 'openai', 'elevenlabs'] as const;
export type SpeechProvider = (typeof SPEECH_PROVIDERS)[number];
export type AudioSpeechProvider = Exclude<SpeechProvider, 'browser'>;
export type TimingSource = 'provider' | 'estimated';
export interface SpeechConnection {
  model: string;
  voice: string;
  credentialSource: 'app' | 'personal';
}
export interface SpeechPreferences {
  provider: SpeechProvider;
  /** Cloud precomputation is opt-in because it consumes provider credits. */
  precompute: boolean;
  connections: Record<AudioSpeechProvider, SpeechConnection>;
}
export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = {
  provider: 'browser',
  precompute: false,
  connections: {
    local: { model: 'qwen3-tts-0.6b', voice: 'Ryan', credentialSource: 'app' },
    openai: { model: 'gpt-4o-mini-tts', voice: 'cedar', credentialSource: 'app' },
    elevenlabs: { model: 'eleven_multilingual_v2', voice: 'JBFqnCBsd6RMkjVDRZzb', credentialSource: 'app' },
  },
};
export interface SpeechProviderStatus {
  configured: boolean;
  reachable?: boolean;
  message: string;
  personalKey: { configured: boolean; masked: string | null };
  appKeyAvailable: boolean;
}
export interface SpeechSettings {
  preferences: SpeechPreferences;
  /** Opaque version invalidates audio after settings or credentials change. */
  version: string;
  providers: Record<AudioSpeechProvider, SpeechProviderStatus>;
}
export interface SpeechInput {
  text: string;
  language: string;
  version: string;
}
export interface SpeechAudio {
  audioBase64: string;
  mimeType: 'audio/wav' | 'audio/mpeg';
  durationMs?: number;
  /** Present only if returned by a provider and mapped to the exact input words. */
  wordTimesMs?: number[];
  timing: TimingSource;
  provider: AudioSpeechProvider;
  model: string;
  voice: string;
  cached: boolean;
}
