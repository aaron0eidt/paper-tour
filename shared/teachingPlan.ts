/** A source-grounded teaching decision, separate from its eventual narration or visual implementation. */
export const CONCEPT_ROLES = ['contribution', 'prerequisite', 'mechanism', 'evidence', 'limitation'] as const;
export const TEACHING_LEVELS = ['low', 'medium', 'high'] as const;
export type ConceptRole = (typeof CONCEPT_ROLES)[number];
export type TeachingLevel = (typeof TEACHING_LEVELS)[number];
export interface TeachingPreferences {
  structure: 'concepts' | 'overview' | 'paper';
  depth: 'quick' | 'standard' | 'deep';
  audience: 'general' | 'familiar' | 'expert';
  instructions: string;
}
export interface TeachingConcept {
  id: string;
  title: string;
  /** A source-grounded explanation addressed to the reader, distinct from instructions for the author. */
  summary: string;
  role: ConceptRole;
  evidence: string[];
  prerequisites: string[];
  importance: TeachingLevel;
  importanceReason: string;
  difficulty: TeachingLevel;
  difficultyReason: string;
  confidence: TeachingLevel;
  objective: string;
  misconception: string;
  visual: 'source' | 'new' | 'none';
  visualBenefit: string;
  visibleChange: string;
}
export interface TeachingPlan {
  version: 'teaching-plan@1';
  question: string;
  audienceAssumption: string;
  concepts: TeachingConcept[];
  sections: { sectionId: string; treatment: 'teach' | 'background' | 'omit'; reason: string }[];
}
