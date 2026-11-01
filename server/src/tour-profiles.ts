import { randomUUID } from 'node:crypto';
import {
  BUILTIN_TOUR_PROFILES,
  profileSnapshot,
  TOUR_AUDIENCES,
  TOUR_DEPTHS,
  TOUR_STRUCTURES,
  validTourDepth,
} from '../../shared/tourProfiles';
import type {
  TourDepth,
  TourProfile,
  TourProfileDraft,
  TourProfileSelection,
  TourProfileSnapshot,
} from '../../shared/tourProfiles';
import type { Database, Db } from './db';
import { HttpError, missing } from './errors';

export function profileDraft(value: TourProfileDraft): TourProfileDraft {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.trim().length > 80 ||
    typeof value.instructions !== 'string' ||
    value.instructions.length > 6000 ||
    !TOUR_STRUCTURES.includes(value.structure) ||
    !TOUR_DEPTHS.includes(value.depth) ||
    !TOUR_AUDIENCES.includes(value.audience)
  )
    throw new HttpError(400, 'invalid_tour_profile', 'Choose a name, structure, depth and audience for the profile.');
  return {
    name: value.name.trim(),
    instructions: value.instructions.trim(),
    structure: value.structure,
    depth: value.depth,
    audience: value.audience,
  };
}
export class TourProfileStore {
  constructor(
    private readonly db: Database,
    readonly defaultDepth: TourDepth = validTourDepth(process.env.TOUR_PRESET) ? process.env.TOUR_PRESET : 'standard',
  ) {}
  async list(owner: string) {
    const { rows } = await this.db.query(
      'select p.id,p.current_revision as revision,r.definition from tour_profiles p join tour_profile_revisions r on r.profile_id=p.id and r.revision=p.current_revision where p.owner_id=$1 order by p.updated_at desc,p.id',
      [owner],
    );
    return {
      profiles: [
        ...BUILTIN_TOUR_PROFILES,
        ...rows.map((r): TourProfile => ({ ...r.definition, id: r.id, revision: r.revision, builtin: false })),
      ],
      defaultDepth: this.defaultDepth,
    };
  }
  async resolve(
    owner: string,
    selection: TourProfileSelection = {},
    db: Db = this.db.pool,
  ): Promise<TourProfileSnapshot> {
    if (
      (selection.depth !== undefined && !validTourDepth(selection.depth)) ||
      (selection.audience !== undefined && !TOUR_AUDIENCES.includes(selection.audience)) ||
      (selection.profileRevision !== undefined &&
        (!Number.isSafeInteger(selection.profileRevision) || selection.profileRevision < 1))
    )
      throw new HttpError(400, 'invalid_tour_profile', 'Choose an available depth and audience.');
    const id = selection.profileId ?? 'concept-led';
    const builtin = BUILTIN_TOUR_PROFILES.find((p) => p.id === id);
    if (builtin) {
      if (selection.profileRevision !== undefined && selection.profileRevision !== builtin.revision) return missing();
      return profileSnapshot(builtin, { ...selection, depth: selection.depth ?? this.defaultDepth });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return missing();
    const {
      rows: [row],
    } = await db.query(
      'select p.id,r.revision,r.definition from tour_profiles p join tour_profile_revisions r on r.profile_id=p.id and r.revision=coalesce($3,p.current_revision) where p.id=$1 and p.owner_id=$2',
      [id, owner, selection.profileRevision ?? null],
    );
    if (!row) return missing();
    return profileSnapshot({ ...row.definition, id: row.id, revision: row.revision }, selection);
  }
  async create(owner: string, input: TourProfileDraft): Promise<TourProfile> {
    const definition = profileDraft(input),
      id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.query('insert into tour_profiles(id,owner_id) values($1,$2)', [id, owner]);
      await tx.query('insert into tour_profile_revisions(profile_id,revision,definition) values($1,1,$2)', [
        id,
        definition,
      ]);
    });
    return { ...definition, id, revision: 1, builtin: false };
  }
  async revise(owner: string, id: string, expectedRevision: number, input: TourProfileDraft): Promise<TourProfile> {
    const definition = profileDraft(input);
    return this.db.transaction(async (tx) => {
      const {
        rows: [row],
      } = await tx.query('select current_revision from tour_profiles where id=$1 and owner_id=$2 for update', [
        id,
        owner,
      ]);
      if (!row) return missing();
      if (row.current_revision !== expectedRevision)
        throw new HttpError(
          409,
          'profile_changed',
          'This profile changed elsewhere. Reload it before saving another revision.',
        );
      const revision = row.current_revision + 1;
      await tx.query('insert into tour_profile_revisions(profile_id,revision,definition) values($1,$2,$3)', [
        id,
        revision,
        definition,
      ]);
      await tx.query('update tour_profiles set current_revision=$2,updated_at=now() where id=$1', [id, revision]);
      return { ...definition, id, revision, builtin: false };
    });
  }
}
