import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BBox, Doc, Step } from '../../shared/paper';
import type { RegionSelection } from '../../shared/selection';
import { MuseClient } from '../src/muse/client';
import type { MuseConfig } from '../src/config';
import { answerQuestion, askContext, namedElements, retrieve, type AskRequest } from '../src/harness/ask';

// A learner who points at something (a selected region, the figure on screen) is asking about that, not about what the
// tour was saying: the selection's own text drives the search, and a question without a topic leaves out the narration
// and the earlier answers.

const PAGE = { width: 600, height: 800 };
type Piece = string[] | { equation: string; number: string };

/** A small paper-like document: pieces run down each page, sentences are one line each, the figure sits at the bottom. */
function makeDoc(
  pages: Piece[][],
  extra: { figure?: { caption: string; labels: string[]; citedBy: string }; table?: string; section?: string } = {},
): Doc {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'doc.pdf', sha256: 'd'.repeat(64), num_pages: pages.length, generator: 'test', title: 'Synthetic' },
    pages: pages.map((_, i) => ({ n: i + 1, ...PAGE })),
    sections: [],
    blocks: [],
    sentences: [],
    figures: [],
    equations: [],
  };
  pages.forEach((pieces, p) => {
    const page = p + 1;
    let y = 60;
    let s = 0;
    let b = 0;
    for (const piece of pieces) {
      const block = `p${page}.b${++b}`;
      if (Array.isArray(piece)) {
        const ids = piece.map((text, i) => {
          const id = `p${page}.s${++s}`;
          doc.sentences.push({ id, page, block, text, rects: [[50, y + 20 * i, 550, y + 20 * i + 14]] });
          return id;
        });
        doc.blocks.push({
          id: block,
          page,
          type: 'paragraph',
          bbox: [50, y, 550, y + 20 * piece.length],
          text: piece.join(' '),
          sentences: ids,
        });
        y += 20 * piece.length + 30;
      } else {
        const bbox: BBox = [100, y, 400, y + 20];
        doc.blocks.push({ id: block, page, type: 'equation', bbox, text: piece.equation, sentences: [] });
        doc.equations.push({ id: `eq${piece.number}`, number: piece.number, page, bbox, block, text: piece.equation });
        y += 50;
      }
    }
  });
  const { figure } = extra;
  if (figure) {
    const bbox: BBox = [100, 480, 500, 680];
    figure.labels.forEach((text, i) =>
      doc.blocks.push({
        id: `p1.f${i + 1}`,
        page: 1,
        type: 'figure_text',
        bbox: [120, 500 + 30 * i, 260, 520 + 30 * i],
        text,
        sentences: [],
      }),
    );
    doc.figures.push({
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox,
      caption: figure.caption,
      image: 'figures/fig1.png',
      panels: [],
      referenced_by: [figure.citedBy],
    });
  }
  if (extra.table)
    doc.figures.push({
      id: 'tab1',
      kind: 'table',
      number: '1',
      page: 2,
      bbox: [100, 300, 500, 400],
      caption: extra.table,
      image: 'figures/tab1.png',
      panels: [],
      referenced_by: [],
    });
  if (extra.section)
    doc.sections.push({ id: 'sec-2', number: '2', title: extra.section, level: 1, page: 2, block: 'p2.b1' });
  return doc;
}

const english = makeDoc(
  [
    [
      [
        'Heat pumps move thermal energy from a cold place to a warm one using a refrigerant cycle.',
        'Figure 1 shows the four components of the cycle: evaporator, compressor, condenser and expansion valve.',
      ],
      ['The compressor raises the pressure and the temperature of the refrigerant.'],
      ['The coefficient of performance is the heat delivered divided by the electrical work, as Equation 1 states.'],
      { equation: 'COP = Q_h / W', number: '1' },
      ['Here Q_h is the heat delivered and W is the electrical work.'],
      [
        'Defrosting is needed when ice forms on the outdoor coil in cold humid weather.',
        'Ground source systems avoid defrosting because the soil stays warm all winter.',
      ],
    ],
    [
      [
        'Inverter drives let the compressor run at partial load, which saves energy.',
        'A buffer tank reduces how often the compressor starts and stops.',
      ],
      ['Noise from the fan limits where an outdoor unit may be placed.'],
    ],
  ],
  {
    figure: {
      caption: 'Figure 1: The refrigerant cycle with evaporator, compressor, condenser and expansion valve.',
      labels: ['Evaporator', 'Compressor', 'Condenser', 'Expansion valve'],
      citedBy: 'p1.s2',
    },
    table: 'Table 1: Typical coefficients of performance by source.',
    section: 'Operation',
  },
);

