import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BBox, Doc, Tour } from '../../shared/paper';
import {
  ARC_SPECS,
  arcSchema,
  arcTask,
  arcTourPlan,
  cleanArcPlan,
  disclaimerOf,
  fallbackArcPlan,
  notAdvice,
  type ArcItem,
  type ArcType,
} from '../src/harness/arcs';
import { MAX_STEPS, PRESETS } from '../src/harness/beats';
import { cardSchema, type PaperCard } from '../src/harness/card';
import { DOC_TYPES, DOC_TYPE_HELP, TONE, type DocType } from '../src/harness/doctype';
import { cardTask } from '../src/harness/prompts';

// The kinds of document beyond papers, sheets and lectures: manuals, reports, articles, literature and health
// information. Each has a help text for the card call, a tone and an arc; the arc's disclaimer follows the kind.

const NEW_KINDS = ['manual', 'report', 'article', 'literature', 'medical'] as const;
const ARC_TYPES = DOC_TYPES.filter((t) => t !== 'research_paper' && t !== 'exercise_sheet') as ArcType[];

const rect: BBox = [50, 40, 500, 54];
const SENTENCES = Array.from({ length: 12 }, (_, i) => `p1.s${i + 1}`);

/** A one-page prose document with twelve sentences; no figures, so that nothing is a slide deck or a paper. */
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'doc.pdf', sha256: 'd'.repeat(64), num_pages: 1, generator: 'test', title: 'A document' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: SENTENCES.map((id, i) => ({
    id: `p1.b${i + 1}`,
    page: 1,
    type: 'paragraph' as const,
    bbox: rect,
    text: `Sentence number ${i + 1}.`,
    sentences: [id],
  })),
  sentences: SENTENCES.map((id, i) => ({
    id,
    page: 1,
    block: `p1.b${i + 1}`,
    text: `Sentence number ${i + 1}.`,
    rects: [rect],
  })),
  figures: [],
  equations: [],
};

const specOf = (type: ArcType, id: string) => ARC_SPECS[type].find((s) => s.id === id)!;
const point = (n: number) => ({ text: `Point ${n}.`, evidence: [SENTENCES[n % SENTENCES.length]] });
const card: PaperCard = {
  plan: 'p',
  doc_type: 'other',
  title: 'A guided tour',
  chapter_titles: { problem: 'a', idea: 'b', method: 'c', evidence: 'd', limits: 'e', takeaway: 'f' },
  problem: point(0),
  key_idea: point(1),
  method_steps: [point(2), point(3)],
  key_figures: [],
  key_formulas: [],
  results: [point(4), point(5)],
  limitations: [point(6)],
  takeaway: point(7),
  suggested_questions: ['What is it?', 'What next?', 'What is missing?'],
};

/** A plan with every chapter filled to the most the preset allows. */
const fullPlan = (type: ArcType, preset: (typeof PRESETS)[number], disclaimer?: string) => ({
  plan: 'p',
  titles: {},
  items: Object.fromEntries(
    ARC_SPECS[type].map((spec) => [spec.id, Array.from({ length: spec.max[preset] }, (_, i) => point(i))]),
  ) as Record<string, ArcItem[]>,
  ...(disclaimer ? { disclaimer } : {}),
});

test('every kind has a help text, a tone and an arc, and the five new kinds are among them', () => {
  for (const kind of NEW_KINDS) assert.ok(DOC_TYPES.includes(kind), kind);
  assert.equal(new Set(DOC_TYPES).size, DOC_TYPES.length, 'no kind is listed twice');
  assert.equal(DOC_TYPES.at(-1), 'other', 'the catch-all stays last');
  for (const type of DOC_TYPES) {
    assert.ok(DOC_TYPE_HELP[type].trim().length > 20 || type === 'other', `help for ${type}`);
    assert.ok(TONE[type].trim().length > 20, `tone for ${type}`);
  }
  assert.equal(new Set(DOC_TYPES.map((t) => TONE[t])).size, DOC_TYPES.length, 'no two kinds speak alike');
  assert.deepEqual(
    Object.keys(ARC_SPECS).sort(),
    [...ARC_TYPES].sort(),
    'an arc for every kind that is not a paper or sheet',
  );
});

