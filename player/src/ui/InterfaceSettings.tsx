import { AnimatedSlider } from './Slider';
import { useState, useSyncExternalStore } from 'react';
import { ChoicePicker } from '../components/ChoicePicker';
import { ActionButton } from './ActionButton';
import { AnimatedSwitch } from './controls';
import {
  getInterfacePreferences,
  setInterfacePreferences,
  SOUND_PACKS,
  subscribeInterfacePreferences,
} from './preferences';
import { previewInterfaceSound } from './sound';

export function InterfaceSettings() {
  const settings = useSyncExternalStore(subscribeInterfacePreferences, getInterfacePreferences);
  const [previewing, setPreviewing] = useState(false);
  return (
    <section className="profile-card" id="interface" aria-labelledby="interface-heading">
      <div className="ui-settings-row">
        <div className="profile-card-heading">
          <h2 id="interface-heading">Interface sounds</h2>
          <p id="interface-sounds-help">Subtle feedback for selections, switches and completed actions.</p>
        </div>
        <AnimatedSwitch
          checked={settings.sounds}
          aria-label="Interface sounds"
          aria-describedby="interface-sounds-help"
          onCheckedChange={(sounds) => setInterfacePreferences({ sounds })}
        />
      </div>
      <div className="ui-sound-options">
        <label>
          Sound palette
          <ChoicePicker
            value={settings.pack}
            label="Sound palette"
            options={SOUND_PACKS}
            disabled={!settings.sounds}
            onChange={(pack) => setInterfacePreferences({ pack })}
          />
        </label>
        <label htmlFor="interface-volume">
          Volume · {Math.round(settings.volume * 100)}%
          <AnimatedSlider id="interface-volume" label="Interface sound volume"
            min={0} max={100} step={5} value={Math.round(settings.volume * 100)}
            valueText={`${Math.round(settings.volume * 100)}%`} disabled={!settings.sounds}
            onChange={(volume) => setInterfacePreferences({ volume: volume / 100 })} />
        </label>
        <ActionButton
          label="Preview"
          className="library-button"
          busy={previewing}
          disabled={!settings.sounds}
          onClick={async () => {
            setPreviewing(true);
            try {
              await previewInterfaceSound();
            } finally {
              setPreviewing(false);
            }
          }}
        />
      </div>
      <p className="profile-help">
        Off by default. Automatically quiet during narration. Saved on this browser. Motion follows your
        device’s Reduce motion setting.
      </p>
    </section>
  );
}
