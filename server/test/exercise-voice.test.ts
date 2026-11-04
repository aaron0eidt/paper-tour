import test from 'node:test';
import assert from 'node:assert/strict';
import { opensTemplated, voiceProblems, type Spoken } from '../src/harness/exercise-voice';

// The voice of an exercise part (notes/TUTOR.md, "Flow"): no templated opening, no task label opening a narration, and a part
// that goes on from an earlier one never names its task or part.

/** Openings that are a template, by language: "Given ...", "In exercise 3 ...", a label before the first move. */
const TEMPLATED = [
  // English
  'Given the equation two x equals four, find x.',
  'We are given a matrix A and asked for its determinant.',
  "We're given two numbers and want their mean.",
  'You are given the sorted array one, three, five.',
  'So, given that x is three, the rest follows.',
  'Here we are given a sphere of radius two.',
  'In exercise 3, we solve the system.',
  'In Question 2 we look at the mean.',
  'Question 1 asks for the mean.',
  'Problem 3.1 is about a ball.',
  'On task two the setting is a lake.',
  'Part b asks for the variance.',
  'Exercise three: a lake.',
  // German
  'Gegeben sind die zwei Gleichungen zwei x plus drei y gleich sieben und fünf x plus vier y gleich drei.',
  'Gegeben ist die lineare Gleichung drei x gleich fünf.',
  'Nun, gegeben ist ein Körper mit zwei Elementen.',
  'Gesucht ist die Lösung des Systems.',
  'In Aufgabe 4.2 b geht es um einen Körper.',
  'In der Aufgabe vier rechnen wir mit Matrizen.',
  'Aufgabe 4.2: Wir lösen die Gleichung.',
  'Aufgabe eins fragt nach dem Mittelwert.',
  'Teil a fragt nach der Varianz.',
  'Bei Teilaufgabe b suchen wir die Streuung.',
  // French, Spanish, Italian, Portuguese, Dutch
  'Étant donné la matrice A, on cherche son déterminant.',
  'On nous donne un cercle de rayon deux.',
  'Dans l’exercice 3, on cherche la moyenne.',
  'Dados dos números, buscamos su media.',
  'Se nos dan tres valores y queremos su media.',
  'En el ejercicio 2 buscamos la media.',
  'Dato un triangolo, cerchiamo la sua area.',
  'Data una funzione, cerchiamo il massimo.',
  'Nell’esercizio 2 cerchiamo la media.',
  'Dado um triângulo, queremos a sua área.',
  'No exercício 3 calculamos a média.',
  'Gegeven is een driehoek met zijde twee.',
  'In opgave 2 zoeken we het gemiddelde.',
  // Russian, Chinese, Japanese, Korean
  'Дано уравнение два икс равно четыре.',
  'В задаче 3 нужно найти среднее.',
  '已知一个三角形，求它的面积。',
  '问题3中我们求平均值。',
  '第3题求方差。',
  '与えられた行列の行列式を求めます。',
  '주어진 행렬의 행렬식을 구합니다.',
];
/** Ordinary openings, which a tutor may use: the situation, the question, a move, a word that merely looks alike. */
const ORDINARY = [
  'Now the mean is ten hours.',
  'With x known, b asks for the check.',
  'Two x squared minus three x minus five equals zero is quadratic, and we want every x.',
  'Let us start with the mean of the eight values.',
  'Jetzt setzen wir ein.',
  'Das Gleichungssystem hat zwei Unbekannte, und wir suchen ein Paar.',
  'Ein Teil des Ergebnisses ist negativ.',
  'Gegenüber dem Mittelwert ist die Streuung klein.',
  'Gesamt sind es acht Werte.',
  'Part of the answer is the sign.',
  'The problem is that x is negative.',
  'Questions like this one are about ratios.',
  'The task asks for the mean of eight values.',
  'Problem solving starts with a picture.',
  'Question: what is x?',
  'Exercise caution with the signs.',
  'Data are plotted against time.',
  'Datum und Uhrzeit spielen keine Rolle.',
  'Dalla formula otteniamo x.',
  'Para esto usamos la fórmula.',
  'Pour cela, on utilise la formule.',
  'Aqui usamos a fórmula do volume.',
  'We hebben de formule nodig.',
  'Zuerst eliminieren wir x.',
  'Wir haben also zwei Unbekannte.',
  'Сначала найдём среднее.',
  '先求平均值。',
  'まず平均を求めます。',
  '먼저 평균을 구합니다.',
];

