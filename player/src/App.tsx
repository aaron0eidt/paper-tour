import { useCallback } from 'react';
import { Reader } from './Reader';
import { LibraryApp } from './library/LibraryApp';

/** Navigation is URL based so every private document has a stable, reopenable address. */
export function App() {
  const query = new URLSearchParams(location.search);
  const documentId = query.get('document');
  const back = useCallback(() => location.assign(import.meta.env.BASE_URL), []);
  const openDocument = useCallback(
    (id: string) => location.assign(`${import.meta.env.BASE_URL}?document=${encodeURIComponent(id)}`),
    [],
  );
  if (documentId)
    return <Reader key={documentId} documentId={documentId} onBack={back} />;
  return <LibraryApp onOpenDocument={openDocument} />;
}
