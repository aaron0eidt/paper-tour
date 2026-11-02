import { PROGRAM_LIMITS, programProblems, type ProgramFrame, type ProgramItem } from './program';

/** All helpers execute inside QuickJS: no native function or application object crosses the sandbox boundary. */
export const PROGRAM_HELPERS = String.raw`
const trace=[];
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const tag=(name,attrs,body='')=>'<'+name+' '+Object.entries(attrs||{}).filter(([,v])=>v!==undefined).map(([k,v])=>k+'="'+esc(v)+'"').join(' ')+'>'+body+'</'+name+'>';
const math=Object.freeze({
  clamp:(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),
  lerp:(a,b,t)=>a+(b-a)*Math.max(0,Math.min(1,t)),
  phase:(t,start,end)=>Math.max(0,Math.min(1,(t-start)/(end-start))),
  softmax:xs=>{const m=Math.max(...xs),e=xs.map(x=>Math.exp(x-m)),s=e.reduce((a,b)=>a+b,0);return e.map(x=>x/s)},
  dot:(a,b)=>{if(a.length!==b.length)throw Error('Dot product dimensions differ');return a.reduce((s,x,i)=>s+x*b[i],0)},
  matmul:(a,b)=>{if(!a.length||!b.length||a.some(r=>r.length!==b.length)||b.some(r=>r.length!==b[0].length))throw Error('Matrix dimensions differ');return a.map(row=>b[0].map((_,j)=>row.reduce((s,v,k)=>s+v*b[k][j],0)))},
  record:(label,value)=>{if(!Number.isFinite(value)&&!(Array.isArray(value)&&value.every(Number.isFinite)))throw Error('Calculation '+label+' is not finite');trace.push({label:String(label),value});return value},
  fmt:(x,d=3)=>Number(x.toFixed(d)).toString()
});
const svg=Object.freeze({
  tag,esc,
  scene:(content,w=600,h=420)=>tag('svg',{xmlns:'http://www.w3.org/2000/svg',viewBox:'0 0 '+w+' '+h,width:w,height:h,fill:theme.text,'font-family':'Arial, sans-serif','font-size':18},content),
  group:(content,attrs={})=>tag('g',attrs,content),
  text:(x,y,value,attrs={})=>tag('text',{x,y,...attrs},esc(value)),
  line:(x1,y1,x2,y2,attrs={})=>tag('line',{x1,y1,x2,y2,stroke:theme.muted,'stroke-width':2,...attrs}),
  rect:(x,y,width,height,attrs={})=>tag('rect',{x,y,width,height,rx:4,fill:theme.blue,...attrs}),
  circle:(cx,cy,r,attrs={})=>tag('circle',{cx,cy,r,fill:theme.blue,...attrs}),
  path:(d,attrs={})=>tag('path',{d,fill:'none',stroke:theme.blue,'stroke-width':3,...attrs}),
  vector:(x1,y1,x2,y2,attrs={})=>{const a=Math.atan2(y2-y1,x2-x1),r=9;return svg.line(x1,y1,x2,y2,attrs)+svg.path('M'+(x2-r*Math.cos(a-.45))+' '+(y2-r*Math.sin(a-.45))+' L'+x2+' '+y2+' L'+(x2-r*Math.cos(a+.45))+' '+(y2-r*Math.sin(a+.45)),attrs)},
  plot:(fn,domain,range,box,attrs={})=>{let d='';const n=160;for(let i=0;i<=n;i++){const u=domain[0]+(domain[1]-domain[0])*i/n,v=fn(u);if(!Number.isFinite(v)||v<range[0]||v>range[1]){d+=' ';continue}const x=box[0]+box[2]*i/n,y=box[1]+box[3]*(1-(v-range[0])/(range[1]-range[0]));d+=(i===0||d.endsWith(' ')?'M':'L')+x+' '+y;}return svg.path(d,attrs)},
  matrix:(x,y,rows,label='',color=theme.blue)=>{const cw=48,ch=36,w=rows[0].length*cw,h=rows.length*ch;let out=label?svg.text(x,y-14,label,{fill:color}):'';rows.forEach((row,i)=>row.forEach((v,j)=>{out+=svg.rect(x+j*cw,y+i*ch,cw-3,ch-3,{fill:theme.panel,stroke:color})+svg.text(x+j*cw+cw/2,y+i*ch+ch/2+5,math.fmt(v),{'text-anchor':'middle',fill:color})}));return out;}
});
Math.random=()=>{throw Error('Use deterministic functions of host time and parameters, not Math.random')};Object.freeze(Math);globalThis.Date=undefined;globalThis.fetch=undefined;globalThis.setTimeout=undefined;
`;
export const PROGRAM_THEME = Object.freeze({
  text: '#e7e9f0',
  muted: '#a3adc0',
  panel: '#1a2130',
  blue: '#7ea6ff',
  pink: '#ef8ac9',
  green: '#6fd3b1',
  orange: '#ffb96f',
  yellow: '#e7d86b',
});