const german = makeDoc([
  [
    ['Der Mieter zahlt die Miete bis zum dritten Werktag eines Monats.'],
    ['Die Kaution darf höchstens das Dreifache der Monatsmiete betragen.'],
    ['Der Vermieter muss die Kaution getrennt von seinem Vermögen anlegen.'],
    ['Schönheitsreparaturen sind nur wirksam vereinbart, wenn die Wohnung renoviert übergeben wurde.'],
    ['Die Kündigungsfrist für den Mieter beträgt drei Monate.'],
    ['Eine Erhöhung der Miete ist nur bis zur ortsüblichen Vergleichsmiete zulässig.'],
    ['Die Kaution wird nach dem Ende des Mietverhältnisses verzinst zurückgezahlt.'],
  ],
]);

/** The step that was on screen: about something else than what the learner selects below. */
const stepAbout = (say: string, target: string): Step => ({
  id: 'last',
  say,
  actions: [
    { type: 'focus', target },
    { type: 'highlight', targets: [target] },
  ],
});
const defrost = stepAbout(
  'Defrosting is needed when ice forms on the outdoor coil in cold humid weather. What would you like to explore next, for example why noise from the fan limits where an outdoor unit may be placed?',
  'p1.s6',
);
const kuendigung = stepAbout(
  'Die Kündigungsfrist beträgt drei Monate. Als Nächstes siehst du, wie die Miete erhöht werden darf.',
  'p1.s5',
);

/** An earlier exchange that has nothing to do with the heat pump's figure. */
const unrelated = [{ question: 'Where may the unit stand?', answer: 'Noise from the fan limits the placement.' }];

/** The region around a figure, an equation or a sentence of a document, as the reader sends it. */
function around(doc: Doc, id: string): RegionSelection {
  const sentence = doc.sentences.find((s) => s.id === id);
  const found = sentence ?? doc.figures.find((f) => f.id === id) ?? doc.equations.find((e) => e.id === id);
  assert.ok(found, id);
  const [x0, y0, x1, y1] = sentence ? sentence.rects[0] : (found as { bbox: BBox }).bbox;
  const page = doc.pages.find((p) => p.n === found.page)!;
  return { page: page.n, rect: [x0 / page.width, y0 / page.height, x1 / page.width, y1 / page.height] };
}

const ids = (passages: { id: string }[]) => passages.map((p) => p.id);
const everything = (r: ReturnType<typeof retrieve>) => [...r.focus, ...r.ranked];

test('a selected figure is explained from its own caption, labels and citing sentences, not from the narration', () => {
  const selection = around(english, 'fig1');
  for (const question of ['explain', 'what is this?', 'Erkläre', 'warum?', 'was heißt das?', 'Explain this figure']) {
    const r = retrieve(english, { question, selection }, defrost);
    assert.deepEqual(ids(r.focus.slice(0, 2)), ['fig1', 'p1.s2'], question);
    assert.ok(r.pointing?.bare, question);
    assert.ok(ids(r.ranked).includes('p1.s3'), `${question}: the compressor sentence shares the figure's words`);
    for (const id of ['p2.s3', 'p1.s6']) assert.ok(!ids(everything(r)).includes(id), `${question}: ${id} is narration`);
    assert.equal(r.narration, '', question);
  }
  // The narration still drives a question when the learner points at nothing.
  assert.ok(ids(retrieve(english, { question: 'Erkläre' }, defrost).ranked).includes('p2.s3'));
});

