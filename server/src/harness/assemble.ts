import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { splitWords, type Action, type Color, type Doc, type Step, type Tour } from '../../../shared/paper';
import { ROOT } from '../config';
import { indexElements } from '../elements';
import type { Beat, BeatKind, Preset } from './beats';
import { ARCS, type PaperCard } from './card';
import type { BeatTargets, Direction } from './direct';

const COLORS: Record<BeatKind, Color> = {
  problem: 'yellow',
  idea: 'yellow',
  method: 'blue',
  figure: 'blue',
  formula: 'blue',
  result: 'green',
  limitation: 'orange',
  takeaway: 'yellow',
};

/** Word index of an anchor phrase in `say`: the first exact match, else the best match of at least two words, else 0. */
export function anchorWord(say: string, anchor: string): number {
  const token = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const words = splitWords(say).map(token);
  const phrase = splitWords(anchor).map(token).filter(Boolean);
  let best = 0,
    bestScore = 0;
  for (let i = 0; i < words.length && bestScore < phrase.length; i++) {
    let score = 0;
    for (let k = 0; k < phrase.length && i + k < words.length; k++) if (words[i + k] === phrase[k]) score++;
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return phrase.length && bestScore >= Math.min(2, phrase.length) ? best : 0;
}

function elementName(beat: Beat, doc: Doc): string {
  const figure = doc.figures.find((f) => f.id === beat.target);
  if (figure) return `${figure.kind === 'table' ? 'Table' : 'Figure'} ${figure.number}`;
  const equation = doc.equations.find((e) => e.id === beat.target);
  return equation ? `Equation ${equation.number}` : '';
}

/** One tour step from a beat and its direction; without a direction, the card's own words with a single pointer. */
export function beatStep(beat: Beat, targets: BeatTargets, direction: Direction | null, doc: Doc, used: Set<string>): Step {
  const name = elementName(beat, doc);
  const say = direction?.say ?? (name ? `Let's look at ${name}. ${beat.point}` : beat.point);
  const words = splitWords(say).length;
  const actions: Action[] = [beat.target ? { type: 'zoom', target: beat.target } : { type: 'focus', target: beat.evidence[0] }];
  let highlights = 0;
  for (const cue of direction?.cues ?? []) {
    const at = Math.min(anchorWord(say, cue.anchor), words - 1);
    const timing = at > 0 ? { at_word: at } : {};
    if (cue.action === 'highlight') {
      if (highlights >= 2 || used.has(cue.target)) continue;
      highlights++;
      used.add(cue.target);
      actions.push({ type: 'highlight', targets: [cue.target], color: COLORS[beat.kind], ...timing });
    } else if (cue.action === 'box') {
      const label = cue.label.trim().split(/\s+/).slice(0, 4).join(' ');
      actions.push({ type: 'box', target: cue.target, color: 'orange', ...(label ? { label } : {}), ...timing });
    } else if (cue.action === 'spotlight') actions.push({ type: 'spotlight', target: cue.target, ...timing });
    else actions.push({ type: 'note', anchor: cue.target, text: cue.label.trim().slice(0, 140), ...timing });
  }
  // Pointing is the point: a text step always marks its main sentence, a figure step outlines its figure.
  if (!beat.target && !highlights) {
    const first = beat.evidence.find((id) => !used.has(id) && targets.sentences.includes(id));
    if (first) {
      used.add(first);
      actions.push({ type: 'highlight', targets: [first], color: COLORS[beat.kind] });
    }
  }
  if (beat.target && actions.length === 1) actions.push({ type: 'box', target: beat.target, color: 'orange' });
  return { id: beat.id, say, actions };
}

export function assembleTour(
  card: PaperCard,
  beats: Beat[],
  steps: Step[],
  doc: Doc,
  documentId: string,
  language: string,
  preset: Preset,
): Tour {
  const chapters = ARCS.map((arc) => ({
    id: arc,
    title: card.chapter_titles[arc],
    steps: beats.flatMap((beat, i) => (beat.arc === arc ? [steps[i]] : [])),
  })).filter((chapter) => chapter.steps.length);
  return {
    schema: 'paper-tour/tour@0.1',
    title: card.title,
    paper: documentId,
    doc_sha256: doc.source.sha256,
    level: 'grad',
    voices: { host: { lang: language, rate: 1 } },
    chapters,
    preset,
    ...(card.suggested_questions.length ? { suggested_questions: card.suggested_questions } : {}),
  };
}

const canonical = JSON.parse(readFileSync(resolve(ROOT, 'schema/tour.schema.json'), 'utf8'));
const checkCanonical = new Ajv2020({ strict: false, allErrors: true }).compile(canonical);

/** Contract problems: the canonical schema, real element IDs and at_word within each narration. */
export function tourProblems(tour: Tour, doc: Doc): string[] {
  const problems = checkCanonical(tour)
    ? []
    : (checkCanonical.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`);
  const ids = new Set(indexElements(doc).map((e) => e.id));
  for (const step of tour.chapters.flatMap((c) => c.steps)) {
    const words = splitWords(step.say).length;
    for (const action of step.actions) {
      const used = 'target' in action ? [action.target] : 'targets' in action ? action.targets : 'anchor' in action ? [action.anchor] : [];
      for (const id of used) if (!ids.has(id)) problems.push(`${step.id}: unknown element ${id}`);
      if (action.at_word !== undefined && action.at_word >= words) problems.push(`${step.id}: at_word past the narration`);
    }
  }
  return problems;
}
