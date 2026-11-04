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
import { AnimatedDialog, DialogTitle } from '../ui/controls';
import { ActionButton } from '../ui/ActionButton';
import { ChoicePicker } from './ChoicePicker';
import './tourProfiles.css';

interface Props {
  current?: TourProfileSnapshot | null;
  model: string;
  busy: boolean;
  firstTour?: boolean;
  onCreate(selection: TourProfileSelection): Promise<void>;
  onClose(): void;
}
/** Creation and reusable instructions live here; the floating question dock stays focused on reading. */
export function TourProfileDialog({ current, model, busy, firstTour = false, onCreate, onClose }: Props) {
  const [open, setOpen] = useState(true);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = () => setOpen(false);
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
    <AnimatedDialog className="tour-profile-dialog" open={open}
      onOpenChange={(next, details) => { if (locked) details.cancel(); else setOpen(next); }}
      onOpenChangeComplete={(next) => { if (!next) onClose(); }} popupProps={{ finalFocus: returnFocus }}>
      <header>
        <div>
          <DialogTitle>
            {editing ? (editing.id ? 'Edit profile' : 'Save a tour profile') : firstTour ? 'How would you like to explore this paper?' : 'Create a tour'}
          </DialogTitle>
          <p>
            {editing
              ? 'Reusable teaching instructions. Saving an edit creates a new revision.'
              : firstTour
                ? 'Choose a tour type and explanation depth, or read the PDF first.'
                : 'Choose how this paper should be explained. Existing tours are kept.'}
          </p>
        </div>
        <button type="button" disabled={locked} onClick={close}>
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
            <ChoicePicker value={editing.draft.structure} label="Structure" disabled={locked}
              onChange={(structure: TourStructure) => patch({ structure })} options={[
                { value: 'concepts', label: 'Concept-led' }, { value: 'overview', label: 'Overview' }, { value: 'paper', label: 'In paper order' },
              ]} />
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
            <ActionButton busy={saving} label={saving ? 'Saving…' : editing.id ? 'Save new revision' : 'Save profile'} disabled={locked || !editing.draft.name.trim()} />
          </footer>
        </form>
      ) : (
        <form onSubmit={(event) => void create(event)}>
          <label>
            Tour type
            <ChoicePicker value={selection} label="Tour type" disabled={locked || loading || !catalog}
              options={catalog?.profiles.map((profile) => ({ value: profile.id, label: profile.name, badge: profile.builtin ? undefined : `revision ${profile.revision}` })) ?? [{ value: 'concept-led', label: loading ? 'Loading profiles…' : 'Profiles unavailable' }]}
              onChange={(next) => {
                setSelection(next);
                const profile = catalog?.profiles.find((item) => item.id === next);
                if (profile) { setDepth(profile.depth); setAudience(profile.audience); }
              }} />
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
              <ChoicePicker<TourDepth> value={depth} label="Explanation depth" disabled={locked} onChange={setDepth} options={[
                { value: 'quick', label: 'Brief' }, { value: 'standard', label: 'Standard' }, { value: 'deep', label: 'In depth' },
              ]} />
            </label>
            <label>
              Reader familiarity
              <ChoicePicker<TourAudience> value={audience} label="Reader familiarity" disabled={locked} onChange={setAudience} options={[
                { value: 'general', label: 'New to the subject' }, { value: 'familiar', label: 'Some background' }, { value: 'expert', label: 'Experienced' },
              ]} />
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
            <button type="button" disabled={locked} onClick={close}>
              {firstTour ? 'Read PDF first' : 'Cancel'}
            </button>
            <ActionButton busy={busy} label={busy ? 'Starting…' : 'Create tour'} disabled={locked || loading || !selected} />
          </footer>
        </form>
      )}
    </AnimatedDialog>
  );
}
