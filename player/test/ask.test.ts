// Asking in the reader: an answer becomes a tour of its own for a second engine, the tour waits paused underneath and
// comes back exactly as it was. Bundled for Node with esbuild like the other player tests (no test framework).

import { answerTour, openQuestions, visualShown, waitingLabel } from '../src/ask/answer';
import type { AskAnswer } from '../src/ask/api';
import { hasRegionArea, regionFromDrag } from '../src/ask/regionSelection';
import { project, unproject } from '../src/camera';
import { TourEngine } from '../src/engine';
import type { Timers } from '../src/engine';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from '../src/narration/narrator';
import { prepareTour, Resolver } from '../src/resolve';
import type { Doc, Tour } from '../src/types';

const results: string[] = [];
let failures = 0;
console.warn = () => {};

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}

function eq<T>(actual: T, expected: T, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

/** Speaks nothing; the test ends each narration by hand. */
class FakeNarrator implements Narrator {
  readonly name = 'fake';
  calls: { req: SpeakRequest; cb: SpeakCallbacks; cancelled: boolean }[] = [];
  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    const call = { req, cb, cancelled: false };
    this.calls.push(call);
    return { cancel: () => void (call.cancelled = true) };
  }
  get last() {
    return this.calls[this.calls.length - 1];
  }
}

const timers: Timers = { setTimeout: (fn) => (fn(), 0), clearTimeout: () => {} };

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [
    {
      id: 'p1.b1',
      page: 1,
      type: 'paragraph',
      bbox: [100, 70, 500, 100],
      text: 'A. B.',
      sentences: ['p1.s1', 'p1.s2'],
    },
  ],
  sentences: [
    { id: 'p1.s1', page: 1, block: 'p1.b1', text: 'A.', rects: [[100, 70, 200, 80]] },
    { id: 'p1.s2', page: 1, block: 'p1.b1', text: 'B.', rects: [[202, 70, 500, 80]] },
  ],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [100, 200, 500, 400],
      caption: '',
      image: 'f.png',
      panels: [{ id: 'fig1.a', bbox: [100, 200, 300, 400] }],
      referenced_by: [],
    },
  ],
  equations: [{ id: 'eq1', number: '1', page: 1, bbox: [100, 500, 400, 520], block: 'p1.b1', text: 'x' }],
};
const resolver = new Resolver(doc, [{ width: 600, height: 800 }]);

