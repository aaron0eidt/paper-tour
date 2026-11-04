import { useSyncExternalStore } from 'react';
import { getResolvedTheme, getThemePreference, setThemePreference, subscribeTheme } from '../theme';
import { ThemeTogglerButton, ThemeTogglerButtonIcon } from './vendor/ThemeTogglerButton';

/** Shares the persisted theme store with Settings, including system preference changes. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getThemePreference);
  const resolved = useSyncExternalStore(subscribeTheme, getResolvedTheme);
  const label = resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <ThemeTogglerButton
      theme={theme}
      resolvedTheme={resolved}
      setTheme={setThemePreference}
      modes={['light', 'dark']}
      type="button"
      aria-label={label}
      title={label}
    >
      <ThemeTogglerButtonIcon
        light={
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        }
        dark={
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />
          </svg>
        }
      />
    </ThemeTogglerButton>
  );
}
