import type {
  BBox,
  Doc,
  DocBlock,
  DocEquation,
  DocExercise,
  DocFigure,
  DocSection,
  DocSentence,
} from '../../shared/paper';

// Synthetic documents of 100 pages in the shapes the harness tours (a paper, a long contract, a slide deck, an exercise
// sheet), for the tests that hold every call's schema to the provider's limits. They are generic text, not a real
// document; their sizes are what counts: thousands of sentences, hundreds of figures and formulas.

export type LongKind = 'paper' | 'contract' | 'slides' | 'sheet';

const rect = (x: number, y: number, w: number, h: number): BBox => [x, y, x + w, y + h];

export function longDoc(kind: LongKind, pages = 100): Doc {
  const slides = kind === 'slides';
  const sections: DocSection[] = [];
  const blocks: DocBlock[] = [];
  const sentences: DocSentence[] = [];
  const figures: DocFigure[] = [];
  const equations: DocEquation[] = [];
  const exercises: DocExercise[] = [];
  const block = (
    page: number,
    type: DocBlock['type'],
    texts: string[],
    section?: string,
    box = rect(50, 100, 500, 80),
  ) => {
    const id = `p${page}.b${blocks.filter((b) => b.page === page).length + 1}`;
    const ids = texts.map((text, i) => {
      const sid = `p${page}.s${sentences.filter((s) => s.page === page).length + 1}`;
      sentences.push({ id: sid, page, block: id, text, rects: [rect(50, 100 + i * 10, 400, 10)] });
      return sid;
    });
    blocks.push({ id, page, type, bbox: box, text: texts.join(' '), ...(section ? { section } : {}), sentences: ids });
    return { id, ids };
  };
  const heading = (page: number, title: string, level = 1) => {
    const id = `sec-${sections.length + 1}`;
    const { id: blockId } = block(page, 'heading', [], id, rect(50, 60, 300, 20));
    blocks.at(-1)!.text = title;
    sections.push({ id, number: String(sections.length + 1), title, level, page, block: blockId });
    return id;
  };
  const prose = (page: number, section: string, count: number, words: (i: number) => string) =>
    block(
      page,
      'paragraph',
      Array.from({ length: count }, (_, i) => words(i)),
      section,
    );
  const titles: Record<number, string> = {
    1: 'Abstract',
    2: 'Introduction',
    [pages - 1]: 'Conclusion',
    [pages]: 'References',
  };

  for (let page = 1; page <= pages; page++) {
    if (kind === 'sheet') {
      const task = page;
      const intro = block(page, 'paragraph', [
        `Task ${task}. Solve the equation system and give the result with two decimals.`,
      ]);
      const parts = ['a', 'b', 'c'].map((label) => {
        const part = block(page, 'paragraph', [
          `${label}) Compute the value of x for a rate of ${page}.${label.charCodeAt(0) % 10} percent.`,
          `Then explain what the number means for the model.`,
        ]);
        return { id: `ex${task}.${label}`, label, page, blocks: [part.id] };
      });
      exercises.push({
        id: `ex${task}`,
        number: String(task),
        page,
        block: intro.id,
        blocks: [intro.id, ...parts.flatMap((p) => p.blocks)],
        parts,
      });
      continue;
    }
    const section = heading(page, titles[page] ?? `Part ${page}: ${kind === 'contract' ? 'Clause' : 'Topic'} ${page}`);
    if (slides) {
      block(
        page,
        'paragraph',
        [`Key idea ${page}: the quantity grows by ${page} percent each period.`, `Remember the rule for case ${page}.`],
        section,
      );
      continue;
    }
    for (let p = 0; p < 6; p++)
      prose(page, section, 5, (i) =>
        kind === 'paper'
          ? `We show that setting ${page}.${p}.${i} improves the score by ${page + i}.${p} points, however it costs ${p + 2} hours.`
          : `The tenant must pay ${page + i}${p} pounds within ${p + 7} days of clause ${page}.${p}.${i}, unless the landlord agrees in writing.`,
      );
    if (kind === 'paper') {
      // Formulas of every page, numbered and unnumbered: the formula inventory makes hundreds of them.
      for (let e = 0; e < 4; e++) {
        const n = equations.length + 1;
        equations.push({
          id: n <= 160 ? `eq${n}` : `equ${n - 160}`,
          number: n <= 160 ? String(n) : null,
          page,
          bbox: rect(100, 300 + e * 30, 300, 20),
          text: `y_${n} = a_${n} x + b_${n}`,
        });
      }
    }
  }
  if (kind === 'paper') {
    block(pages, 'reference', ['[1] A. Author. A study of studies. 2020.'], undefined, rect(50, 500, 400, 20));
    // Figures and tables throughout, each cited by two sentences of its page; the first figure carries a crowd of text
    // labels, the first table a crowd of cells.
    for (let i = 0; i < 160; i++) {
      const page = 3 + ((i * 7) % (pages - 4));
      const table = i % 4 === 3;
      const id = table ? `tab${i + 1}` : `fig${i + 1}`;
      const here = sentences.filter((s) => s.page === page);
      const bbox = rect(50, 200, 500, 200);
      figures.push({
        id,
        kind: table ? 'table' : 'figure',
        number: String(i + 1),
        page,
        bbox,
        caption: `${table ? 'Table' : 'Figure'} ${i + 1}: results of setting ${i + 1} on the benchmark.`,
        image: `figures/${id}.png`,
        panels: Array.from({ length: 4 }, (_, k) => ({
          id: `${id}.panel${k + 1}`,
          bbox: rect(60 + k * 100, 210, 90, 80),
        })),
        referenced_by: here.slice(0, 2).map((s) => s.id),
        ...(table
          ? {
              grid: {
                confidence: 'high' as const,
                method: 'spans' as const,
                columns: [
                  { name: 'Accuracy', kind: 'number' as const, better: 'up' as const },
                  { name: 'Cost', kind: 'number' as const, unit: 'ms', better: 'down' as const },
                ],
                rows: ['Base', 'Ours', 'Large'].map((label, r) => ({
                  label,
                  cells: [
                    { text: `${60 + r * 7}.5`, value: 60 + r * 7.5 },
                    { text: `${10 + r * 5}`, value: 10 + r * 5 },
                  ],
                })),
              },
            }
          : {}),
      });
      if (i < 2)
        for (let k = 0; k < 70; k++)
          blocks.push({
            id: `p${page}.t${i}.${k}`,
            page,
            type: table ? 'table_text' : 'figure_text',
            bbox: rect(55 + (k % 10) * 40, 205 + Math.floor(k / 10) * 20, 30, 10),
            text: `${k}`,
            sentences: [],
          });
    }
  }
  return {
    schema: 'paper-tour/doc@0.1',
    source: {
      file: 'long.pdf',
      sha256: 'd'.repeat(64),
      num_pages: pages,
      generator: 'test',
      title: `A long ${kind}`,
      ...(slides ? { layout: 'slides' } : {}),
    } as Doc['source'],
    pages: Array.from({ length: pages }, (_, i) => ({
      n: i + 1,
      width: slides ? 960 : 595,
      height: slides ? 540 : 842,
    })),
    sections,
    blocks,
    sentences,
    figures,
    equations,
    ...(kind === 'sheet' ? { exercises } : {}),
  };
}
