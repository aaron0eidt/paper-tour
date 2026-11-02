import type { ProgramItem } from '../../../shared/program';
import type { PlotlyItem } from '../../../shared/plotly';

// Evaluation cases exercise a free program contract, not templates used in production generation.
export const attention: ProgramItem = {
  kind: 'program',
  title: 'Illustrative attention weights',
  objective: 'Scaling reduces score differences and spreads the weighted mixture.',
  source: 'illustrative',
  sourceRefs: ['eq-attention'],
  data: [{ name: 'values', values: [10, 0] }],
  parameters: [
    { name: 'score', label: 'First similarity', value: 4, min: 0, max: 8, step: 0.5 },
    { name: 'dimension', label: 'Key dimension', value: 4, min: 1, max: 16, step: 1 },
  ],
  code: `({t,params,data,math,svg,theme})=>{
    const scores=[params.score/Math.sqrt(params.dimension),0],weights=math.record('weights',math.softmax(scores)),out=math.record('output',math.dot(weights,data.values));
    let drawing=svg.text(30,35,'Scaled scores → weights → mixture');
    scores.forEach((v,i)=>{drawing+=svg.text(35,90+i*60,'key '+(i+1))+svg.rect(110,70+i*60,Math.max(2,v*35),25,{fill:theme.orange})+svg.text(300,90+i*60,math.fmt(v));});
    if(t>=.25)weights.forEach((v,i)=>{drawing+=svg.rect(110,210+i*55,350*v*math.phase(t,.25,.6),25,{fill:i?theme.pink:theme.blue})+svg.text(35,230+i*55,'w'+(i+1))+svg.text(470,230+i*55,math.fmt(v));});
    if(t>=.7)drawing+=svg.text(35,365,'Weighted value = '+math.fmt(out),{fill:theme.green});
    return svg.scene(drawing);
  }`,
};
export const backprop: ProgramItem = {
  kind: 'program',
  title: 'Gradient paths',
  objective: 'A weight receives the sum of gradient contributions from both downstream paths.',
  source: 'illustrative',
  sourceRefs: ['network-equations'],
  data: [],
  parameters: [{ name: 'weight', label: 'Shared input weight', value: 0.7, min: -2, max: 2, step: 0.1 }],
  code: `({t,params,math,svg,theme})=>{
    const x=1.2,a=Math.tanh(params.weight*x),b=Math.tanh(a*.8),c=Math.tanh(a*-.4),y=b*.6+c*.3;
    const gradient=math.record('gradient',x*(1-a*a)*(.6*(1-b*b)*.8+.3*(1-c*c)*-.4));math.record('prediction',y);
    const nodes=[['x',60,210,x],['a',220,210,a],['b',380,110,b],['c',380,310,c],['y',540,210,y]],edges=[[0,1],[1,2],[1,3],[2,4],[3,4]];
    let out=svg.text(25,35,'Forward values and reverse gradient paths');
    edges.forEach(([u,v],i)=>{const A=nodes[u],B=nodes[v];out+=svg.vector(Number(A[1])+24,Number(A[2]),Number(B[1])-24,Number(B[2]),{stroke:t>.5?theme.pink:theme.muted,'stroke-width':t>.5?4:2});});
    nodes.forEach(([label,x,y,value])=>{out+=svg.circle(x,y,24,{fill:theme.panel,stroke:theme.blue})+svg.text(x,Number(y)+6,label,{'text-anchor':'middle'})+svg.text(x,Number(y)+47,math.fmt(Number(value)),{'text-anchor':'middle',fill:theme.green});});
    if(t>.5)out+=svg.text(35,390,'dy/dw = '+math.fmt(gradient),{fill:theme.pink});
    return svg.scene(out,620,440);
  }`,
};
export const measured: PlotlyItem = {
  kind: 'plotly',
  title: 'Quality and training cost',
  objective: 'Compare measured translation quality against training cost on logarithmic axes.',
  source: 'document',
  sourceRefs: ['table-results'],
  functions: [],
  figure: JSON.stringify({
    data: [
      {
        type: 'scatter',
        mode: 'markers+text',
        name: 'EN-DE',
        x: [7.7e19, 3.3e18, 2.3e19],
        y: [26.36, 27.3, 28.4],
        text: ['Ensemble', 'Transformer base', 'Transformer big'],
      },
    ],
    layout: {
      xaxis: { title: { text: 'Training cost (FLOPs)' }, type: 'log' },
      yaxis: { title: { text: 'BLEU (EN-DE)' } },
    },
  }),
};
