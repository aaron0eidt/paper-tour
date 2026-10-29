import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, DocExercise } from '../../shared/paper';
import { taskName, taskTitle } from '../src/harness/paper-block';
import { exercisePlan } from '../src/harness/exercise';
import { card } from './plan-fixture';

// A task is titled by its label and a short name only, never by its points, even for documents that were ingested
// when the stored title still carried the points note ("20:", "25: 5,10,5,5 pts.").

test('a points note is no part of a task name', () => {
  for (const [stored, name] of [
    ['20:', ''],
    ['25: 5,10,5,5 pts.', ''],
    ['20: 3,2,10,5 pts.', ''],
    ['4 points', ''],
    ['2+3 P.', ''],
    ['6 Punkte', ''],
    ['Simplifying, 4 points', 'Simplifying'],
    ['(20: 10,10 pts.) Binary paradox', 'Binary paradox'],
    ['Dice', 'Dice'],
    ['The blue taxi', 'The blue taxi'],
    ['Seating arrangement and relative height', 'Seating arrangement and relative height'],
    ['Aufgabe zu Matrizen 2x2', 'Aufgabe zu Matrizen 2x2'],
    ['Eigenwerte (3 Punkte)', 'Eigenwerte'],
    [undefined, ''],
    ['', ''],
  ] as const)
    assert.equal(taskTitle(stored), name, String(stored));
});

const sheet = (rows: [string, string, string][]): Doc => ({
  schema: 'paper-tour/doc@0.1',
  source: { file: 'doc.pdf', sha256: 'e'.repeat(64), num_pages: 1, generator: 'test', title: 'Problem set' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: rows.map(([id, text], i) => ({
    id,
    page: 1,
    type: 'paragraph' as const,
    bbox: [50, 40 + 20 * i, 500, 54 + 20 * i] as [number, number, number, number],
    text,
    sentences: [`${id.replace('.b', '.s')}`],
  })),
  sentences: rows.map(([id, text], i) => ({
    id: id.replace('.b', '.s'),
    page: 1,
    block: id,
    text,
    rects: [[50, 40 + 20 * i, 500, 54 + 20 * i]] as [number, number, number, number][],
  })),
  figures: [],
  equations: [],
});
const task = (id: string, number: string, block: string, title?: string): DocExercise => ({
  id,
  number,
  ...(title ? { title } : {}),
  page: 1,
  block,
  blocks: [block],
  parts: [],
});

test('the chapter and step names of a sheet carry the label and the name, never the points', () => {
  const doc = sheet([
    ['p1.b1', 'Problem 1. (20: 10,10 pts.) (‘Binary’ paradox)', ''],
    ['p1.b2', 'Problem 2. (15 pts.) (The blue taxi)', ''],
    ['p1.b3', 'Problem 4. (25: 5,10,5,5 pts.) (Dice) There are four dice in a drawer.', ''],
    ['p1.b4', 'Aufgabe 4.3.*', ''],
    ['p1.b5', 'Aufgabe 4.4. Zeige, dass das lineare Gleichungssystem', ''],
  ]);
  const tasks = [
    task('ex1', '1', 'p1.b1', '20:'),
    task('ex2', '2', 'p1.b2', 'The blue taxi'),
    task('ex4', '4', 'p1.b3', '25: 5,10,5,5 pts.'),
    task('ex4.3', '4.3', 'p1.b4'),
    task('ex4.4', '4.4', 'p1.b5'),
  ];
  assert.deepEqual(
    tasks.map((t) => taskName(doc, t)),
    ['Problem 1', 'Problem 2: The blue taxi', 'Problem 4', 'Aufgabe 4.3', 'Aufgabe 4.4'],
  );
  // The titles of the plan's chapters are those names.
  const withTasks: Doc = {
    ...doc,
    exercises: tasks.map((t) => ({ ...t, blocks: [t.block], parts: [] })),
  };
  const plan = exercisePlan({ ...card, doc_type: 'exercise_sheet' }, withTasks, 'quick');
  const titles = plan.chapters.map((c) => c.title);
  assert.ok(titles.includes('Problem 1'));
  assert.ok(titles.includes('Problem 2: The blue taxi'));
  for (const title of titles) assert.doesNotMatch(title, /pts|points|\d+:\s*$|\d+, ?\d+/i, title);
});
