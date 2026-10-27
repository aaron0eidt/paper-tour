import { useCallback } from 'react';
import { Reader } from './Reader';
import { LibraryApp } from './library/LibraryApp';

/** Navigation is URL based so every private document has a stable, reopenable address. */
export function App() {
  const query = new URLSearchParams(location.search);
  const documentId = query.get('document');
  const demo = import.meta.env.DEV && query.has('paper');
  const back = useCallback(() => location.assign(import.meta.env.BASE_URL), []);
  const openDocument = useCallback(
    (id: string) => location.assign(`${import.meta.env.BASE_URL}?document=${encodeURIComponent(id)}`),
    [],
  );
  const openDemo = useCallback(() => location.assign(`${import.meta.env.BASE_URL}?paper=attention`), []);
  if (documentId || demo)
    return <Reader key={documentId ?? 'demo'} documentId={documentId ?? undefined} onBack={back} />;
  return <LibraryApp onOpenDocument={openDocument} onOpenDemo={openDemo} />;
}