test('the figure on screen is what a bare question asks about, and the narration drops out the same way', () => {
  const r = retrieve(english, { question: 'explain', figureId: 'fig1' }, defrost);
  assert.deepEqual(ids(r.focus), ['fig1', 'p1.s2']);
  assert.equal(r.pointing?.bare, true);
  assert.ok(!ids(everything(r)).includes('p2.s3'));
  assert.deepEqual(r, retrieve(english, { question: 'explain', figureId: 'fig1' }), 'the step changes nothing');
});

test('a question with a topic of its own is led by it, and the selection only tips the ranking', () => {
  const selection = around(english, 'fig1');
  const r = retrieve(
    english,
    { question: 'Why does noise limit the placement of the outdoor unit?', selection },
    defrost,
  );
  assert.equal(r.pointing?.bare, false);
  assert.equal(r.ranked[0].id, 'p2.s3');
  assert.deepEqual(ids(r.focus.slice(0, 2)), ['fig1', 'p1.s2'], 'the selection stays in focus');
  const foreign = retrieve(english, { question: 'Erkläre die Verdichtung', selection }, defrost);
  assert.equal(foreign.pointing?.bare, false, 'a word the document never uses may be a topic in another language');
});

test('a selected sentence or equation is explained from itself and the sentences around it', () => {
  const sentence = retrieve(english, { question: 'what is this?', selection: around(english, 'p1.s3') }, defrost);
  assert.ok(sentence.pointing?.bare);
  assert.equal(sentence.focus[0].id, 'p1.s3');
  assert.ok(ids(sentence.ranked).includes('p1.s2'), 'the figure sentence shares the compressor');
  assert.ok(!ids(everything(sentence)).includes('p2.s3'));

  const equation = retrieve(english, { question: 'explain', selection: around(english, 'eq1') }, defrost);
  assert.equal(equation.focus[0].id, 'eq1');
  assert.ok(ids(equation.ranked).includes('p1.s4'), 'the sentence before the display says what it computes');
  assert.ok(!ids(everything(equation)).includes('p2.s3'));
});

test('a bare question in German selects the same way on a German document', () => {
  const selection = around(german, 'p1.s2');
  for (const question of [
    'Erkläre',
    'Was heißt das?',
    'warum?',
    'Wie funktioniert das?',
    'Erkläre das bitte genauer',
  ]) {
    const r = retrieve(german, { question, selection }, kuendigung);
    assert.ok(r.pointing?.bare, question);
    assert.equal(r.focus[0].id, 'p1.s2');
    assert.ok(['p1.s3', 'p1.s7'].includes(r.ranked[0].id), `${question}: ${r.ranked[0].id}`);
    assert.ok(!ids(everything(r)).includes('p1.s6'), `${question}: the rent increase is narration`);
    assert.equal(r.narration, '', question);
  }
  // Without the selection the narration decides, as before.
  assert.ok(ids(everything(retrieve(german, { question: 'Erkläre' }, kuendigung))).includes('p1.s6'));
});

test('a question without a topic is recognised in the languages learners ask in', () => {
  const selection = around(english, 'fig1');
  const bare = (question: string) => retrieve(english, { question, selection }).pointing?.bare;
  for (const question of [
    'Erkläre',
    'Was ist das?',
    'Wozu dient das?',
    'Fasse das zusammen',
    "Qu'est-ce que c'est ?",
    '¿Qué es esto?',
    'Cosa significa?',
    'O que é isto?',
    'Wat betekent dit?',
    'What am I looking at?',
    'how does this work?',
    'Explain how many?',
  ])
    assert.equal(bare(question), true, question);
  for (const question of [
    'Why is the fan loud?',
    'Erkläre den Kompressor',
    'Was ist ein Verdampfer?',
    'and why is it bigger?',
    'Explain Figure 2',
    'Erkläre Abbildung 2',
    'What does Table 1 compare?',
  ])
    assert.equal(bare(question), false, question);
});