test('the tones say who speaks and what stays exact', () => {
  assert.match(TONE.manual, /technician/i);
  assert.match(TONE.manual, /times, temperatures, settings, commands/);
  assert.match(TONE.report, /analyst/i);
  assert.match(TONE.report, /exactly as written/);
  assert.match(TONE.article, /neutral editor/i);
  assert.match(TONE.literature, /enthusiastic literature teacher/i);
  assert.match(TONE.literature, /never paraphrase the whole text/i);
  assert.match(TONE.medical, /calm/i);
  assert.match(TONE.medical, /exactly as written/);
  assert.match(TONE.medical, /doctor or pharmacist/);
});

test('every arc is valid: unique ids, an overview first, the takeaway last, sizes that grow with the preset', () => {
  for (const type of ARC_TYPES) {
    const specs = ARC_SPECS[type];
    const ids = specs.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${type}: ids are unique`);
    assert.equal(ids[0], 'overview', type);
    assert.equal(ids.at(-1), 'takeaway', `${type}: the takeaway is last`);
    assert.equal(specs.filter((s) => s.kind === 'takeaway').length, 1, type);
    for (const spec of specs) {
      assert.ok(spec.help.trim() && spec.title.trim(), `${type}.${spec.id}: help and title`);
      assert.ok(spec.min >= 0, `${type}.${spec.id}`);
      let before = 0;
      for (const preset of PRESETS) {
        assert.ok(spec.min <= spec.max[preset], `${type}.${spec.id} ${preset}: min ${spec.min} > max`);
        assert.ok(spec.max[preset] >= before, `${type}.${spec.id}: ${preset} allows fewer than a shorter preset`);
        before = spec.max[preset];
      }
    }
    for (const kind of ['overview', 'takeaway'] as const) {
      const spec = specs.find((s) => s.kind === kind)!;
      assert.equal(spec.min, 1, `${type}.${kind}`);
      assert.deepEqual(spec.max, { quick: 1, standard: 1, deep: 1 }, `${type}.${kind}`);
    }
  }
});

test('each new arc teaches what matters for its kind', () => {
  const spec = (type: ArcType, id: string) => ARC_SPECS[type].find((s) => s.id === id)!;
  const ids = (type: ArcType) => ARC_SPECS[type].map((s) => s.id);

  assert.deepEqual(ids('manual'), ['overview', 'parts', 'steps', 'warnings', 'reference', 'takeaway']);
  assert.equal(spec('manual', 'steps').board, 'flow', 'the first procedure is drawn as a flow');
  assert.match(spec('manual', 'steps').help, /times, temperatures, settings and commands/);
  assert.match(spec('manual', 'parts').help, /figures/);
  assert.equal(spec('manual', 'warnings').tint, 'orange');
  assert.match(spec('manual', 'warnings').help, /maximum ratings/);
  assert.equal(spec('manual', 'reference').min, 0);
  assert.match(spec('manual', 'reference').help, /troubleshooting.*specifications/);

  assert.deepEqual(ids('report'), ['overview', 'figures', 'drivers', 'risks', 'takeaway']);
  assert.equal(spec('report', 'figures').board, 'bars', 'the key numbers are compared as bars');
  assert.equal(spec('report', 'risks').tint, 'orange');
  assert.match(spec('report', 'overview').help, /period/);

  assert.deepEqual(ids('article'), ['overview', 'claims', 'voices', 'gaps', 'takeaway']);
  assert.match(spec('article', 'claims').help, /evidence/);
  assert.equal(spec('article', 'voices').min, 0);
  assert.equal(spec('article', 'gaps').min, 0);
  assert.equal(spec('article', 'gaps').tint, 'orange');

  assert.deepEqual(ids('literature'), ['overview', 'structure', 'devices', 'meaning', 'takeaway']);
  assert.equal(spec('literature', 'devices').tint, 'pink');
  assert.match(spec('literature', 'devices').help, /exact words/);
  assert.match(spec('literature', 'structure').help, /rhyme scheme, metre/);

  assert.deepEqual(ids('medical'), ['overview', 'values', 'effects', 'warnings', 'takeaway']);
  assert.equal(spec('medical', 'values').board, 'bars', 'values that compare are drawn as bars');
  assert.match(spec('medical', 'values').help, /reference range/);
  assert.match(spec('medical', 'effects').help, /frequency categories/);
  assert.equal(spec('medical', 'warnings').tint, 'pink');
  assert.match(spec('medical', 'warnings').help, /see a doctor/);
  assert.match(spec('medical', 'takeaway').help, /doctor or pharmacist/);

  // The boards stay on the chapters that name them; no other new chapter draws one.
  const boards = NEW_KINDS.flatMap((type) =>
    ARC_SPECS[type].filter((s) => s.board).map((s) => `${type}.${s.id}:${s.board}`),
  );
  assert.deepEqual(boards, ['manual.steps:flow', 'report.figures:bars', 'medical.values:bars']);
});

test('the card call names every kind and routes the neighbours', () => {
  const ids = doc.sentences.map((s) => s.id);
  const strict = cardSchema(doc, ids).properties.doc_type.enum as readonly string[];
  assert.deepEqual(strict, [...DOC_TYPES]);
  for (const kind of NEW_KINDS) assert.ok(strict.includes(kind), kind);
  assert.deepEqual(cardSchema(doc, ids, false).properties.doc_type.enum, [...DOC_TYPES]);

  const task = cardTask('en-US');
  for (const type of DOC_TYPES) assert.ok(task.includes(`   - ${type}: ${DOC_TYPE_HELP[type]}`), type);
  assert.match(DOC_TYPE_HELP.contract, /policy/);
  assert.match(DOC_TYPE_HELP.contract, /code of conduct/);
  assert.match(DOC_TYPE_HELP.letter, /form/);
  assert.match(DOC_TYPE_HELP.letter, /application/);
  assert.match(DOC_TYPE_HELP.lecture, /textbook chapter/);
  assert.match(DOC_TYPE_HELP.lecture, /lecture script/);
  assert.match(DOC_TYPE_HELP.manual, /datasheet/);
  assert.match(DOC_TYPE_HELP.manual, /API/);
  assert.match(DOC_TYPE_HELP.manual, /recipe/);
  assert.match(DOC_TYPE_HELP.report, /annual/);
  assert.match(DOC_TYPE_HELP.report, /lab/);
  assert.match(DOC_TYPE_HELP.article, /essay/);
  assert.match(DOC_TYPE_HELP.article, /blog post/);
  assert.match(DOC_TYPE_HELP.literature, /poem/);
  assert.match(DOC_TYPE_HELP.medical, /leaflet/);
  assert.match(DOC_TYPE_HELP.medical, /blood work/);
  // The plan call says what the document is with the same words: "It is ..." must read as a sentence.
  for (const type of ARC_TYPES)
    assert.ok(arcTask(type, 'en-US', 'standard').includes(`It is ${DOC_TYPE_HELP[type]}.`), type);
});

test('the tour contract lists the same kinds as the harness', () => {
  type Declared = NonNullable<Tour['doc_type']>;
  type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  const sameUnion: Equal<Declared, DocType> = true;
  assert.ok(sameUnion);
  const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../schema/tour.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.doc_type.enum, [...DOC_TYPES]);
});

test('the plan call lists each chapter with its size, and the exact values the kind must keep', () => {
  for (const type of ARC_TYPES) {
    const task = arcTask(type, 'en-US', 'standard');
    for (const spec of ARC_SPECS[type])
      assert.match(task, new RegExp(`- ${spec.id} \\(\\d(-\\d+)?\\): `), `${type}.${spec.id}`);
  }
  assert.match(arcTask('manual', 'en', 'standard'), /times, temperatures, settings/);
  assert.match(arcTask('report', 'en', 'standard'), /unit, currency and period/);
  assert.match(arcTask('article', 'en', 'standard'), /Attribute every claim/);
  assert.match(arcTask('literature', 'en', 'standard'), /Never retell or paraphrase the whole text/);
  assert.match(arcTask('medical', 'en', 'standard'), /frequency categories/);
  assert.match(arcTask('medical', 'en', 'standard'), /Never diagnose/);
  assert.doesNotMatch(arcTask('other', 'en', 'standard'), /Never diagnose|Attribute every claim/);
});

test('arcTourPlan builds the beats of every kind from a fallback card, for every preset', () => {
  for (const type of ARC_TYPES)
    for (const preset of PRESETS) {
      const plan = arcTourPlan(fallbackArcPlan(card, type), type, card, doc, preset, 'en');
      assert.equal(plan.type, type);
      assert.ok(plan.beats.length >= 3, `${type} ${preset}: ${plan.beats.length} beats`);
      assert.ok(plan.beats.length <= MAX_STEPS, `${type} ${preset}`);
      assert.equal(plan.beats[0].kind, 'overview', type);
      const last = plan.beats.at(-1)!;
      assert.equal(last.kind, 'takeaway', type);
      assert.deepEqual(last.questions, card.suggested_questions, `${type}: the closing step offers the questions`);
      assert.equal(new Set(plan.beats.map((b) => b.id)).size, plan.beats.length, `${type}: beat ids are unique`);
      const known = new Set(doc.sentences.map((s) => s.id));
      for (const beat of plan.beats) {
        assert.ok(beat.point && beat.evidence.length, `${type}: ${beat.id} points at the text`);
        assert.ok(
          beat.evidence.every((id) => known.has(id)),
          `${type}: ${beat.id}`,
        );
        assert.ok(
          plan.chapters.some((c) => c.id === beat.arc),
          `${type}: ${beat.id} has a chapter`,
        );
      }
      assert.ok(
        plan.chapters.every((c) => plan.beats.some((b) => b.arc === c.id)),
        `${type}: no empty chapter`,
      );
    }
});

test('the fallback puts the card’s items in the chapters that suit the kind', () => {
  const at = (type: ArcType) => fallbackArcPlan(card, type).items;
  const filled = (type: ArcType) =>
    Object.entries(at(type))
      .filter(([, list]) => list.length)
      .map(([id]) => id);
  assert.deepEqual(filled('manual'), ['overview', 'steps', 'warnings', 'reference', 'takeaway']);
  assert.deepEqual(filled('report'), ['overview', 'figures', 'drivers', 'risks', 'takeaway']);
  assert.deepEqual(filled('article'), ['overview', 'claims', 'gaps', 'takeaway']);
  assert.deepEqual(filled('literature'), ['overview', 'structure', 'devices', 'takeaway']);
  assert.deepEqual(filled('medical'), ['overview', 'values', 'effects', 'warnings', 'takeaway']);
  // The older kinds put the same items where they always did.
  assert.deepEqual(filled('contract'), ['overview', 'terms', 'risks', 'takeaway']);
  assert.deepEqual(filled('letter'), ['overview', 'actions', 'consequences', 'takeaway']);
  assert.deepEqual(filled('other'), ['overview', 'points', 'caveats', 'takeaway']);
  assert.deepEqual(filled('lecture'), ['overview', 'topics', 'takeaway']);
  assert.deepEqual(
    at('manual').steps.map((i) => i.text),
    ['Point 1.', 'Point 2.', 'Point 3.'],
  );
  assert.deepEqual(
    at('manual').warnings.map((i) => i.text),
    ['Point 6.'],
  );
});

test('a full plan fits the step budget of every preset, with each board on the first step of its chapter', () => {
  for (const type of ARC_TYPES)
    for (const preset of PRESETS) {
      const plan = arcTourPlan(fullPlan(type, preset), type, card, doc, preset, 'en');
      assert.ok(plan.beats.length <= MAX_STEPS, `${type} ${preset}: ${plan.beats.length}`);
      assert.equal(plan.beats.at(-1)!.kind, 'takeaway');
      for (const spec of ARC_SPECS[type].filter((s) => s.board && s.kind === 'point')) {
        const chapter = plan.beats.filter((b) => b.arc === spec.id);
        if (!chapter.length) continue;
        assert.equal(chapter[0].board, spec.board, `${type}.${spec.id} first step`);
        assert.ok(
          chapter.slice(1).every((b) => !b.board),
          `${type}.${spec.id}: only the first step draws it`,
        );
        if (spec.board === 'bars')
          assert.equal(
            chapter[0].boardEvidence?.length,
            chapter.flatMap((b) => b.evidence).length,
            `${type}.${spec.id}`,
          );
      }
    }
});

test('a kind’s tint colours its steps; chapter titles come from the plan or the arc', () => {
  const plan = arcTourPlan(fullPlan('medical', 'standard'), 'medical', card, doc, 'standard', 'en');
  assert.ok(plan.beats.filter((b) => b.arc === 'warnings').every((b) => b.tint === 'pink'));
  assert.ok(plan.beats.filter((b) => b.arc === 'effects').every((b) => b.tint === 'orange'));
  assert.deepEqual(
    plan.chapters.map((c) => c.title),
    ['Overview', 'Use and values', 'Effects and flags', 'When to be careful', 'Takeaway'],
  );
  const named = arcTourPlan(
    { ...fullPlan('literature', 'quick'), titles: { devices: 'The images' } },
    'literature',
    card,
    doc,
    'quick',
    'en',
  );
  assert.equal(named.chapters.find((c) => c.id === 'devices')!.title, 'The images');
  assert.equal(named.chapters.find((c) => c.id === 'structure')!.title, 'Structure');
});

test('the plan call’s schema and cleaning follow each arc', () => {
  const ids = doc.sentences.map((s) => s.id);
  for (const type of ARC_TYPES) {
    const schema = arcSchema(type, doc, ids, 'standard') as {
      required: string[];
      properties: Record<string, { minItems?: number; maxItems?: number }>;
    };
    for (const spec of ARC_SPECS[type]) {
      assert.ok(schema.required.includes(spec.id), `${type}.${spec.id} is required`);
      assert.equal(schema.properties[spec.id].minItems, spec.min, `${type}.${spec.id}`);
      assert.equal(schema.properties[spec.id].maxItems, spec.max.standard, `${type}.${spec.id}`);
    }
    assert.equal('disclaimer' in schema.properties, disclaimerOf(type) !== null, `${type}: disclaimer field`);
    assert.equal(schema.required.includes('disclaimer'), disclaimerOf(type) !== null, `${type}`);
    // An answer with the least each list needs is a plan; one list short is sent back with the problem.
    const answer = {
      plan: 'p',
      chapter_titles: Object.fromEntries(ARC_SPECS[type].map((s) => [s.id, 'Title'])),
      ...Object.fromEntries(
        ARC_SPECS[type].map((s) => [
          s.id,
          type === 'lecture' && s.id === 'topics'
            ? Array.from({ length: s.min }, () => ({ ...point(1), title: 'Topic', board: 'none', visual: '' }))
            : Array.from({ length: s.min }, () => point(1)),
        ]),
      ),
      ...(disclaimerOf(type) ? { disclaimer: 'Not advice.' } : {}),
    };
    if (type === 'lecture') delete (answer.chapter_titles as Record<string, string>).topics;
    const ok = cleanArcPlan(answer, type, doc, 'standard');
    assert.deepEqual(ok.problems, [], type);
    assert.ok(ok.plan, type);
    assert.equal(Boolean(ok.plan!.disclaimer), disclaimerOf(type) !== null, `${type}: the disclaimer is kept`);
    const required = ARC_SPECS[type].find((s) => s.min > 0 && s.kind === 'point')!;
    const short = cleanArcPlan({ ...answer, [required.id]: [] }, type, doc, 'standard');
    assert.equal(short.plan, null, `${type}.${required.id}`);
    assert.ok(short.problems.length, `${type}.${required.id}`);
  }
});

test('contract, medical and report tours carry a disclaimer in English and German; the other kinds carry none', () => {
  const expected: Record<string, { en: RegExp; de: RegExp }> = {
    contract: { en: /not legal advice/, de: /keine Rechtsberatung/ },
    medical: {
      en: /not medical advice.*doctor or pharmacist/,
      de: /keine medizinische Beratung.*Arzt oder Ihre Apotheke/,
    },
    report: { en: /not investment advice/, de: /keine Anlageberatung/ },
  };
  for (const type of ARC_TYPES) {
    const kind = disclaimerOf(type);
    for (const [language, key] of [
      ['en', 'en'],
      ['en-US', 'en'],
      ['de', 'de'],
      ['de-DE', 'de'],
    ] as const) {
      const frame = arcTourPlan(fallbackArcPlan(card, type), type, card, doc, 'standard', language).frame;
      if (expected[type]) {
        assert.ok(kind, type);
        assert.match(frame ?? '', expected[type][key], `${type} ${language}`);
        assert.equal(frame, notAdvice(language, kind), `${type} ${language}`);
      } else {
        assert.equal(kind, null, type);
        assert.equal(frame, undefined, `${type} ${language} has no frame`);
      }
    }
  }
  assert.deepEqual(
    ARC_TYPES.filter((t) => disclaimerOf(t)),
    ['contract', 'report', 'medical'],
  );
  for (const type of ['research_paper', 'exercise_sheet'] as const) assert.equal(disclaimerOf(type), null, type);
});

test('a disclaimer the plan worded wins; a kind without one ignores it', () => {
  const worded = 'Dies ist keine Beratung.';
  for (const type of ['contract', 'medical', 'report'] as const)
    assert.equal(arcTourPlan(fullPlan(type, 'quick', worded), type, card, doc, 'quick', 'de').frame, worded, type);
  for (const type of ['manual', 'article', 'literature', 'letter', 'other', 'lecture'] as const)
    assert.equal(arcTourPlan(fullPlan(type, 'quick', worded), type, card, doc, 'quick', 'de').frame, undefined, type);
});

test('a disclaimer that is missing or too long never costs the plan; the tour then uses the code’s sentence', () => {
  const answer = (type: ArcType, disclaimer?: unknown) => ({
    plan: 'p',
    chapter_titles: Object.fromEntries(ARC_SPECS[type].map((s) => [s.id, 'Title'])),
    ...Object.fromEntries(
      ARC_SPECS[type].map((s) => [s.id, Array.from({ length: Math.max(1, s.min) }, () => point(1))]),
    ),
    ...(disclaimer === undefined ? {} : { disclaimer }),
  });
  // A natural two-clause medical sentence is longer than the legal one and still fits.
  const natural =
    'Diese Tour erklärt nur, was im Dokument steht, und ersetzt keine medizinische Beratung; bei Fragen zu Ihrer eigenen Gesundheit wenden Sie sich bitte an Ihren Arzt oder Ihre Apotheke, bevor Sie etwas ändern.';
  assert.ok(natural.length > 200 && natural.length <= 300, `${natural.length} characters`);
  const kept = cleanArcPlan(answer('medical', natural), 'medical', doc, 'standard');
  assert.deepEqual(kept.problems, []);
  assert.equal(kept.plan!.disclaimer, natural);
  for (const bad of [undefined, 'x'.repeat(400), '   ', 7]) {
    const cleaned = cleanArcPlan(answer('medical', bad), 'medical', doc, 'standard');
    assert.deepEqual(cleaned.problems, [], String(bad).slice(0, 12));
    assert.ok(cleaned.plan, String(bad).slice(0, 12));
    assert.equal(cleaned.plan!.disclaimer, undefined);
    assert.equal(arcTourPlan(cleaned.plan!, 'medical', card, doc, 'standard', 'de').frame, notAdvice('de', 'medical'));
  }
  // The provider is still asked for it, with the same room.
  const provider = arcSchema('medical', doc, [], 'standard') as unknown as {
    required: string[];
    properties: { disclaimer: { maxLength: number } };
  };
  assert.ok(provider.required.includes('disclaimer'));
  assert.equal(provider.properties.disclaimer.maxLength, 300);
});

test('a quick tour of health information still names its effects and flagged values', () => {
  assert.equal(specOf('medical', 'effects').min, 0, 'nothing flagged is a valid answer');
  for (const preset of PRESETS) assert.ok(specOf('medical', 'effects').max[preset] >= 1, preset);
  const quick = arcSchema('medical', doc, [], 'quick') as unknown as { properties: { effects: { maxItems: number } } };
  assert.ok(quick.properties.effects.maxItems >= 1);
  assert.match(arcTask('medical', 'en', 'quick'), /- effects \([01]-[1-9]\)/);
  const plan = arcTourPlan(fullPlan('medical', 'quick'), 'medical', card, doc, 'quick', 'en');
  assert.ok(plan.beats.some((b) => b.arc === 'effects'));
});

test('a step of a manual may be a stage of consecutive steps, so a long procedure keeps its values', () => {
  const task = arcTask('manual', 'en', 'standard');
  assert.match(task, /one step, or a stage of consecutive steps, with all of its values/);
  assert.doesNotMatch(task, /one action/);
  assert.match(specOf('manual', 'steps').help, /one step or stage per item/);
});

test('the disclaimers exist in English, German, French, Spanish and Italian, and say what kind of advice it is not', () => {
  const words = {
    legal: /legal|Rechts|juridique|legale/i,
    medical: /medical|medizin|médical|médico|medica/i,
    investment: /investment|Anlage|investissement|inversión|finanziaria/i,
  };
  for (const kind of ['legal', 'medical', 'investment'] as const) {
    const texts = ['en', 'de', 'fr', 'es', 'it'].map((language) => notAdvice(language, kind));
    assert.equal(new Set(texts).size, 5, `${kind}: one text per language`);
    for (const text of texts) assert.match(text, words[kind], `${kind}: ${text}`);
    assert.equal(notAdvice('pt-BR', kind), notAdvice('en', kind), `${kind}: other languages get English`);
    assert.equal(notAdvice('FR-ca', kind), notAdvice('fr', kind), `${kind}: the region and case do not matter`);
  }
  assert.equal(notAdvice('en'), notAdvice('en', 'legal'), 'legal is the default');
  assert.equal(notAdvice('en'), 'This tour explains the document in plain words; it is not legal advice.');
  assert.match(notAdvice('fr', 'medical'), /médecin ou à votre pharmacien/);
  assert.match(notAdvice('es', 'medical'), /médico o farmacéutico/);
  assert.match(notAdvice('it', 'medical'), /medico o al farmacista/);
});

test('the plan call asks for the disclaimer of its kind only', () => {
  const task = (type: ArcType) => arcTask(type, 'de', 'standard');
  assert.match(
    task('contract'),
    /"disclaimer" is one short sentence in "de": this tour explains the document and is not legal advice\./,
  );
  assert.match(
    task('medical'),
    /"disclaimer" is one short sentence in "de": .*is not medical advice.*doctor or pharmacist/,
  );
  assert.match(task('report'), /"disclaimer" is one short sentence in "de": .*is not investment advice\./);
  for (const type of ARC_TYPES.filter((t) => !disclaimerOf(t))) assert.doesNotMatch(task(type), /disclaimer/, type);
});