test('a narration that opens with "Given", "We are given", "Gegeben ist" or a task label is templated, in every language', () => {
  for (const say of TEMPLATED) assert.equal(opensTemplated(say), true, say);
});

test('ordinary openings are not templated', () => {
  for (const say of ORDINARY) assert.equal(opensTemplated(say), false, say);
});

test('a field that is not an opening may start with "Given", but never with a task label', () => {
  assert.equal(opensTemplated('Given the sum is eighty, the mean is ten.', false), false);
  assert.equal(opensTemplated('In exercise 3, the sum is eighty.', false), true);
  assert.equal(opensTemplated('Aufgabe 4.2 b: die Summe ist achtzig.', false), true);
  assert.equal(opensTemplated('"Given x," says the task, so x is known.', true), true);
  assert.equal(opensTemplated('  — We are given x.', true), true);
});

const field = (say: string, name = 'step 1', opens = false): Spoken => ({ name, say, opens });
const later = { part: { id: 'ex1.b', label: 'b' } } as never;
const first = { part: { id: 'ex1.a', label: 'a' } } as never;

test('a part that goes on from an earlier one never names its task or its own part', () => {
  const named = [
    'Aufgabe 4.2 geht weiter mit dem Betrag.',
    'In exercise 3 we need the mean again.',
    'Question two is the next step.',
    'The variance of part b is next.',
    'Teil b braucht die Summe.',
    'b) now the variance.',
    'Aufgabe sechs Punkt drei geht weiter.',
  ];
  for (const say of named)
    assert.match(voiceProblems([field(say)], later, false).join(' '), /names its task or part/, say);
  // The part before, a number that is a number, and the words alone are fine.
  for (const say of [
    'With the mean from part a, we go on.',
    'Using Teil a, the sum is eighty.',
    'Now b: the variance.',
    'The task asks for the spread, and the problem is that n is small.',
    'Three exercises later, nothing changes.'.replace('Three exercises', 'Three tasks'),
    'Step 3 of 4: divide by seven.',
    'Part of the sum is negative.',
  ])
    assert.deepEqual(voiceProblems([field(say)], later, false), [], say);
});

test('the first part of a task may name it once, and not twice', () => {
  assert.deepEqual(voiceProblems([field('Today we start exercise 3: a lake.'), field('Then the volume.')], first, true), []);
  assert.deepEqual(voiceProblems([field('Then the volume of part a.')], first, true), []);
  const twice = voiceProblems(
    [field('Today we start exercise 3.'), field('Back to exercise 3: the volume.', 'step 2')],
    first,
    true,
  );
  assert.equal(twice.length, 1);
  assert.match(twice[0], /names the task or part again: say the number once at most/);
  assert.equal(voiceProblems([field('We need the volume for part a, and then part a again.')], first, true).length, 1);
});

test('the repair turn quotes the field and the words it opens with', () => {
  const problems = voiceProblems(
    [
      { name: 'read.say', say: 'Gegeben sind zwei Gleichungen, gesucht ist x.', opens: true },
      { name: 'tools[0].say', say: 'We are given a formula for the area.', opens: true },
      { name: 'step 2', say: 'Then we multiply.', opens: false },
    ],
    first,
    true,
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^read\.say opens with "Gegeben sind zwei Gleichungen, gesucht": no template/);
  assert.match(problems[1], /^tools\[0\]\.say opens with "We are given a formula"/);
  assert.deepEqual(voiceProblems([], first, true), []);
});

test('two steps of a part in a row that open with the same word are sent back, once', () => {
  const steps = (...says: string[]) => says.map((say, i) => field(say, `step ${i + 1}`));
  const [problem] = voiceProblems(steps('Wir teilen durch drei.', 'Wir setzen ein.', 'Wir prüfen es.'), first, true);
  assert.equal(voiceProblems(steps('Wir teilen durch drei.', 'Wir setzen ein.', 'Wir prüfen es.'), first, true).length, 1);
  assert.match(problem, /^step 2 and the step before it both open with "wir": vary how the steps begin$/);
  // Different words, the same word apart, one-letter words and fields that are no steps are fine.
  assert.deepEqual(voiceProblems(steps('Wir teilen.', 'Jetzt setzen wir ein.', 'Wir prüfen es.'), first, true), []);
  assert.deepEqual(voiceProblems(steps('x ist drei.', 'x ist jetzt vier.'), first, true), []);
  assert.deepEqual(voiceProblems([field('Dann teilen wir.', 'method.say'), field('Dann setzen wir ein.', 'answer.say')], first, true), []);
  assert.deepEqual(voiceProblems(steps('Dann teilen wir.'), first, true), []);
});
