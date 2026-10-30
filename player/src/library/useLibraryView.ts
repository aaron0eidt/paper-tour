import { useEffect, useState } from 'react';
import { parseLibraryView } from './libraryView';

/** Keep this tab's view when returning from a paper or Settings, separately for each account. */
export function useLibraryView(accountId: string) {
  const key = `paper-tour:library-view:${accountId}`;
  const [view, setView] = useState(() => {
    try {
      return parseLibraryView(sessionStorage.getItem(key));
    } catch {
      return parseLibraryView(null);
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(view));
    } catch {
      /* The library remains usable when browser storage is unavailable. */
    }
  }, [key, view]);
  return [view, setView] as const;
}
