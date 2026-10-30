// What a finished tour says on its cards when it left something out of its plan: briefly, with the writer's own cause, and
// nothing when it lost nothing (shared/coverage.ts). Bundled for Node with esbuild like the other player tests.

import { renderToStaticMarkup } from 'react-dom/server';
import { TourCover, TourEnd } from '../src/components/TourCards';
import type { Tour } from '../src/types';

let failures = 0;
function test(name: string, run: () => void) {
  try {
    run();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}
function check(value: boolean, what: string) {
  if (!value) throw new Error(what);
}

const step = (id: string) => ({
  id,
  say: 'one two three four five six',
  actions: [{ type: 'highlight' as const, targets: ['p1.s1'] }],
});
const tour = (left_out?: Tour['left_out']): Tour => ({
  schema: 'paper-tour/tour@0.1',
  title: 'A tour',
  paper: 'p',
  doc_sha256: 'a'.repeat(64),
  chapters: [
    { id: 'c1', title: 'One', steps: [step('a')] },
    { id: 'c2', title: 'Two', steps: [step('b')] },
  ],
  ...(left_out ? { left_out } : {}),
});
const cover = (value: Tour) =>
  renderToStaticMarkup(
    <TourCover
      tour={value}
      steps={2}
      length="about 1 min"
      onStart={() => {}}
      onResume={() => {}}
      onBrowse={() => {}}
    />,
  );
const end = (value: Tour) =>
  renderToStaticMarkup(
    <TourEnd
      tour={value}
      questions={[]}
      onReplayChapter={() => {}}
      onReplay={() => {}}
      onAsk={() => {}}
      onClose={() => {}}
    />,
  );

const lost: Tour['left_out'] = [{ step: 'formula-2', part: 'step', cause: 'slow', because: 'example' }];

test('a tour that left something out says what and why on its cover and on its recap', () => {
  for (const html of [cover(tour(lost)), end(tour(lost))]) {
    check(html.includes('Not everything planned is in this tour.'), 'the tour does not say it is not all of its plan');
    check(
      html.includes('1 planned step left out: its worked example took too long to write.'),
      'the cause is missing or wrong',
    );
    check(html.includes('tour-note left-out'), 'the note does not use the card note style');
  }
});

test('a tour that lost nothing, or only pen marks, or is older than the record, says nothing about it', () => {
  for (const value of [tour(), tour([]), tour([{ step: 'a', part: 'marks', cause: 'checks' }]), tour([{ step: 'a', part: 'board', cause: 'slow' }])])
    for (const html of [cover(value), end(value)])
      check(!html.includes('left-out') && !html.includes('Not everything'), 'a note appeared');
});

test('each cause is told as it is, never as another', () => {
  const told = (cause: 'slow' | 'checks' | 'invalid' | 'repeats' | 'unavailable') =>
    end(tour([{ step: 'a', part: 'example', cause }]));
  check(told('slow').includes('1 worked example left out: it took too long to write.'), 'slow');
  check(told('checks').includes('1 worked example left out: it did not pass the checks.'), 'checks');
  check(told('invalid').includes('1 worked example left out: it came back unusable.'), 'invalid');
  check(told('repeats').includes('1 worked example left out: it would have repeated earlier content.'), 'repeats');
  check(told('unavailable').includes('the model was not available'), 'unavailable');
});

if (failures) throw new Error(`${failures} coverage test(s) failed`);
