import { createUISFX, type CueName, type UISFXPlayer } from 'uisfx';
import { getInterfacePreferences } from './preferences';

let player: UISFXPlayer | undefined;
let unlocked = false;
let narrationActive = false;

/** No sound context is created until the learner enables sounds and interacts. */
export function unlockInterfaceSounds() {
  const settings = getInterfacePreferences();
  if (!settings.sounds) return;
  player ??= createUISFX({
    pack: settings.pack,
    volume: settings.volume,
    enabled: true,
    maxVoices: 2,
    cooldownMs: 100,
  });
  void player
    .unlock()
    .then((ready) => {
      unlocked = ready;
    })
    .catch(() => {
      unlocked = false;
    });
}
export function syncInterfaceSounds() {
  if (!player) return;
  const settings = getInterfacePreferences();
  player.setEnabled(settings.sounds);
  player.setVolume(settings.volume);
  player.setPack(settings.pack);
  if (!settings.sounds) player.stopAll();
}
export function setNarrationSoundGate(active: boolean) {
  narrationActive = active;
  if (active) player?.stopAll();
}
export function playInterfaceSound(cue: CueName) {
  if (!unlocked || narrationActive || document.hidden || !getInterfacePreferences().sounds) return;
  player?.play(cue, { loop: false, retrigger: 'ignore', cooldownMs: 120 });
}
export async function previewInterfaceSound() {
  unlockInterfaceSounds();
  syncInterfaceSounds();
  // Await the browser unlock while retaining the trusted interaction above.
  if (player && (await player.unlock())) {
    unlocked = true;
    playInterfaceSound('success');
  }
}
export function stopInterfaceSounds() {
  player?.stopAll();
}
export function disposeInterfaceSounds() {
  const held = player;
  player = undefined;
  unlocked = false;
  narrationActive = false;
  void held?.destroy();
}
