/** Reusable teaching instructions. A generated tour keeps an immutable effective snapshot. */
export const TOUR_STRUCTURES = ['concepts', 'overview', 'paper'] as const;
export const TOUR_DEPTHS = ['quick', 'standard', 'deep'] as const;
export const TOUR_AUDIENCES = ['general', 'familiar', 'expert'] as const;
export type TourStructure = (typeof TOUR_STRUCTURES)[number];
export type TourDepth = (typeof TOUR_DEPTHS)[number];
export type TourAudience = (typeof TOUR_AUDIENCES)[number];

export interface TourProfileDraft {
  name: string;
  structure: TourStructure;
  instructions: string;
  depth: TourDepth;
  audience: TourAudience;
}
export interface TourProfileSnapshot extends TourProfileDraft {
  id: string;
  revision: number;
}
export interface TourProfile extends TourProfileSnapshot {
  builtin: boolean;
}
export interface TourProfileSelection {
  profileId?: string;
  profileRevision?: number;
  depth?: TourDepth;
  audience?: TourAudience;
}
export interface TourProfileCatalog {
  profiles: TourProfile[];
  defaultDepth: TourDepth;
}

export const BUILTIN_TOUR_PROFILES: readonly TourProfile[] = [
  {
    id: 'concept-led',
    revision: 1,
    name: 'Concept-led',
    structure: 'concepts',
    instructions: '',
    depth: 'standard',
    audience: 'familiar',
    builtin: true,
  },
  {
    id: 'overview',
    revision: 1,
    name: 'Overview',
    structure: 'overview',
    instructions:
      'Prioritize the central contribution, essential prerequisites, main evidence and material limitations. Explain only the detail needed to understand that overview.',
    depth: 'standard',
    audience: 'familiar',
    builtin: true,
  },
  {
    id: 'paper-order',
    revision: 1,
    name: 'In paper order',
    structure: 'paper',
    instructions:
      'Follow this document’s actual sections and source order. Use its own section names. Explain important concepts where they occur, without inventing sections or skipping the method to repeat abstract claims.',
    depth: 'standard',
    audience: 'familiar',
    builtin: true,
  },
];
export const PROFILE_DESCRIPTIONS: Record<TourStructure, string> = {
  concepts: 'Connect the paper’s main ideas, mechanisms and evidence.',
  overview: 'Focus on the central contribution and what supports it.',
  paper: 'Follow the document’s own sections in their original order.',
};
export function validTourDepth(value: unknown): value is TourDepth {
  return TOUR_DEPTHS.includes(value as TourDepth);
}
export function profileSnapshot(
  profile: TourProfileSnapshot,
  selection: TourProfileSelection = {},
): TourProfileSnapshot {
  return {
    id: profile.id,
    revision: profile.revision,
    name: profile.name,
    structure: profile.structure,
    instructions: profile.instructions,
    depth: selection.depth ?? profile.depth,
    audience: selection.audience ?? profile.audience,
  };
}
export function sameTourProfile(a: TourProfileSnapshot | null | undefined, b: TourProfileSnapshot | null | undefined) {
  return JSON.stringify(a ? profileSnapshot(a) : null) === JSON.stringify(b ? profileSnapshot(b) : null);
}

/** Default concept-led runs retain their existing prompt; other preferences remain explicit and inspectable. */
export function tourProfileGuidance(profile?: TourProfileSnapshot | null): string {
  if (
    !profile ||
    (profile.structure === 'concepts' &&
      !profile.instructions &&
      profile.audience === 'familiar' &&
      profile.depth === 'standard')
  )
    return '';
  return `TEACHING PROFILE: ${JSON.stringify(profile)}. ${PROFILE_DESCRIPTIONS[profile.structure]} Apply these teaching preferences while preserving source grounding, mathematics and validation requirements. Depth changes the amount of explanation, not the correctness or importance of evidence. For a general audience introduce prerequisites and notation; for an expert audience omit elementary background.`;
}
