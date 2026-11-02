import test from 'node:test';
import assert from 'node:assert/strict';
import type { TeachingConcept, TeachingPlan, TeachingPreferences } from '../../shared/teachingPlan';
import type { MuseMessage } from '../src/muse/client';
import { ProcessingError } from '../src/errors';
import { authorTeachingPlan, teachingPageSchema } from '../src/harness/teaching-author';
import { doc } from './plan-fixture';

const preferences: TeachingPreferences = { structure: 'paper', depth: 'deep', audience: 'general', instructions: '' };
const concept = (id: string, over: Partial<TeachingConcept> = {}): TeachingConcept => ({
  id,
  title: id,
  summary: `Explain the distinct source-grounded operation ${id}.`,
  role: 'mechanism',
  evidence: ['p1.s3'],
  prerequisites: [],
  importance: 'medium',
  importanceReason: 'This operation supports the method.',
  difficulty: 'medium',
  difficultyReason: 'Follow the dependency.',
  confidence: 'high',
  objective: `Understand ${id}.`,
  misconception: '',
  visual: 'source',
  visualBenefit: '',
  visibleChange: '',
  ...over,
});
const contribution = concept('contribution', { role: 'contribution', evidence: ['p1.s2'] });
const evidence = concept('evidence', { role: 'evidence', evidence: ['p2.s1'] });
const sections: TeachingPlan['sections'] = doc.sections.map((section) => ({
  sectionId: section.id,
  treatment: 'teach',
  reason: 'Supports the paper question.',
}));
const page = (concepts: TeachingConcept[], complete: boolean, treatment = sections) => ({
  question: 'Does measured need reduce water use?',
  audienceAssumption: 'A reader new to this mechanism.',
  concepts,
  sections: treatment,
  complete,
});
const base = () => ({
  doc,
  preferences,
  language: 'en-US',
  prefix: [{ role: 'user', content: 'FULL PAPER: including the late results and qualifications.' }] as MuseMessage[],
  signal: new AbortController().signal,
  retryable: (error: unknown) => error instanceof ProcessingError,
});
const text = (messages: MuseMessage[]) => JSON.stringify(messages);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test('paginated understanding retains over thirty concepts and forward prerequisites before returning any plan', async () => {
  const entries = [
    { ...contribution, prerequisites: ['later-prerequisite'] },
    evidence,
    ...Array.from({ length: 38 }, (_, i) => concept(`mechanism-${i}`)),
    concept('later-prerequisite', { role: 'prerequisite', importance: 'low', evidence: ['p1.s1'] }),
  ];
  const entered = deferred<void>(),
    release = deferred<void>();
  let calls = 0,
    returned = false;
  const result = authorTeachingPlan({
    ...base(),
    call: async (messages, schema) => {
      assert.match(text(messages), /FULL PAPER/);
      assert.ok(!('maxItems' in (schema as ReturnType<typeof teachingPageSchema>).properties.concepts));
      assert.match(
        (schema as ReturnType<typeof teachingPageSchema>).properties.concepts.items.properties.role.description,
        /contribution = the paper's main new claim or proposed approach/,
      );
      assert.match(text(messages), /complete plan must include at least one contribution and one evidence concept/);
      assert.match(text(messages), /do not add a duplicate concept or merely rename its title/);
      const i = calls++;
      if (i === 2) {
        entered.resolve();
        await release.promise;
      }
      if (i > 0) assert.match(text(messages), /Already saved planning entries/);
      return { value: page(entries.slice(i * 15, (i + 1) * 15), i === 2, i === 0 ? sections : []) };
    },
  });
  void result.then(() => {
    returned = true;
  });
  await entered.promise;
  assert.equal(returned, false, 'partial understanding never starts the completed tour');
  release.resolve();
  const plan = await result;
  assert.equal(calls, 3);
  assert.equal(plan.concepts.length, 41);
  assert.deepEqual(
    plan.concepts.map((entry) => entry.id),
    entries.map((entry) => entry.id),
  );
  assert.deepEqual(plan.concepts[0].prerequisites, ['later-prerequisite']);
});

test('unknown sources on incomplete pages are rejected immediately and corrected whole entries remain recoverable', async () => {
  let calls = 0;
  const problems: string[][] = [];
  const bad = { ...evidence, evidence: ['invented-source'] };
  const result = await authorTeachingPlan({
    ...base(),
    onProblems: async (errors) => {
      problems.push(errors);
    },
    call: async (messages) => {
      switch (calls++) {
        case 0:
          return { value: page([contribution], false) };
        case 1:
          return { value: page([bad], false, []) };
        default:
          assert.match(text(messages), /unknown source invented-source/);
          assert.match(text(messages), /rejected response.*not saved/i);
          assert.match(text(messages), /Resubmit its whole corrected entries/);
          return { value: page([evidence], true, []) };
      }
    },
  });
  assert.equal(calls, 3);
  assert.equal(problems.length, 1);
  assert.deepEqual(
    result.concepts.map((entry) => entry.id),
    ['contribution', 'evidence'],
  );
  assert.deepEqual(result.concepts[1].evidence, ['p2.s1']);
});

