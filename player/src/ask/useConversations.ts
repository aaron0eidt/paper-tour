import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, ConversationContext, ConversationSummary } from '../../../shared/conversations';
import { askErrorMessage, isCancelled } from './api';
import { createConversation, getConversation, listConversations } from './conversations';

/** Server-backed sessions, with request epochs so old documents and switched threads cannot overwrite each other. */
export function useConversations(documentId: string | undefined) {
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const current = useRef<Conversation | null>(null);
  const epoch = useRef(0);
  const liveDocument = useRef(documentId);
  liveDocument.current = documentId;
  const storageKey = documentId ? `paper-tour:conversation:${documentId}` : '';
  const select = useCallback(
    (value: Conversation | null) => {
      current.current = value;
      setActive(value);
      try {
        if (value) sessionStorage.setItem(storageKey, value.id);
        else sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage may be disabled; server conversations still work. */
      }
    },
    [storageKey],
  );

  useEffect(() => {
    const generation = ++epoch.current;
    current.current = null;
    setActive(null);
    setThreads([]);
    setError('');
    if (!documentId) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const items = await listConversations(documentId, controller.signal);
        if (generation !== epoch.current) return;
        setThreads(items);
        let saved: string | null = null;
        try {
          saved = sessionStorage.getItem(storageKey);
        } catch {
          /* Optional convenience. */
        }
        if (saved && items.some((item) => item.id === saved)) {
          const thread = await getConversation(documentId, saved, controller.signal);
          if (generation === epoch.current) select(thread);
        }
      } catch (reason) {
        if (generation === epoch.current && !isCancelled(reason)) setError(askErrorMessage(reason));
      } finally {
        if (generation === epoch.current) setLoading(false);
      }
    })();
    return () => {
      ++epoch.current;
      controller.abort();
    };
  }, [documentId, storageKey, select]);

  const refresh = useCallback(async () => {
    if (!documentId) return;
    const generation = epoch.current;
    const selected = current.current?.id;
    try {
      const [items, thread] = await Promise.all([
        listConversations(documentId),
        selected ? getConversation(documentId, selected) : Promise.resolve(null),
      ]);
      if (generation !== epoch.current) return;
      setThreads(items);
      if (current.current?.id === selected && thread) select(thread);
      setError('');
    } catch (reason) {
      if (generation === epoch.current) setError(askErrorMessage(reason));
    }
  }, [documentId, select]);

  const open = useCallback(
    async (id: string) => {
      if (!documentId) return null;
      const generation = ++epoch.current;
      setLoading(true);
      try {
        const thread = await getConversation(documentId, id);
        if (generation !== epoch.current) return null;
        select(thread);
        setError('');
        return thread;
      } catch (reason) {
        if (generation === epoch.current) setError(askErrorMessage(reason));
        return null;
      } finally {
        if (generation === epoch.current) setLoading(false);
      }
    },
    [documentId, select],
  );

  const startNew = useCallback(() => {
    ++epoch.current;
    select(null);
    setError('');
    setLoading(false);
  }, [select]);

  // Creation happens only after an explicit question; suggested-answer prefetch never calls this.
  const ensure = useCallback(
    async (context: ConversationContext, question: string, signal: AbortSignal) => {
      if (!documentId) return null;
      if (current.current) return current.current;
      const generation = ++epoch.current;
      setLoading(false);
      const thread = await createConversation(documentId, { title: question.slice(0, 160), context }, signal);
      signal.throwIfAborted();
      if (generation !== epoch.current || liveDocument.current !== documentId)
        throw new DOMException('Conversation changed.', 'AbortError');
      select(thread);
      setThreads((items) => [thread, ...items.filter((item) => item.id !== thread.id)]);
      return thread;
    },
    [documentId, select],
  );

  return { threads, active, current, loading, error, refresh, open, startNew, ensure };
}
