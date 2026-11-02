/** Reading preferences are local to this browser, like the color theme. */
export const MAX_AUTO_ZOOM_KEY = 'paper-tour:max-auto-zoom';
export const DEFAULT_MAX_AUTO_ZOOM = 200;
const CHANGED = 'paper-tour:reading-preferences';
let sessionZoom: number | undefined;

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
    if (event.key === MAX_AUTO_ZOOM_KEY || event.key === null) {
      sessionZoom = undefined;
      listener();
    }
  };
  window.addEventListener(CHANGED, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener('storage', storage);
  };
}
