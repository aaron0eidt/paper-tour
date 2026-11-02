import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardItem, Tour } from '../../shared/paper';
import type { ProgramItem } from '../../shared/program';
import { HarnessTourGenerator } from './harness-fixture';
import { EXPLAIN, card, direct, input, planFor, provider, settings, type Request } from './plan-fixture';

/** A paper-specific construction, with an explicitly illustrative threshold rather than invented measurements. */
const valve: ProgramItem = {
  kind: 'program',
  title: 'Illustrative moisture threshold',
  objective: 'Show how comparing a moisture reading with a threshold opens or closes the irrigation valve.',
  source: 'illustrative',
  sourceRefs: ['p1.s3'],
  parameters: [{ name: 'moisture', label: 'Illustrative moisture', value: 0.2, min: 0, max: 1, step: 0.1 }],
  data: [],
  code: `({t,params,math,svg,theme})=>{
    const threshold=0.5,open=math.record('valve_open',params.moisture<threshold?1:0);
    math.record('moisture',params.moisture);
    let out=svg.text(30,40,'Illustrative probe reading and valve control');
    out+=svg.line(60,145,500,145)+svg.rect(60,110,440*params.moisture,35,{fill:theme.blue});
    out+=svg.line(60+440*threshold,85,60+440*threshold,165,{stroke:theme.orange});
    out+=svg.text(60,195,'Moisture '+math.fmt(params.moisture))+svg.text(300,195,'Threshold '+threshold);
    out+=svg.circle(300,285,38,{fill:open?theme.green:theme.panel,stroke:theme.green});
    out+=svg.text(300,292,open?'OPEN':'SHUT',{'text-anchor':'middle',fill:theme.text});
    out+=svg.vector(150,285,250,285,{stroke:theme.blue});
    if(open&&t>.25)for(let i=0;i<3;i++)out+=svg.circle(370+((t*75+i*22)%150),285,7,{fill:theme.blue});
    out+=svg.text(60,380,open?'Below threshold: water reaches the dry patch':'Above threshold: no water is spent');
    return svg.scene(out);
  }`,
};
const broken: ProgramItem = { ...valve, code: '()=>{throw Error("The valve construction needs repair")}' };
const narration = `${EXPLAIN} The illustrative moisture threshold compares a reading with the controller's cutoff. A reading below that threshold opens the valve, while a reading above it keeps the valve shut. Follow the reading into the comparison, then the water flowing to the dry patch.`;
type Event = { type: string; data: Record<string, unknown> };
type ProviderBody = {
  response_format: { json_schema: { name: string } };
  messages: { role: string; content: string | { type: string; image_url?: { url: string }; text?: string }[] }[];
};

function scripted(initial = valve, repaired = valve) {
  const requests: Request[] = [],
    bodies: ProviderBody[] = [],
    events: Event[] = [];
  const model = provider((request) => {
    requests.push(request);
    if (request.name === 'paper_card') return card;
    if (request.name === 'visual_plan')
      return planFor(request, (beat) =>
        beat === 'method-1'
          ? { visual: 'program', idea: valve.objective, data: 'Illustrative normalized moisture reading and cutoff.' }
          : 'none',
      );
    if (request.name === 'authored_visual_review') return { problems: [] };
    if (request.name === 'authored_visual_repair') return repaired;
    const method = /STEP KIND: method\b/.test(request.task);
    return direct(request, method ? narration : EXPLAIN, method ? { program: initial } : {});
  });
  const transport: typeof fetch = async (url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as ProviderBody);
    return model(url, init);
  };
  const generator = new HarnessTourGenerator({ ...settings, timeoutMs: 20_000 }, 'standard', transport);
  const generate = () =>
    generator.generate({
      ...input,
      onEvent: async (type, data) => {
        events.push({ type, data });
      },
    });
  return { requests, bodies, events, generate };
}

function methodVisual(tour: Tour): BoardItem {
  const step = tour.chapters.flatMap((chapter) => chapter.steps).find((step) => step.id === 'method-1');
  assert.ok(step, 'the directed method step must survive');
  const board = step.actions.find((action) => action.type === 'board');
  assert.ok(board?.type === 'board', 'a native fallback or missing board cannot count as authored success');
  assert.equal(board.item.kind, 'program', 'the actual authored program must be published');
  return board.item;
}

