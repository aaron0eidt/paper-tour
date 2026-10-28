export const exampleSay =
  'For an illustrative scalar case, the input is 2 and we add it to itself. Adding the input twice gives 4, so this operation doubles the starting value. This small case shows the transformation directly, without claiming it is a measured result from the paper.';
export const numericalExample = () => ({
  assumptions: 'Illustrative scalar input; add the same input to itself.',
  inputs: [{ label: 'Input', value: 2 }],
  calculations: [{ expression: '2+2', result: 4 }],
  frames: [
    {
      anchor: 'the input is',
      flow: {
        title: 'Illustrative input',
        nodes: [
          { id: 'node-1', label: 'Input 2' },
          { id: 'node-2', label: 'Add same input' },
          { id: 'node-3', label: 'Output' },
        ],
        edges: [
          { from: 'node-1', to: 'node-2' },
          { from: 'node-2', to: 'node-3' },
        ],
      },
    },
    {
      anchor: 'Adding the input twice',
      formula: {
        title: 'Illustrative result',
        latex: '2+2=4',
        terms: [
          { latex: '2+2', label: 'Add input twice' },
          { latex: '4', label: 'Result' },
        ],
      },
    },
  ],
});