test('German names for figures, tables, equations and sections are named elements', () => {
  assert.deepEqual(namedElements(english, 'Erkläre Abbildung 1'), ['fig1']);
  assert.deepEqual(namedElements(english, 'Was zeigt Abb. 1?'), ['fig1']);
  assert.deepEqual(namedElements(english, 'Was steht in Tabelle 1?'), ['tab1']);
  assert.deepEqual(namedElements(english, 'Wie kommt Gleichung 1 zustande?'), ['eq1']);
  assert.deepEqual(namedElements(english, 'Was steht in Abschnitt 2?'), ['sec-2']);
  assert.deepEqual(namedElements(english, 'Figure 1 and table 1'), ['fig1', 'tab1']);
  const r = retrieve(english, { question: 'Erkläre Tabelle 1', selection: around(english, 'fig1') }, defrost);
  assert.ok(ids(r.focus).includes('tab1'), 'the table the question names comes into focus beside the selection');
});

const HEAT = 'How does a heat pump manage that?';

test('the narration counts when it is about the selection, and its sentences that overlap it otherwise', () => {
  const selection = around(english, 'p1.s3');
  const about = stepAbout('The compressor raises the pressure of the refrigerant. Next, defrosting.', 'p1.s3');
  const r = retrieve(english, { question: HEAT, selection }, about);
  assert.equal(r.narration, about.say, 'the step points at the selected sentence');
  const mixed = stepAbout(
    'Defrosting is needed when ice forms on the outdoor coil. The compressor raises the temperature. Noise from the fan limits placement.',
    'p1.s6',
  );
  assert.equal(
    retrieve(english, { question: HEAT, selection }, mixed).narration,
    'The compressor raises the temperature.',
  );
  // A question that builds on what was said brings all of it back.
  const back = retrieve(english, { question: 'And what did you mean by defrosting?', selection }, mixed);
  assert.equal(back.narration, mixed.say);
  assert.ok(ids(back.focus).includes('p1.s6'));
});

test('earlier answers and the narration are left out of a question without a topic, and kept for one that has', () => {
  const selection = around(english, 'fig1');
  const history = [
    { question: 'What does the compressor do?', answer: 'It raises the pressure of the refrigerant.' },
    { question: 'Why do inverter drives save energy?', answer: 'They let the compressor run at partial load.' },
  ];
  assert.deepEqual(retrieve(english, { question: 'explain', selection, history }).history, []);
  // Whatever language the earlier answer is in: nothing of it is compared with the selection.
  assert.deepEqual(retrieve(english, { question: 'Und warum?', selection, history: unrelated }).history, []);
  const asks = retrieve(english, { question: 'Why is the fan loud?', selection, history: unrelated });
  assert.deepEqual(asks.history, unrelated, 'a question with a topic of its own may build on the exchange');
  assert.ok(ids(asks.ranked).includes('p2.s3'));
  // Saying so outright brings the conversation back, with or without a topic of its own.
  assert.deepEqual(retrieve(english, { question: 'what did you say?', selection, history }).history, history);
  // Without a selection nothing changes: the last exchange stays in the search.
  assert.deepEqual(retrieve(english, { question: 'explain', history: unrelated }).history, unrelated);
});

test('a question without a topic asks about the selection, however it opens', () => {
  const selection = around(english, 'fig1');
  for (const question of [
    'And what is this?',
    'And?',
    'and why?',
    'But why?',
    'Und was ist das?',
    'Und warum?',
    'Aber warum?',
    'Et pourquoi ?',
    'Y por qué?',
  ]) {
    const r = retrieve(english, { question, selection, history: unrelated }, defrost);
    assert.ok(r.pointing?.bare, question);
    assert.equal(r.pointing?.onStep, false, question);
    assert.equal(r.narration, '', question);
    assert.deepEqual(r.history, [], question);
    assert.deepEqual(
      r,
      retrieve(english, { question, selection }),
      `${question}: the step and the history change nothing`,
    );
    for (const id of ['p2.s3', 'p1.s6']) assert.ok(!ids(everything(r)).includes(id), `${question}: ${id} is narration`);
  }
  const german = retrieve(english, { question: 'Und warum?', selection: around(english, 'p1.s3') }, defrost);
  assert.equal(german.focus[0].id, 'p1.s3');
  assert.ok(!ids(everything(german)).includes('p1.s6'));
});