const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'Tour',
  paper: 'demo',
  voices: { host: { lang: 'en-GB', rate: 1.1 } },
  suggested_questions: ['Why B?'],
  chapters: [
    {
      id: 'c',
      title: 'C',
      steps: [
        {
          id: 'one',
          say: 'first step words',
          actions: [
            { type: 'focus', target: 'p1.s1' },
            { type: 'highlight', targets: ['p1.s1'] },
          ],
        },
        {
          id: 'two',
          say: 'second step with a board',
          actions: [
            { type: 'zoom', target: 'fig1' },
            { type: 'box', target: 'fig1', persist: true },
            {
              type: 'board',
              item: {
                kind: 'flow',
                nodes: [
                  { id: 'node-1', label: 'In' },
                  { id: 'node-2', label: 'Mid' },
                  { id: 'node-3', label: 'Out' },
                ],
                edges: [
                  ['node-1', 'node-2'],
                  ['node-2', 'node-3'],
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

const reply: AskAnswer = {
  answerable: 'yes',
  followups: ['What is A?', 'Why B?'],
  steps: [
    {
      id: 'ask-1a2b3c4d-1',
      say: 'Sentence B says so, and the figure shows it.',
      actions: [
        { type: 'focus', target: 'p1.s2' },
        { type: 'highlight', targets: ['p1.s2', 'p9.s9'], color: 'yellow' },
        { type: 'arrow', target: 'fig1.a', color: 'pink', at_word: 6 },
        { type: 'box', target: 'fig9', color: 'pink' },
      ],
    },
    { id: 'ask-1a2b3c4d-1', say: 'Then the equation.', actions: [{ type: 'zoom', target: 'eq1' }] },
  ],
};

test('an answer becomes a one-chapter tour in the tour’s voice, with unique step IDs', () => {
  const answer = answerTour(reply, 'Why B?', tour);
  eq(answer.title, 'Why B?');
  eq(answer.voices, tour.voices, 'voices');
  eq(answer.chapters.length, 1, 'chapters');
  eq(
    answer.chapters[0].steps.map((s) => s.id),
    ['ask-1a2b3c4d-1', 'ask-1a2b3c4d-1-2'],
    'ids',
  );
  eq(answer.chapters[0].steps[0].speaker, undefined, 'the default speaker stays implicit');
  eq(answerTour(reply, 'Why B?', tour, 'guest').chapters[0].steps[1].speaker, 'guest', 'the tour’s own speaker');
  eq(answerTour(reply, 'Why B?', null).voices, undefined, 'no tour, no voices');
});

test('the answer goes through prepareTour like the tour: IDs the document lacks are dropped', () => {
  const { tour: prepared } = prepareTour(answerTour(reply, 'Why B?', tour), resolver);
  eq(
    prepared.chapters[0].steps[0].actions.map((a) => a.type),
    ['focus', 'highlight', 'arrow'],
  );
  const highlight = prepared.chapters[0].steps[0].actions[1];
  eq(highlight.type === 'highlight' ? highlight.targets : [], ['p1.s2'], 'kept targets');
});

test('the tour waits paused under the answer and comes back exactly as it was', () => {
  const voice = new FakeNarrator();
  const main = new TourEngine(prepareTour(tour, resolver).tour, { narrator: voice, timers });
  main.goTo(1);
  main.play();
  voice.last.cb.onWord(2);
  const before = main.getState();
  eq(before.board.item?.kind, 'flow', 'the tour shows its board');
  main.pause();
  const paused = main.getState();

  const answer = new TourEngine(prepareTour(answerTour(reply, 'Why B?', tour), resolver).tour, {
    narrator: voice,
    timers,
  });
  answer.play();
  eq(voice.last.req.text, reply.steps[0].say, 'the answer speaks on the same narrator');
  eq(voice.last.req.voice, tour.voices!.host, 'in the tour’s voice');
  eq(answer.getState().board.item, null, 'the tour’s board is not the answer’s');
  eq(answer.getState().camera.action, { type: 'focus', target: 'p1.s2' }, 'the answer moves the camera');
  eq(
    answer.getState().overlays.map((o) => o.action.type),
    ['highlight'],
    'only the answer’s own marks are drawn',
  );
  voice.last.cb.onEnd();
  voice.last.cb.onEnd();
  eq(answer.getState().status, 'ended', 'the answer ends on its own');
  eq(answer.getState().camera.action, { type: 'zoom', target: 'eq1' }, 'and stays on its last view');
  answer.destroy();

  eq(main.getState(), paused, 'the tour is untouched: same step, marks, board and camera');
  main.play();
  eq([main.getState().status, main.getState().index], ['playing', 1], 'and plays on from its step');
});

test('the same narrator again does not restart the playing step', () => {
  const voice = new FakeNarrator();
  const engine = new TourEngine(tour, { narrator: voice, timers });
  engine.play();
  engine.setNarrator(voice);
  eq(voice.calls.length, 1, 'one narration');
  engine.setNarrator(new FakeNarrator());
  eq(voice.last.cancelled, true, 'a new narrator restarts the step');
});

test('a question about "this" names the figure, panel or equation on screen', () => {
  const kind = (id: string) => resolver.kind(id);
  eq(visualShown({ type: 'zoom', target: 'fig1' }, kind), 'fig1');
  eq(visualShown({ type: 'zoom', target: 'fig1.a' }, kind), 'fig1.a');
  eq(visualShown({ type: 'focus', target: 'eq1' }, kind), 'eq1');
  eq(visualShown({ type: 'focus', target: 'p1.s1' }, kind), undefined, 'a sentence');
  eq(visualShown(null, kind), undefined, 'nothing framed');
});

test('offered questions skip blanks, repeats and what was asked', () => {
  eq(openQuestions(['Why B?', ' why  b? ', '', 'What is A?', 'How?', 'Where?'], ['what is a?']), [
    'Why B?',
    'How?',
    'Where?',
  ]);
  eq(openQuestions(undefined, []), []);
  eq(openQuestions(['A?', 'B?', 'C?'], [], 2), ['A?', 'B?']);
});

test('a long wait says what is happening', () => {
  eq([0, 5_000, 20_000, 60_000].map(waitingLabel), [
    'Thinking',
    'Reading the document',
    'Writing the answer',
    'Still working on it',
  ]);
});

test('an explicit answer language changes only the micro-tour voice configuration', () => {
  const original = JSON.stringify(tour);
  const answer = answerTour({...reply,language:'uk-UA'}, 'Explain this', tour);
  eq(answer.voices?.host?.lang,'uk-UA');
  eq(JSON.stringify(tour),original);
  eq(answerTour({...reply,language:'<script>'}, 'Explain this', tour).voices,tour.voices);
});

test('selected regions use normalized page coordinates after pan, zoom and reversed drags', () => {
  const page = { n: 3, x: 82, y: 1688, width: 600, height: 800 };
  const viewport = { width: 680, height: 900 };
  for (const scale of [.5, 1, 4]) {
    const view = { cx: 410, cy: 1880, s: scale };
    const start = project([page.x + 450, page.y + 600, page.x + 450, page.y + 600], view, viewport);
    const end = project([page.x + 150, page.y + 200, page.x + 150, page.y + 200], view, viewport);
    const region = regionFromDrag(page, unproject(start.left, start.top, view, viewport), unproject(end.left, end.top, view, viewport));
    eq(region, { page: 3, rect: [.25, .25, .75, .75] });
    eq(hasRegionArea(region, page, scale), true);
  }
});

test('a region is clamped to its starting page and a click is not accepted', () => {
  const page = { n: 2, x: 32, y: 860, width: 600, height: 800 };
  eq(regionFromDrag(page, [332, 1260], [-100, 2000]), { page: 2, rect: [0, .5, .5, 1] });
  eq(hasRegionArea(regionFromDrag(page, [100, 1000], [100, 1000]), page, 4), false);
  eq(hasRegionArea(regionFromDrag(page, [100, 1000], [105, 1100]), page, 1), false);
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} ask tests passed`);