test('every planning response exposes actual section IDs even for sections with no prose', async () => {
  const emptySection = {
    id: 'sec-references',
    title: 'References and attention visualizations',
    level: 1,
    page: 2,
    block: 'references-heading',
  };
  const document = {
    ...doc,
    sections: [...doc.sections, emptySection],
    blocks: [
      ...doc.blocks,
      {
        id: emptySection.block,
        type: 'heading' as const,
        page: 2,
        bbox: [0, 700, 500, 720] as [number, number, number, number],
        text: emptySection.title,
        sentences: [],
      },
    ],
  };
  let calls = 0;
  const result = await authorTeachingPlan({
    ...base(),
    doc: document,
    call: async (messages) => {
      calls++;
      const { id, title, level, page: number } = emptySection;
      assert.match(text(messages), /complete inventory, including sections without prose/);
      assert.ok(
        messages.some(
          (message) =>
            typeof message.content === 'string' &&
            message.content.includes(JSON.stringify({ id, title, level, page: number })),
        ),
      );
      return {
        value: page(
          calls === 1 ? [contribution] : [evidence],
          calls === 2,
          calls === 1
            ? []
            : [
                ...sections,
                {
                  sectionId: emptySection.id,
                  treatment: 'omit',
                  reason: 'Bibliographic sources need no separate teaching concept.',
                },
              ],
        ),
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.sections.find((section) => section.sectionId === emptySection.id)?.treatment, 'omit');
});

test('a completed map can repair missing prerequisites without resending or dropping the saved concepts', async () => {
  let calls = 0;
  const result = await authorTeachingPlan({
    ...base(),
    call: async (messages) => {
      if (++calls === 1)
        return { value: page([{ ...contribution, prerequisites: ['needed-background'] }, evidence], true) };
      assert.match(text(messages), /invalid prerequisite needed-background/);
      assert.match(text(messages), /Already saved planning entries/);
      return { value: page([concept('needed-background', { role: 'prerequisite', evidence: ['p1.s1'] })], true, []) };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    result.concepts.map((entry) => entry.id),
    ['contribution', 'evidence', 'needed-background'],
  );
});

test('repeat-only pages cannot bypass the no-progress guard by changing metadata and prose', async () => {
  let calls = 0;
  const counts: number[] = [];
  await assert.rejects(
    authorTeachingPlan({
      ...base(),
      onProblems: async (_errors, failures) => {
        counts.push(failures);
      },
      call: async () => {
        calls++;
        if (calls === 1) return { value: page([contribution, evidence], false) };
        return {
          value: {
            ...page(
              [{ ...contribution, summary: `Cosmetic rewrite ${calls}` }, evidence],
              false,
              sections.map((section) => ({ ...section, reason: `Changed metadata ${calls}` })),
            ),
            question: `New wording ${calls}?`,
            audienceAssumption: `Changed audience wording ${calls}`,
          },
        };
      },
    }),
    (error: unknown) =>
      error instanceof ProcessingError &&
      error.code === 'invalid_teaching_plan' &&
      /no planning progress/.test(error.message),
  );
  assert.equal(calls, 3);
  assert.deepEqual(counts, [1, 2]);
});

test('complete-page repairs may resolve distinct issues in stages without spending the identical-failure budget', async () => {
  let calls = 0;
  const failures: number[] = [];
  const result = await authorTeachingPlan({
    ...base(),
    onProblems: async (_problems, count) => {
      failures.push(count);
    },
    call: async (messages) => {
      switch (calls++) {
        case 0:
          return { value: page([{ ...contribution, role: 'mechanism' }, evidence], true, []) };
        case 1:
          return { value: page([], true, [sections[0]]) };
        case 2:
          return { value: page([], true, [sections[1]]) };
        default:
          assert.match(text(messages), /same ID and role:\\"contribution\\"/);
          assert.match(text(messages), /do not invent a contribution or resend unchanged section treatments/);
          return { value: page([contribution], true, []) };
      }
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(failures, [1, 1, 1]);
  assert.equal(result.concepts.find((concept) => concept.id === contribution.id)?.role, 'contribution');
  assert.deepEqual(result.sections, sections);
});

test('identical complete-map validation errors still stop after two attempts', async () => {
  let calls = 0;
  const failures: number[] = [];
  await assert.rejects(
    authorTeachingPlan({
      ...base(),
      onProblems: async (_problems, count) => {
        failures.push(count);
      },
      call: async () => {
        calls++;
        return { value: page([{ ...contribution, role: 'mechanism' }, evidence], true) };
      },
    }),
    (error: unknown) =>
      error instanceof ProcessingError &&
      error.code === 'invalid_teaching_plan' &&
      /main contribution/.test(error.message),
  );
  assert.equal(calls, 2);
  assert.deepEqual(failures, [1, 2]);
});

test('complete-map progress tracks every missing section beyond the former twelve-diagnostic cutoff', async () => {
  const extraSections = Array.from({ length: 18 }, (_, i) => ({
    id: `sec-appendix-${i}`,
    title: `Appendix ${i}`,
    level: 1,
    page: 2,
    block: `appendix-heading-${i}`,
  }));
  const document = {
    ...doc,
    sections: [...doc.sections, ...extraSections],
    blocks: [
      ...doc.blocks,
      ...extraSections.map((section) => ({
        id: section.block,
        type: 'heading' as const,
        page: 2,
        bbox: [0, 700, 500, 720] as [number, number, number, number],
        text: section.title,
        sentences: [],
      })),
    ],
  };
  const accounting: TeachingPlan['sections'] = extraSections.map((section) => ({
    sectionId: section.id,
    treatment: 'background',
    reason: 'Source appendix accounted for separately from the main explanation.',
  }));
  const failures: number[] = [],
    diagnostics: string[][] = [];
  let calls = 0;
  const result = await authorTeachingPlan({
    ...base(),
    doc: document,
    onProblems: async (problems, count) => {
      failures.push(count);
      diagnostics.push(problems);
    },
    call: async () => {
      switch (calls++) {
        case 0:
          return { value: page([contribution, evidence], true) };
        case 1:
          return { value: page([], true, accounting.slice(0, 12)) };
        default:
          return { value: page([], true, accounting.slice(12)) };
      }
    },
  });
  assert.equal(calls, 3);
  assert.equal(diagnostics[0].length, 18, 'all unresolved sections are retained in the internal validation result');
  assert.equal(diagnostics[1].length, 6);
  assert.deepEqual(failures, [1, 1], 'fixing the first twelve issues is recognized as strict diagnostic improvement');
  assert.equal(result.sections.length, document.sections.length);
});

test('output truncation requests smaller complete-entry batches and preserves all earlier understanding', async () => {
  let calls = 0;
  const result = await authorTeachingPlan({
    ...base(),
    call: async (messages) => {
      switch (calls++) {
        case 0:
          return { value: page([contribution], false) };
        case 1:
          throw new ProcessingError('muse_output_truncated', 'Output budget exhausted');
        case 2:
          assert.match(text(messages), /smaller batch of whole entries with complete:false/);
          assert.match(text(messages), /do not shorten or drop concepts/);
          assert.match(text(messages), /Already saved planning entries/);
          return { value: page([evidence], false, []) };
        default:
          return { value: page([], true, []) };
      }
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(
    result.concepts.map((entry) => entry.id),
    ['contribution', 'evidence'],
  );
});

test('persistent schema failures have bounded targeted repair and cannot publish a substitute plan', async () => {
  let calls = 0;
  await assert.rejects(
    authorTeachingPlan({
      ...base(),
      call: async () => {
        calls++;
        return { value: {} };
      },
    }),
    (error: unknown) => error instanceof ProcessingError && error.code === 'invalid_teaching_plan',
  );
  assert.equal(calls, 2);
});

test('known dependency cycles on partial pages are repaired before they enter the saved map', async () => {
  let calls = 0;
  const result = await authorTeachingPlan({
    ...base(),
    call: async (messages) => {
      switch (calls++) {
        case 0:
          return { value: page([{ ...contribution, prerequisites: [evidence.id] }], false) };
        case 1:
          return { value: page([{ ...evidence, prerequisites: [contribution.id] }], false, []) };
        default:
          assert.match(text(messages), /Cyclic prerequisites/);
          return { value: page([evidence], true, []) };
      }
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.concepts[1].prerequisites, []);
});

test('cancellation promptly stops a noncooperative planning call without retries or late publication', async () => {
  const stop = new AbortController(),
    entered = deferred<void>(),
    provider = deferred<{ value: unknown }>();
  let calls = 0;
  const result = authorTeachingPlan({
    ...base(),
    signal: stop.signal,
    call: async () => {
      calls++;
      entered.resolve();
      return provider.promise;
    },
  });
  const rejected = assert.rejects(result, /Reader cancelled/);
  await entered.promise;
  stop.abort(new Error('Reader cancelled'));
  await rejected;
  provider.resolve({ value: page([contribution, evidence], true) });
  await Promise.resolve();
  assert.equal(calls, 1);
});