test('only a reference to the conversation brings it back: "you said", not "earlier"', () => {
  const selection = around(english, 'fig1');
  const older = { question: 'Where may the unit stand?', answer: 'Noise from the fan limits the placement.' };
  const last = { question: 'Why is defrosting needed?', answer: 'Ice forms on the outdoor coil.' };
  for (const question of [
    'What did you say earlier about defrosting?',
    'what did you say just now?',
    'And what did you mean by defrosting?',
    'Why is your last answer so short?',
    'Was meintest du vorhin?',
    'Du hast gesagt, es friert ein. Warum?',
    'Deine Antwort verstehe ich nicht.',
  ]) {
    const recall = retrieve(english, { question, selection, history: [older, last] }, defrost);
    assert.equal(recall.narration, defrost.say, question);
    assert.deepEqual(recall.history, [older, last], question);
    assert.equal(recall.pointing?.bare, false, question);
    assert.ok(ids(recall.focus).includes('p1.s6'), question);
  }
  // Papers say earlier, previously and zuvor all the time.
  for (const question of [
    'How is this different from earlier models?',
    'How does it differ from previously proposed cycles?',
    'Wie unterscheidet sich das von zuvor genutzten Verdichtern?',
    'Was war vorher anders bei der Kaution?',
  ]) {
    const r = retrieve(english, { question, selection, history: [older, last] }, defrost);
    assert.equal(r.narration, '', question);
    assert.ok(!ids(r.focus).includes('p1.s6'), question);
  }
});

test('an anaphoric sentence that was selected keeps the sentence it refers back to', () => {
  const doc = makeDoc([
    [
      ['The pump circulates the water through the pipes.'],
      ['A leak lets the gas escape slowly.'],
      ['This is why installers check the pressure yearly.'],
      ['Sensors log the temperature of the return line.'],
    ],
  ]);
  const r = retrieve(doc, { question: 'what is this?', selection: around(doc, 'p1.s3') });
  assert.equal(r.focus[0].id, 'p1.s3');
  assert.ok(ids(r.ranked).includes('p1.s2'), 'the leak is what "this" refers to');
});

test('a word of the document is not a request word: "die" is a noun in an English text', () => {
  const dice = makeDoc([
    [
      ['Roll the die twice and write down both numbers.'],
      ['A loaded die lands on six far more often than chance allows.'],
      ['The fan limits where an outdoor unit may be placed.'],
    ],
  ]);
  const r = retrieve(dice, { question: 'explain', selection: around(dice, 'p1.s1') });
  assert.equal(ids(r.ranked)[0], 'p1.s2', 'the other sentence about a die');
  // The same word is an article in a German text and tells nothing there.
  const renovated = retrieve(german, { question: 'Erkläre', selection: around(german, 'p1.s4') });
  assert.ok(!ids(renovated.ranked).includes('p1.s1'), 'the sentence on the rent shares nothing with it but an article');
});

test('beside the figure the camera shows, a bare question leaves out the step, even one about that figure', () => {
  const about = stepAbout(
    'The cycle has four components. The compressor raises the pressure of the refrigerant.',
    'fig1',
  );
  const request: AskRequest = { question: 'warum?', figureId: 'fig1', stepId: 'last' };
  for (const step of [about, defrost]) {
    const r = retrieve(english, request, step);
    assert.ok(r.pointing?.bare && !r.pointing.onStep);
    assert.equal(r.narration, '');
    const prompt = askContext(request, r, english, step);
    assert.match(prompt, /it asks about the figure or equation on screen\. Explain that\./);
    assert.ok(!prompt.includes('THE TOUR WAS SAYING'));
  }
  // With a topic of its own, a step about the figure is what the question builds on.
  const topical = retrieve(english, { question: 'Why does the compressor matter?', figureId: 'fig1' }, about);
  assert.equal(topical.narration, about.say);
});

