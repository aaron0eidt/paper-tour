export interface UserSettings {
  defaultModel: string;
  credentialSource: 'app' | 'personal';
  appKeyAvailable: boolean;
  personalKey: {
    configured: boolean;
    masked: string | null;
    updatedAt: string | null;
    checkedAt: string | null;
    status: 'valid' | 'unavailable' | null;
  };
}
export interface SettingsUpdate {
  defaultModel?: string;
  credentialSource?: 'app' | 'personal';
}
