// Light structural checks on loaded JSON, so the player can explain a broken file instead of
// crashing. ingest/validate.py is the full validator against the schemas.

const MAX_ERRORS = 8;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBBox = (v: unknown) => Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number');

const ACTION_FIELDS: Record<string, string[]> = {
  focus: ['target'],
  zoom: ['target'],
  highlight: ['targets'],
  box: ['target'],
  spotlight: ['target'],
  note: ['anchor', 'text'],
  clear: [],
};

export function checkDoc(doc: unknown): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.length < MAX_ERRORS && errors.push(m);
  if (!isObj(doc)) return ['doc.json is not a JSON object'];
  if (doc.schema !== 'paper-tour/doc@0.1') err(`schema is ${JSON.stringify(doc.schema)}, expected "paper-tour/doc@0.1"`);
  if (!isObj(doc.source)) err('source is missing');
  for (const key of ['pages', 'sections', 'blocks', 'sentences', 'figures', 'equations']) {
    if (!Array.isArray(doc[key])) err(`${key} must be an array`);
  }
  const each = (key: string, fn: (item: Obj, path: string) => void) => {
    const list = doc[key];
    if (Array.isArray(list)) list.forEach((item, i) => (isObj(item) ? fn(item, `${key}[${i}]`) : err(`${key}[${i}] is not an object`)));
  };
  const needs = (item: Obj, path: string, fields: string[]) => {
    for (const f of fields) if (item[f] === undefined) err(`${path}.${f} is missing`);
  };
  each('pages', (p, path) => needs(p, path, ['n', 'width', 'height']));
  each('sections', (s, path) => needs(s, path, ['id', 'page', 'block']));
  each('blocks', (b, path) => {
    needs(b, path, ['id', 'page', 'type', 'bbox', 'sentences']);
    if (b.bbox !== undefined && !isBBox(b.bbox)) err(`${path}.bbox must be [x0, y0, x1, y1]`);
    if (b.sentences !== undefined && !Array.isArray(b.sentences)) err(`${path}.sentences must be an array`);
  });
  each('sentences', (s, path) => {
    needs(s, path, ['id', 'page', 'block', 'rects']);
    if (!Array.isArray(s.rects) || !s.rects.every(isBBox)) err(`${path}.rects must be a list of bboxes`);
  });
  each('figures', (f, path) => {
    needs(f, path, ['id', 'page', 'bbox', 'panels']);
    if (!isBBox(f.bbox)) err(`${path}.bbox must be [x0, y0, x1, y1]`);
    if (!Array.isArray(f.panels) || !f.panels.every((p) => isObj(p) && typeof p.id === 'string' && isBBox(p.bbox))) {
      err(`${path}.panels must be a list of {id, bbox}`);
    }
  });
  each('equations', (e, path) => {
    needs(e, path, ['id', 'page', 'bbox']);
    if (!isBBox(e.bbox)) err(`${path}.bbox must be [x0, y0, x1, y1]`);
  });
  return errors;
}

export function checkTour(tour: unknown): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.length < MAX_ERRORS && errors.push(m);
  if (!isObj(tour)) return ['tour.json is not a JSON object'];
  if (tour.schema !== 'paper-tour/tour@0.1') err(`schema is ${JSON.stringify(tour.schema)}, expected "paper-tour/tour@0.1"`);
  if (typeof tour.title !== 'string') err('title is missing');
  if (!Array.isArray(tour.chapters) || !tour.chapters.length) return [...errors, 'chapters must be a non-empty array'];
  tour.chapters.forEach((ch, ci) => {
    const cpath = `chapters[${ci}]`;
    if (!isObj(ch) || !Array.isArray(ch.steps) || !ch.steps.length) return err(`${cpath}.steps must be a non-empty array`);
    ch.steps.forEach((st, si) => {
      const spath = `${cpath}.steps[${si}]`;
      if (!isObj(st)) return err(`${spath} is not an object`);
      if (typeof st.id !== 'string') err(`${spath}.id is missing`);
      if (typeof st.say !== 'string' || !st.say.trim()) err(`${spath}.say must be a non-empty string`);
      if (!Array.isArray(st.actions)) return err(`${spath}.actions must be an array`);
      st.actions.forEach((a, ai) => {
        const apath = `${spath}.actions[${ai}]`;
        const fields = isObj(a) ? ACTION_FIELDS[a.type as string] : undefined;
        if (!isObj(a) || !fields) return err(`${apath}.type ${JSON.stringify(isObj(a) ? a.type : a)} is not a known action`);
        for (const f of fields) if (a[f] === undefined) err(`${apath}.${f} is missing`);
        if (a.type === 'highlight' && (!Array.isArray(a.targets) || !a.targets.length)) err(`${apath}.targets must be a non-empty array`);
      });
    });
  });
  return errors;
}