test('the boards of an unrelated tour step are named without their topics when the question is about a selection', () => {
  const shown = [
    { kind: 'scatter' as const, title: 'Defrost cycles against outdoor temperature', signature: 'a' },
    { kind: 'formula' as const, title: 'Coefficient of performance', signature: 'b' },
  ];
  const selection = around(english, 'fig1');
  const request: AskRequest = { question: 'Erkläre', selection, stepId: 'last' };
  const apart = askContext(request, retrieve(english, request, defrost), english, defrost, undefined, shown);
  assert.match(apart, /BOARDS THE TOUR JUST SHOWED: scatter; formula\. Do not draw the same board again/);
  assert.ok(!apart.includes('Defrost cycles'));
  // The step is about what they selected and the question has a topic, or it asks about nothing in particular: its boards
  // are what the question builds on.
  const on = stepAbout('The cycle has four components.', 'fig1');
  const topical: AskRequest = { question: 'Why is the compressor needed?', selection, stepId: 'last' };
  const same = askContext(topical, retrieve(english, topical, on), english, on, undefined, shown);
  assert.match(
    same,
    /BOARDS THE TOUR JUST SHOWED: scatter "Defrost cycles against outdoor temperature"; formula "Coeff/,
  );
  const free: AskRequest = { question: 'Erkläre', stepId: 'last' };
  assert.match(
    askContext(free, retrieve(english, free, defrost), english, defrost, undefined, shown),
    /scatter "Defrost cycles/,
  );
});

test('a narration sentence is not cut after an abbreviation', () => {
  const selection = around(english, 'fig1');
  const abbreviated = stepAbout(
    'Fig. 1 shows the compressor and the condenser. Defrosting is needed in cold weather.',
    'p1.s6',
  );
  assert.equal(
    retrieve(english, { question: HEAT, selection }, abbreviated).narration,
    'Fig. 1 shows the compressor and the condenser.',
  );
  const eg = stepAbout(
    'Cycles differ, e.g. Heat pumps use a compressor. Defrosting is needed in cold weather.',
    'p1.s6',
  );
  assert.equal(
    retrieve(english, { question: HEAT, selection }, eg).narration,
    'Cycles differ, e.g. Heat pumps use a compressor.',
  );
  const abb = stepAbout('Abb. 2 zeigt die Kaution. Die Kündigungsfrist beträgt drei Monate.', 'p1.s5');
  assert.equal(
    retrieve(german, { question: 'Was gilt für den Mieter?', selection: around(german, 'p1.s2') }, abb).narration,
    'Abb. 2 zeigt die Kaution.',
  );
  const zb = stepAbout('Die Kaution ist hoch, z. B. Die Miete. Die Kündigungsfrist beträgt drei Monate.', 'p1.s5');
  assert.equal(
    retrieve(german, { question: 'Was gilt für den Mieter?', selection: around(german, 'p1.s2') }, zb).narration,
    'Die Kaution ist hoch, z. B. Die Miete.',
  );
});

test('a region with no text in it is explained from the sentences next to it', () => {
  const selection: RegionSelection = { page: 1, rect: [0.1, 0.53, 0.9, 0.585] };
  const r = retrieve(english, { question: 'explain', selection }, defrost);
  assert.deepEqual(ids(r.focus.slice(0, 2)), ['p1.s7', 'p1.s6'], 'the nearest text is the paragraph above');
  assert.equal(r.home, 'p1.s7');
  assert.ok(r.pointing?.bare);
});

test('the prompt says what the question is about and leaves out the narration that is not', () => {
  const selection = around(english, 'fig1');
  const request: AskRequest = {
    question: 'Erkläre',
    selection,
    stepId: 'last',
    history: [{ question: 'Where may the unit stand?', answer: 'Noise from the fan limits the placement.' }],
  };
  const prompt = askContext(request, retrieve(english, request, defrost), english, defrost);
  assert.match(
    prompt,
    /^QUESTION: Erkläre\nThe question names no topic of its own: it asks about the selected region\./,
  );
  assert.ok(!prompt.includes('THE TOUR WAS SAYING') && !prompt.includes('EARLIER IN THIS CONVERSATION'));
  assert.ok(
    !prompt.includes('noise') && !prompt.includes('Noise'),
    'nothing of the unrelated narration reaches the model',
  );
  assert.match(prompt, /\[fig1\] Figure 1: The refrigerant cycle/);

  const asking: AskRequest = { question: 'Why is the compressor needed?', selection, stepId: 'last' };
  assert.match(
    askContext(asking, retrieve(english, asking, defrost), english, defrost),
    /The learner points at a region: the question is about it unless the question names something else\./,
  );
  const free: AskRequest = { question: 'Erkläre', stepId: 'last' };
  const plain = askContext(free, retrieve(english, free, defrost), english, defrost);
  assert.ok(plain.includes('THE TOUR WAS SAYING: Defrosting') && !plain.includes('names no topic'));
});

