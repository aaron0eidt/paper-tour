/** Reading preferences are local to this browser, like the color theme. */
export const MAX_AUTO_ZOOM_KEY = 'paper-tour:max-auto-zoom';
export const DEFAULT_MAX_AUTO_ZOOM = 200;
export const NARRATION_DISPLAY_KEY = 'paper-tour:narration-display';
export const NARRATION_DISPLAY_OPTIONS = [
  { id: 'player', label: 'Bottom player', description: 'Show spoken text below the paper.' },
  { id: 'agent', label: 'Agent bubble', description: 'Show spoken text beside the agent.' },
  { id: 'both', label: 'Both', description: 'Show spoken text in both places.' },
] as const;
export type NarrationDisplay = (typeof NARRATION_DISPLAY_OPTIONS)[number]['id'];
export const DEFAULT_NARRATION_DISPLAY: NarrationDisplay = 'player';
const CHANGED = 'paper-tour:reading-preferences';
let sessionZoom: number | undefined;
let sessionNarration: NarrationDisplay | undefined;

export function parseNarrationDisplay(value: string | null): NarrationDisplay {
  return NARRATION_DISPLAY_OPTIONS.find((option) => option.id === value)?.id ?? DEFAULT_NARRATION_DISPLAY;
}

export function narrationSurfaces(display: NarrationDisplay) {
  return { player: display !== 'agent', agent: display !== 'player' };
}

export function getNarrationDisplay(): NarrationDisplay {
  if (sessionNarration !== undefined) return sessionNarration;
  try {
    return parseNarrationDisplay(localStorage.getItem(NARRATION_DISPLAY_KEY));
  } catch {
    return DEFAULT_NARRATION_DISPLAY;
  }
}

export function setNarrationDisplay(value: NarrationDisplay) {
  sessionNarration = parseNarrationDisplay(value);
  try {
    localStorage.setItem(NARRATION_DISPLAY_KEY, sessionNarration);
  } catch {
    // Keep this visit usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function parseMaxAutoZoom(value: string | null): number {
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 100 && percent <= 400 ? percent : DEFAULT_MAX_AUTO_ZOOM;
}

export function getMaxAutoZoom(): number {
  if (sessionZoom !== undefined) return sessionZoom;
  try {
    return parseMaxAutoZoom(localStorage.getItem(MAX_AUTO_ZOOM_KEY));
  } catch {
    return sessionZoom ?? DEFAULT_MAX_AUTO_ZOOM;
  }
}

export function setMaxAutoZoom(percent: number) {
  sessionZoom = parseMaxAutoZoom(String(percent));
  try {
    localStorage.setItem(MAX_AUTO_ZOOM_KEY, String(sessionZoom));
  } catch {
    // Keep the preference for this visit when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeReadingPreferences(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === MAX_AUTO_ZOOM_KEY || event.key === null) sessionZoom = undefined;
    if (event.key === NARRATION_DISPLAY_KEY || event.key === null) sessionNarration = undefined;
    if (event.key === MAX_AUTO_ZOOM_KEY || event.key === NARRATION_DISPLAY_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGED, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener('storage', storage);
  };
}
