import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest } from '../library/client';
import { PROFILE_DESCRIPTIONS } from '../../../shared/tourProfiles';
import type {
  TourAudience,
  TourDepth,
  TourProfile,
  TourProfileCatalog,
  TourProfileDraft,
  TourProfileSelection,
  TourProfileSnapshot,
  TourStructure,
} from '../../../shared/tourProfiles';
import './tourProfiles.css';

interface Props {
  current?: TourProfileSnapshot | null;
  model: string;
  busy: boolean;
  onCreate(selection: TourProfileSelection): Promise<void>;
  onClose(): void;
}
/** Creation and reusable instructions live here; the floating question dock stays focused on reading. */
export function TourProfileDialog({ current, model, busy, onCreate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<TourProfileCatalog | null>(null);
  const [selection, setSelection] = useState(current?.id ?? 'concept-led');
  const [depth, setDepth] = useState<TourDepth>(current?.depth ?? 'standard');
  const [audience, setAudience] = useState<TourAudience>(current?.audience ?? 'familiar');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ id?: string; revision?: number; draft: TourProfileDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = catalog?.profiles.find((p) => p.id === selection);
  const locked = busy || saving;
  useEffect(() => {
    const element = dialog.current;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      focus?.focus();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    apiRequest<TourProfileCatalog>('/api/tour-profiles', { signal: abort.signal })
      .then((next) => {
        if (abort.signal.aborted) return;
        setCatalog(next);
        if (!current && !catalog) setDepth(next.defaultDepth);
        setError(null);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load tour profiles.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);

  function edit(profile: TourProfile, duplicate: boolean) {
    setError(null);
    setEditing({
      id: duplicate ? undefined : profile.id,
      revision: duplicate ? undefined : profile.revision,
      draft: {
        name: duplicate ? `${profile.name} copy` : profile.name,
        instructions: profile.instructions,
        structure: profile.structure,
        depth,
        audience,
      },
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || locked) return;
    setSaving(true);
    setError(null);
    try {
      const profile = await apiRequest<TourProfile>(
        editing.id ? `/api/tour-profiles/${editing.id}` : '/api/tour-profiles',
        {
          method: editing.id ? 'PUT' : 'POST',
          body: JSON.stringify(editing.id ? { ...editing.draft, expectedRevision: editing.revision } : editing.draft),
        },
      );
      setCatalog((previous) =>
        previous
          ? { ...previous, profiles: [...previous.profiles.filter((p) => p.id !== profile.id), profile] }
          : previous,
      );
      setSelection(profile.id);
      setDepth(profile.depth);
      setAudience(profile.audience);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this profile.');
    } finally {
      setSaving(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!selected || locked || loading) return;
    setError(null);
    try {
      await onCreate({ profileId: selected.id, profileRevision: selected.revision, depth, audience });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start this tour.');
    }
  }
  const patch = (changes: Partial<TourProfileDraft>) =>
    setEditing((value) => (value ? { ...value, draft: { ...value.draft, ...changes } } : value));
  return (
    <dialog
      ref={dialog}
      className="tour-profile-dialog"
      aria-labelledby="tour-profile-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      <header>
        <div>
          <h2 id="tour-profile-heading">
            {editing ? (editing.id ? 'Edit profile' : 'Save a tour profile') : 'Create a tour'}
          </h2>
          <p>
            {editing
              ? 'Reusable teaching instructions. Saving an edit creates a new revision.'
              : 'Choose how this paper should be explained. Existing tours are kept.'}
          </p>
        </div>
        <button type="button" disabled={locked} onClick={onClose}>
          Close
        </button>
      </header>
      {error && (
        <p className="tour-profile-error" role="alert">
          {error}{' '}
          {!catalog && (
            <button type="button" onClick={() => setRevision((v) => v + 1)}>
              Try again
            </button>
          )}
        </p>
      )}
      {editing ? (
        <form onSubmit={(event) => void save(event)}>
          <label>
            Profile name
            <input
              autoFocus
              required
              maxLength={80}
              value={editing.draft.name}
              disabled={locked}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label>
            Structure
            <select
              value={editing.draft.structure}
              disabled={locked}
              onChange={(event) => patch({ structure: event.target.value as TourStructure })}
            >
              <option value="concepts">Concept-led</option>
              <option value="overview">Overview</option>
              <option value="paper">In paper order</option>
            </select>
          </label>
          <label>
            Teaching instructions
            <textarea
              rows={5}
              maxLength={6000}
              value={editing.draft.instructions}
              disabled={locked}
              placeholder="Explain what the reader should understand and which teaching approach to use."
              onChange={(event) => patch({ instructions: event.target.value })}
            />
          </label>
          <p>
            Defaults: {editing.draft.depth} depth, {editing.draft.audience} audience. You can override both when
            creating a tour.
          </p>
          <footer>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancel edit
            </button>
            <button className="primary" disabled={locked || !editing.draft.name.trim()}>
              {saving ? 'Saving…' : editing.id ? 'Save new revision' : 'Save profile'}
            </button>
          </footer>
        </form>
      ) : (
        <form onSubmit={(event) => void create(event)}>
          <label>
            Tour profile
            <select
              autoFocus
              value={selection}
              disabled={locked || loading || !catalog}
              onChange={(event) => {
                setSelection(event.target.value);
                const profile = catalog?.profiles.find((p) => p.id === event.target.value);
                if (profile) {
                  setDepth(profile.depth);
                  setAudience(profile.audience);
                }
              }}
            >
              {!catalog && (
                <option value="concept-led">{loading ? 'Loading profiles…' : 'Profiles unavailable'}</option>
              )}
              {catalog?.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.builtin ? '' : ` · revision ${profile.revision}`}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <p className="tour-profile-description">{PROFILE_DESCRIPTIONS[selected.structure]}</p>
              <div className="tour-profile-manage">
                <button type="button" disabled={locked} onClick={() => edit(selected, true)}>
                  Save as a new profile
                </button>
                {!selected.builtin && (
                  <button type="button" disabled={locked} onClick={() => edit(selected, false)}>
                    Edit instructions
                  </button>
                )}
              </div>
            </>
          )}
          <div className="tour-profile-options">
            <label>
              Explanation depth
              <select value={depth} disabled={locked} onChange={(event) => setDepth(event.target.value as TourDepth)}>
                <option value="quick">Brief</option>
                <option value="standard">Standard</option>
                <option value="deep">In depth</option>
              </select>
            </label>
            <label>
              Reader familiarity
              <select
                value={audience}
                disabled={locked}
                onChange={(event) => setAudience(event.target.value as TourAudience)}
              >
                <option value="general">New to the subject</option>
                <option value="familiar">Some background</option>
                <option value="expert">Experienced</option>
              </select>
            </label>
          </div>
          <p>
            Model: <strong>{model}</strong>.{' '}
            <a href={`${import.meta.env.BASE_URL}?settings=profile#tour-model`}>Change model in Settings</a>
          </p>
          {selected && (
            <p>
              This tour keeps {selected.name} revision {selected.revision}. Later profile edits won’t change it.
            </p>
          )}
          <footer>
            <button type="button" disabled={locked} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={locked || loading || !selected}>
              {busy ? 'Starting…' : 'Create tour'}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