test('the call about a selected figure never sees the narration or the suggested question', async () => {
  const config: MuseConfig = {
    apiKey: 'unit-test-key',
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    language: 'en-US',
    timeoutMs: 5000,
  };
  let task = '';
  let schema: any;
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const content = body.messages.at(-1).content;
    task = typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n');
    schema = body.response_format.json_schema.schema;
    const answer = {
      plan: 'Explain the selected figure.',
      answerable: 'yes',
      steps: [
        {
          say: 'The figure shows the refrigerant cycle. The compressor lifts the pressure, so heat can leave at the condenser.',
          cues: [{ action: 'box', target: 'fig1', region: 'whole', label: '', anchor: 'The figure shows' }],
          board: {
            kind: 'none',
            title: '',
            latex: '',
            terms: [],
            nodes: [],
            bars: [],
            unit: '',
            higher_is_better: true,
          },
        },
      ],
      followups: ['What does the condenser do?', 'Why is there an expansion valve?'],
    };
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
  const tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'T',
    paper: 'x',
    chapters: [{ id: 'c', title: 'C', steps: [defrost] }],
  };
  const { answer } = await answerQuestion({
    client: new MuseClient(config, fetcher),
    measureFigure: async () => [],
    doc: english,
    documentId: 'doc-test',
    request: { question: 'Erkläre', selection: around(english, 'fig1'), stepId: 'last' },
    tour: tour as never,
    language: 'en-US',
  });
  assert.match(task, /The question names no topic of its own/);
  assert.ok(
    !/fan|THE TOUR WAS SAYING|Defrosting/.test(task.split('QUESTION:')[1]),
    'nothing of the narration in the question part',
  );
  const offered = schema.properties.steps.items.properties.cues.items.properties.target.enum as string[];
  assert.ok(
    offered.includes('fig1') && !offered.includes('p2.s3'),
    'cues may point at the figure, not at the narration',
  );
  assert.equal(answer.steps.length, 1);
});

// The same checks on the real documents of the evaluation set, when they are on this machine (their doc.json is not
// committed).
const demo = (name: string) => resolve(import.meta.dirname, '../../demo', name, 'doc.json');
const load = (name: string) => JSON.parse(readFileSync(demo(name), 'utf8')) as Doc;

test(
  'the architecture figure of a real paper is explained as the architecture, not as the narration’s positional encoding',
  { skip: !existsSync(demo('attention-short')) },
  () => {
    const doc = load('attention-short');
    const selection = around(doc, 'fig1');
    const step = stepAbout(
      'The authors add positional encodings so the model knows token order. What question would you like to explore next, for example why positional encoding uses sine and cosine waves of different frequencies?',
      'p6.s7',
    );
    for (const question of [
      'Erkläre',
      'explain',
      'what is this?',
      'warum?',
      'was heißt das?',
      'Und was ist das?',
      'and what is this?',
      'And?',
      'and why?',
      'Und warum?',
      'But why?',
    ]) {
      const r = retrieve(doc, { question, selection, history: unrelated }, step);
      assert.ok(ids(r.focus).includes('fig1') && ids(r.focus).includes('p3.s2'), question);
      assert.ok(!everything(r).some((p) => /positional/i.test(p.text)), `${question}: no positional encoding`);
      assert.ok(everything(r).filter((p) => /encoder|decoder/i.test(p.text)).length >= 3, question);
      assert.equal(r.narration, '');
      assert.deepEqual(r.history, []);
      assert.deepEqual(r, retrieve(doc, { question, selection }), 'the step and the history change nothing');
    }
    // A conjunction and a word or two of no topic do not bring the narration back, nor does mentioning earlier models.
    for (const question of [
      'Und was bedeutet das genau?',
      'Und jetzt?',
      'And next?',
      'And the decoder?',
      'And what does Nx mean?',
      'How is this different from earlier models?',
      'Wie unterscheidet sich das von zuvor genutzten RNNs?',
    ]) {
      const r = retrieve(doc, { question, selection }, step);
      assert.ok(ids(r.focus).includes('fig1') && !ids(r.focus).some((id) => /^p6\.s[678]$/.test(id)), question);
      assert.ok(!r.narration?.includes('positional'), question);
    }
    const masked = retrieve(doc, { question: 'Why is there a masked attention in the decoder?', selection }, step);
    assert.equal(masked.pointing?.bare, false);
    assert.ok(ids(masked.ranked.slice(0, 3)).includes('p5.s19'), 'the sentence that explains the masking leads');
    assert.ok(!everything(masked).some((p) => /positional/i.test(p.text)));
    // An equation is explained from the sentences around it, whatever the narration says.
    const equation = retrieve(doc, { question: 'explain', selection: around(doc, 'eq1'), stepId: 'last' }, step);
    assert.equal(equation.focus[0].id, 'eq1');
    assert.ok(ids(equation.ranked).includes('p4.s6'), 'the sentence that introduces the dot products');
    assert.ok(!everything(equation).some((p) => /positional/i.test(p.text)));
    // The same question still follows the narration when the learner selected nothing.
    assert.ok(retrieve(doc, { question: 'Erkläre' }, step).ranked.some((p) => /positional/i.test(p.text)));
  },
);