function assertReviewedBeforePublication(events: Event[]) {
  const started = events.findIndex(
    (event) =>
      event.type === 'tool.started' &&
      event.data.name === 'render_visual' &&
      (event.data.arguments as { beat?: string })?.beat === 'method-1',
  );
  const completed = events.findIndex(
    (event) => event.type === 'tool.completed' && event.data.name === 'render_visual' && event.data.beat === 'method-1',
  );
  const review = events.findIndex(
    (event) => event.type === 'model.started' && event.data.name === 'authored_visual_review',
  );
  assert.ok(
    started >= 0 && review > started && completed > review,
    'record rendering and independent review inside the tool span',
  );
  const reviewId = events[review].data.callId;
  const verdict = events.findIndex((event) => event.type === 'model.completed' && event.data.callId === reviewId);
  assert.ok(verdict > review && verdict < completed, 'the reviewer verdict must complete before inspection succeeds');
  const finished = events.findIndex((event) => event.type === 'beat.completed' && event.data.beat === 'method-1');
  assert.ok(finished > completed, 'the beat cannot complete before its authored visual is reviewed');
  const published = events.findIndex(
    (event) =>
      event.type === 'tour.partial' &&
      !!event.data.tour &&
      (event.data.tour as Tour).chapters.some((chapter) => chapter.steps.some((step) => step.id === 'method-1')),
  );
  assert.ok(published > completed, 'a progressive tour cannot publish uninspected visual code');
  assert.equal(events[completed].data.failed, undefined);
}

test('tour generation keeps a free-code program after actual frame rendering and independent recorded review', async () => {
  const fixture = scripted();
  const { tour } = await fixture.generate();
  assert.deepEqual(methodVisual(tour), valve);
  const reviewBodies = fixture.bodies.filter(
    (body) => body.response_format.json_schema.name === 'authored_visual_review',
  );
  assert.equal(reviewBodies.length, 1, 'one independent review for the planned authored method visual');
  const parts = reviewBodies[0].messages.flatMap((message) =>
    typeof message.content === 'string' ? [] : message.content,
  );
  const images = parts.flatMap((part) =>
    part.type === 'image_url' && part.image_url?.url ? [part.image_url.url] : [],
  );
  const frames = images.slice(0, 5);
  assert.equal(frames.length, 5, 'the model must receive five real rendered frames');
  for (const image of frames) {
    assert.match(image, /^data:image\/png;base64,/);
    const bytes = Buffer.from(image.split(',')[1], 'base64');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(bytes.length > 1000, 'a source placeholder is not a rendered visual');
  }
  assert.ok(new Set(frames).size > 1, 'the rendered construction changes with narration time');
  assert.match(fixture.requests.find((request) => request.name === 'authored_visual_review')!.task, /valve_open/);
  assertReviewedBeforePublication(fixture.events);
});

test('tour generation repairs a runtime-broken program before publishing its corrected visual', async () => {
  const fixture = scripted(broken);
  const { tour } = await fixture.generate();
  assert.deepEqual(methodVisual(tour), valve);
  const repairs = fixture.requests.filter((request) => request.name === 'authored_visual_repair');
  assert.equal(repairs.length, 1, 'repair the executable scene rather than re-planning or substituting a native board');
  assert.match(repairs[0].task, /The valve construction needs repair/);
  assert.equal(fixture.requests.filter((request) => request.name === 'authored_visual_review').length, 1);
  const repairStart = fixture.events.findIndex(
    (event) => event.type === 'model.started' && event.data.name === 'authored_visual_repair',
  );
  const reviewStart = fixture.events.findIndex(
    (event) => event.type === 'model.started' && event.data.name === 'authored_visual_review',
  );
  assert.ok(repairStart >= 0 && reviewStart > repairStart);
  assertReviewedBeforePublication(fixture.events);
});

test('tour generation stops after bounded visual repairs and never publishes persistently broken code', async () => {
  const fixture = scripted(broken, broken);
  await assert.rejects(fixture.generate(), /Authored visual failed inspection/);
  assert.equal(fixture.requests.filter((request) => request.name === 'authored_visual_repair').length, 2);
  assert.equal(fixture.requests.filter((request) => request.name === 'authored_visual_review').length, 0);
  assert.ok(
    fixture.events.some(
      (event) => event.type === 'tool.completed' && event.data.name === 'render_visual' && event.data.failed === true,
    ),
  );
  assert.ok(fixture.events.some((event) => event.type === 'beat.failed' && event.data.beat === 'method-1'));
  assert.ok(!fixture.events.some((event) => event.type === 'beat.completed' && event.data.beat === 'method-1'));
  assert.ok(
    !fixture.events.some(
      (event) =>
        event.type === 'tour.partial' &&
        !!event.data.tour &&
        (event.data.tour as Tour).chapters.some((chapter) => chapter.steps.some((step) => step.id === 'method-1')),
    ),
  );
});
