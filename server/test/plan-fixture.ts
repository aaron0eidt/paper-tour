import type { MuseConfig } from '../src/config';
import type { Doc } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';

// A small paper in a field of its own, with a scripted model transport, for the visual-plan and narration-check tests.

export const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';

export const texts: Record<string, string> = {
  'p1.s1':
    'Orchard growers water on a fixed schedule even though soil dries at very different speeds across a single field.',
  'p1.s2': 'We propose a network of cheap moisture probes that tells each valve when its patch of soil is dry.',
  'p1.s3': 'Each probe reports a reading every ten minutes and a controller opens the nearest valve below a threshold.',
  'p1.s4': 'Figure 1 shows the layout of probes and valves.',
  'p2.s1': 'Across forty trees the probe network used 31.4 percent less water than the fixed schedule.',
  'p2.s2': 'Yield stayed within 2.1 percent of the fixed schedule while pumping cost fell by 18.2 percent.',
  'p2.s3': 'However, probes placed near irrigation lines read wetter than the surrounding soil and need recalibration.',
  'p2.s4': 'In conclusion, watering by measured need saves water without a visible loss in yield.',
};
const sentence = (id: string) => ({
  id,
  page: Number(id[1]),
  block: `p${id[1]}.b2`,
  text: texts[id],
  rects: [[0, 0, 100, 10]] as [number, number, number, number][],
});
export const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'c'.repeat(64), num_pages: 2, generator: 'test', title: 'Watering by need' },
  pages: [
    { n: 1, width: 600, height: 800 },
    { n: 2, width: 600, height: 800 },
  ],
  sections: [
    { id: 'sec-1', number: '1', title: 'Introduction', level: 1, page: 1, block: 'p1.b1' },
    { id: 'sec-2', number: '2', title: 'Results', level: 1, page: 2, block: 'p2.b1' },
  ],
  blocks: [
    {
      id: 'p1.b1',
      page: 1,
      type: 'heading',
      bbox: [0, 0, 100, 10],
      text: '1 Introduction',
      section: 'sec-1',
      sentences: [],
    },
    {
      id: 'p1.b2',
      page: 1,
      type: 'paragraph',
      bbox: [0, 20, 500, 120],
      text: '',
      section: 'sec-1',
      sentences: ['p1.s1', 'p1.s2', 'p1.s3', 'p1.s4'],
    },
    {
      id: 'p2.b1',
      page: 2,
      type: 'heading',
      bbox: [0, 0, 100, 10],
      text: '2 Results',
      section: 'sec-2',
      sentences: [],
    },
    {
      id: 'p2.b2',
      page: 2,
      type: 'paragraph',
      bbox: [0, 20, 500, 120],
      text: '',
      section: 'sec-2',
      sentences: ['p2.s1', 'p2.s2', 'p2.s3', 'p2.s4'],
    },
    { id: 'p2.b3', page: 2, type: 'equation', bbox: [0, 130, 300, 150], text: 's = 1 - u / b', sentences: [] },
  ],
  sentences: Object.keys(texts).map(sentence),
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 200, 400, 500],
      caption: 'The layout of probes and valves',
      image: 'figures/fig1.png',
      panels: [],
      referenced_by: ['p1.s4'],
    },
  ],
  equations: [{ id: 'eq1', number: '1', page: 2, bbox: [0, 130, 300, 150], block: 'p2.b3', text: 's = 1 - u / b' }],
};
export const images: TourImage[] = [
  { targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: png },
  { targetId: 'page2', kind: 'page', page: 2, label: 'Page 2', dataUrl: png },
  { targetId: 'fig1', kind: 'figure', page: 1, label: 'Figure 1', dataUrl: png },
];
export const input: TourGenerationInput = { documentId: 'doc-plan', analysisId: 'analysis-plan', doc, images };

export const card = {
  plan: 'p',
  doc_type: 'research_paper' as const,
  title: 'Watering by need',
  chapter_titles: {
    problem: 'Problem',
    idea: 'Idea',
    method: 'How it works',
    evidence: 'Evidence',
    limits: 'Limits',
    takeaway: 'Takeaway',
  },
  problem: { text: 'Fixed schedules waste water.', evidence: ['p1.s1'] },
  key_idea: { text: 'Probes tell each valve when the soil is dry.', evidence: ['p1.s2'] },
  method_steps: [{ text: 'A controller opens a valve below a moisture threshold.', evidence: ['p1.s3'] }],
  key_figures: [{ id: 'fig1', why: 'It shows the layout of probes and valves.' }],
  key_formulas: [{ id: 'eq1', why: 'It defines the saving.' }],
  results: [{ text: 'The network used 31.4 percent less water.', evidence: ['p2.s1'] }],
  limitations: [{ text: 'Probes near irrigation lines need recalibration.', evidence: ['p2.s3'] }],
  takeaway: { text: 'Watering by measured need saves water.', evidence: ['p2.s4'] },
  suggested_questions: ['Why probes?', 'How much water is saved?', 'What still fails?'],
};

/** An explanation that adds a cause and a consequence and shares no sentence with the paper. */
export const EXPLAIN =
  'A fixed dose gives wet corners the same water as dry ones, so the cost appears twice: in the pump bill and in roots standing in soggy ground. Letting a measurement set the dose is what makes the amount follow the need.';

export function reply(value: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status },
  );
}
/** One request to the scripted model: the call's name, its response schema, the whole conversation and its brief. */
export type Request = { name: string; schema: any; task: string; messages: string[] };
export function provider(fn: (request: Request) => Response | unknown): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const text = (content: any) =>
      typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n');
    const messages: string[] = body.messages.map((m: any) => text(m.content));
    const result = fn({
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task: messages.join('\n'),
      messages,
    });
    return result instanceof Response ? result : reply(result);
  }) as typeof fetch;
}

/** A visual plan from a pick per listed beat: none, or a kind with a short idea and its data. */
export function planFor(
  request: Request,
  pick: (beat: string) => string | { visual: string; idea: string; data?: string } = () => 'none',
) {
  const beats: string[] = request.schema.properties.beats.items.properties.beat.enum;
  return {
    plan: 'p',
    beats: beats.map((beat) => {
      const chosen = pick(beat);
      const entry =
        typeof chosen === 'string' ? { visual: chosen, idea: chosen === 'none' ? '' : 'Show the idea.' } : chosen;
      return { beat, visual: entry.visual, idea: entry.idea, data: entry.visual === 'none' ? '' : (entry.data ?? '') };
    }),
  };
}
/** A direction for one beat: `say`, and one cue on the first allowed target of its first allowed action. */
export function direct(request: Request, say: string, extra: object = {}) {
  const cue = request.schema.properties.cues.items.properties;
  const target = cue.target.enum?.[0];
  const cues = target
    ? [{ action: cue.action.enum[0], target, label: '', anchor: say.split(' ').slice(0, 3).join(' ') }]
    : [];
  return { plan: 'p', say, cues, ...extra };
}