test(
  'on a German exercise sheet a bare question explains the selected task, not the task the tour was on',
  { skip: !existsSync(demo('eval-sheet-de')) },
  () => {
    const doc = load('eval-sheet-de');
    const rects = doc.sentences
      .filter((s) => ['p1.s10', 'p1.s11', 'p1.s12', 'p1.s13'].includes(s.id))
      .flatMap((s) => s.rects);
    const page = doc.pages[0];
    const selection: RegionSelection = {
      page: 1,
      rect: [
        Math.min(...rects.map((r) => r[0])) / page.width,
        Math.min(...rects.map((r) => r[1])) / page.height,
        Math.max(...rects.map((r) => r[2])) / page.width,
        Math.max(...rects.map((r) => r[3])) / page.height,
      ],
    };
    const step = stepAbout(
      'Aufgabe 4.11 verlangt ein Matrizenprodukt. Du multiplizierst Zeilen mit Spalten und trägst die Summen in die Ergebnismatrix ein.',
      'p3.s2',
    );
    for (const question of [
      'Erkläre',
      'Was heißt das?',
      'warum?',
      'Wie funktioniert das?',
      'Und was heißt das?',
      'Und warum?',
      'Aber warum?',
    ]) {
      const r = retrieve(doc, { question, selection }, step);
      assert.deepEqual(ids(r.focus), ['p1.s10', 'p1.s11', 'p1.s12', 'p1.s13'], question);
      assert.ok(!everything(r).some((p) => /Matrizenprodukt/.test(p.text)), `${question}: no matrix product`);
      assert.deepEqual(r, retrieve(doc, { question, selection }), 'the step changes nothing');
    }
  },
);

test(
  'on a German letter a bare question explains the selected sentence',
  { skip: !existsSync(demo('eval-letter')) },
  () => {
    const doc = load('eval-letter');
    const step = stepAbout(
      'Das Schreiben stützt sich auf Artikel 15 der Datenschutz-Grundverordnung. Als Nächstes siehst du, welche Fristen für die Antwort gelten.',
      'p2.s1',
    );
    const selection = around(doc, 'p1.s8');
    for (const question of ['Erkläre', 'was bedeutet das?', 'explain', 'Und was bedeutet das?', 'Und warum?']) {
      const r = retrieve(doc, { question, selection }, step);
      assert.ok(ids(r.focus).includes('p1.s8'), question);
      assert.ok(
        !ids(r.focus).includes('p2.s1') && !ids(r.focus).includes('p2.s2'),
        'the narration’s evidence is not in focus',
      );
      assert.deepEqual(r, retrieve(doc, { question, selection }), 'the step changes nothing');
    }
  },
);