const TAGS = new Set([
  'svg',
  'g',
  'path',
  'line',
  'polyline',
  'polygon',
  'rect',
  'circle',
  'ellipse',
  'text',
  'tspan',
  'defs',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'marker',
  'title',
  'desc',
]);
const ATTRS = new Set([
  'xmlns',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'color',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'transform',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'dx',
  'dy',
  'id',
  'clip-path',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'marker-end',
  'marker-start',
  'preserveAspectRatio',
  'role',
  'aria-label',
  'data-part',
]);
export interface SceneCanvas {
  width: number;
  height: number;
}
export interface SvgInspection {
  canvas?: SceneCanvas;
  elements: number;
  labels: string[];
  problems: string[];
}
/** Allow only inert SVG. No scripts, styles, events, external assets, entities, animations or foreign HTML. */
export interface ProgramRuntimeAdapter {
  evaluate(script: string, milliseconds: number): Promise<string>;
  parseSvg(source: string): unknown;
}
export function inspectProgramSvg(source: string, parse: ProgramRuntimeAdapter['parseSvg']): SvgInspection {
  const result: SvgInspection = { elements: 0, labels: [], problems: [] };
  if (
    typeof source !== 'string' ||
    !source ||
    source.length > PROGRAM_LIMITS.svg ||
    /<!DOCTYPE|<!ENTITY|<\?/i.test(source)
  )
    return { ...result, problems: ['Scene output must be a bounded SVG without declarations or entities.'] };
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch {
    return { ...result, problems: ['Scene output is not valid SVG/XML.'] };
  }
  const walk = (nodes: Record<string, unknown>[], depth = 0) => {
    if (depth > 32) {
      result.problems.push('SVG nesting exceeds 32 levels.');
      return;
    }
    for (const node of nodes)
      for (const [name, children] of Object.entries(node)) {
        if (name === ':@') continue;
        if (name === '#text') {
          if (typeof children === 'string' && children.trim()) result.labels.push(children.trim());
          continue;
        }
        result.elements++;
        if (!TAGS.has(name)) result.problems.push(`SVG element ${name} is not allowed.`);
        const attrs = (node[':@'] ?? {}) as Record<string, string>;
        for (const [key, raw] of Object.entries(attrs)) {
          const attr = key.replace(/^@_/, ''),
            value = String(raw);
          if (!ATTRS.has(attr)) result.problems.push(`SVG attribute ${attr} is not allowed.`);
          if (
            /(?:https?:|file:|javascript:|data:|@import|expression\s*\()/i.test(value) &&
            !(attr === 'xmlns' && value === 'http://www.w3.org/2000/svg')
          )
            result.problems.push('SVG cannot reference external resources.');
          if (/url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/.test(value))
            result.problems.push('SVG paint references must be local IDs.');
          if (attr === 'font-size' && Number.isFinite(Number(value)) && Number(value) < 12)
            result.problems.push('Text must be at least 12 scene units high.');
        }
        if (Array.isArray(children)) walk(children as Record<string, unknown>[], depth + 1);
      }
  };
  if (!Array.isArray(parsed) || parsed.length !== 1 || !('svg' in parsed[0]))
    result.problems.push('Scene must have an SVG root.');
  else {
    const attrs = (parsed[0][':@'] ?? {}) as Record<string, unknown>;
    const box = String(attrs['@_viewBox'] ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const width = Number(attrs['@_width']),
      height = Number(attrs['@_height']);
    if (
      box.length !== 4 ||
      !box.every(Number.isFinite) ||
      Math.abs(box[0]) > 10000 ||
      Math.abs(box[1]) > 10000 ||
      box[2] < 16 ||
      box[3] < 16 ||
      box[2] > 2000 ||
      box[3] > 2000 ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 16 ||
      height < 16 ||
      width > 2000 ||
      height > 2000 ||
      width / height < 0.25 ||
      width / height > 4 ||
      Math.abs(width / height - box[2] / box[3]) > 0.01
    ) {
      result.problems.push(
        'SVG needs finite width/height and a matching viewBox, dimensions 16–2000 and aspect ratio between 1:4 and 4:1.',
      );
    } else result.canvas = { width, height };
    walk(parsed);
  }
  if (result.elements > PROGRAM_LIMITS.elements) result.problems.push('Scene contains too many elements.');
  if (!result.labels.length) result.problems.push('A teaching scene needs readable labels or numeric annotations.');
  return { ...result, problems: [...new Set(result.problems)] };
}

/** Build and validate a deterministic frame; the adapter must enforce the isolated CPU/memory boundary. */
export async function renderProgramFrame(
  item: ProgramItem,
  t: number,
  adapter: ProgramRuntimeAdapter,
  overrides: Record<string, number> = {},
  milliseconds = 100,
): Promise<ProgramFrame> {
  const problems = programProblems(item);
  if (problems.length) throw new Error(problems.join('; '));
  if (!Number.isFinite(t)) throw new Error('Scene time must be finite.');
  const params = Object.fromEntries(
    item.parameters.map((p) => [
      p.name,
      Number.isFinite(overrides[p.name]) ? Math.max(p.min, Math.min(p.max, overrides[p.name])) : p.value,
    ]),
  );
  const data = Object.fromEntries(item.data.map((d) => [d.name, d.values]));
  const input = JSON.stringify({ t: Math.max(0, Math.min(1, t)), params, data, theme: PROGRAM_THEME });
  const script = `(()=>{const {t,params,data,theme}=${input};${PROGRAM_HELPERS}\nconst render=(${item.code});if(typeof render!=='function')throw Error('Code must be a function expression');const output=render({t,params,data,theme,math,svg});if(typeof output!=='string')throw Error('Render must return an SVG string');return JSON.stringify({svg:output,calculations:trace});})()`;
  const json = await adapter.evaluate(script, milliseconds);
  if (json.length > PROGRAM_LIMITS.svg * 2) throw new Error('Scene output exceeds the render budget.');
  const frame = JSON.parse(json) as ProgramFrame;
  const inspected = inspectProgramSvg(frame.svg, adapter.parseSvg);
  if (inspected.problems.length) throw new Error(inspected.problems.join('; '));
  return frame;
}

/** Bound both output axes/pixels before a rasterizer can allocate its surface. */
export function programRasterSize(canvas: SceneCanvas): SceneCanvas {
  const scale = 900 / Math.max(canvas.width, canvas.height);
  const width = Math.ceil(canvas.width * scale),
    height = Math.ceil(canvas.height * scale);
  if (
    ![width, height].every(Number.isFinite) ||
    width < 1 ||
    height < 1 ||
    width > 900 ||
    height > 900 ||
    width * height > 810000
  )
    throw new Error('Scene exceeds the raster pixel budget.');
  return { width, height };
}
