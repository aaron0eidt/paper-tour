import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc } from '../../shared/paper';
import { documentLanguage } from '../src/harness/language';
const doc = (text: string): Doc => ({
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [],
  sections: [],
  figures: [],
  equations: [],
  sentences: [],
  blocks: [{ id: 'b', page: 1, type: 'paragraph', bbox: [0, 0, 1, 1], text, sentences: [] }],
});
test('dominant language uses prose rather than the app default', () => {
  assert.equal(
    documentLanguage(
      doc(
        'Die Ableitung der Funktion wird mit der Kettenregel berechnet. Für die Aufgabe müssen wir zuerst das innere Argument und dann die äußere Funktion betrachten.',
      ),
    ),
    'de-DE',
  );
  assert.equal(
    documentLanguage(
      doc(
        'The result of the experiment is a function of the input. We can use this to explain why the output is not always the same.',
      ),
    ),
    'en-US',
  );
  assert.equal(
    documentLanguage(
      doc(
        'Les résultats de cette étude sont importants pour la méthode et pour les données. Cette méthode est une approche qui utilise les exemples.',
      ),
    ),
    'fr-FR',
  );
  assert.equal(documentLanguage(doc('x = 2'), 'de-DE'), 'de-DE');
});
