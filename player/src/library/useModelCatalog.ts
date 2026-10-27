import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModelCatalog } from '../../../shared/models';
import { apiRequest } from './client';

interface CatalogSnapshot { catalog: ModelCatalog | null; loading: boolean; error: string | null }
let snapshot: CatalogSnapshot = { catalog: null, loading: false, error: null };
const listeners = new Set<() => void>();
let receivedAt = 0;
let inFlight: Promise<void> | null = null;
const CACHE_MS = 5 * 60 * 1000;
const MODEL_PREFERENCE_KEY = 'paper-tour.model.v1';
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;
function publish(next: CatalogSnapshot) { snapshot = next; for (const listener of listeners) listener(); }

function loadCatalog(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && snapshot.catalog && Date.now() - receivedAt < CACHE_MS) return Promise.resolve();
  publish({ ...snapshot, loading: true, error: null });
  inFlight = apiRequest<ModelCatalog>('/api/models').then((catalog) => {
    receivedAt = Date.now();
    publish({ catalog, loading: false, error: null });
  }).catch(() => {
    publish({ ...snapshot, loading: false, error: 'Could not load models and API prices. Try again.' });
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function useModelCatalog() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void loadCatalog(); }, []);
  const refresh = useCallback(() => { void loadCatalog(true); }, []);
  return { ...state, refresh };
}

function savedModel(): string {
  try { return localStorage.getItem(MODEL_PREFERENCE_KEY) ?? ''; } catch { return ''; }
}

/** Persist the default model ID only. Training permission is fresh for every new action. */
export function useModelPreference(catalog: ModelCatalog | null, initialModel?: string) {
  const [requestedModel, setRequestedModel] = useState(() => initialModel || savedModel());
  const [consentedModel, setConsentedModel] = useState('');
  const previousInitial = useRef(initialModel);
  useEffect(() => {
    if (previousInitial.current !== initialModel) {
      previousInitial.current = initialModel;
      setRequestedModel(initialModel || savedModel());
      setConsentedModel('');
    }
  }, [initialModel]);
  const model = requestedModel && catalog?.models.some((candidate) => candidate.id === requestedModel)
    ? requestedModel : catalog?.defaultModel ?? '';
  const allowTraining = !!model && consentedModel === model;
  useEffect(() => { setConsentedModel(''); }, [model]);
  const setAllowTraining = useCallback((allowed: boolean) => setConsentedModel(allowed ? model : ''), [model]);
  const setModel = useCallback((id: string) => {
    setRequestedModel(id); setConsentedModel('');
    if (initialModel === undefined) {
      try { localStorage.setItem(MODEL_PREFERENCE_KEY, id); } catch { /* Preference remains usable in memory. */ }
    }
  }, [initialModel]);
  const resetConsent = useCallback(() => setConsentedModel(''), []);
  return { model, setModel, allowTraining, setAllowTraining, resetConsent };
}
