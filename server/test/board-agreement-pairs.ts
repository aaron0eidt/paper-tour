import type { BoardItem } from '../../shared/paper';

// Real pairs of a tour step's narration and its board, taken from tours of ten documents written by the live harness
// (papers, a lecture, exercise sheets, contracts and a letter, in English and German): boards the narration fits, two it
// does not speak of (and a borderline one, the ants), and boards with the narration of another step. Kept as written, so that board-agreement.ts is
// checked against what the model writes.

export interface Pair {
  name: string;
  say: string;
  board: BoardItem;
  /** The sentences the step highlights in the document. */
  source?: string;
}

export const FITTING: Pair[] = [
  {
    name: 'shapes: one head keeps a separate subspace',
    say: 'Distant words stay directly linked because every position can reach every other in one step. A single averaging step would blur different kinds of relations together, so the model uses eight separate narrow projections. Each projects the 512-wide representation to 64 dimensions and attends independently, letting one subspace track one kind of dependency while others track different kinds.',
    board: {
      kind: 'shapes',
      title: 'One head keeps separate subspace',
      terms: [
        { kind: 'matrix', name: 'X', rows: 'n', cols: '512' },
        { kind: 'op', op: 'times' },
        { kind: 'matrix', name: 'W^Q_i', rows: '512', cols: '64' },
        { kind: 'op', op: 'equals' },
        { kind: 'matrix', name: 'head_i', rows: 'n', cols: '64' },
      ],
    },
  },
  {
    name: 'bars: development BLEU by model size',
    say: 'Larger Transformer scale improves development translation quality because added capacity raises BLEU from 25.8 for base to 26.4 for big, a gain of 0.6 on newstest2013. Base trained 12 hours and big 3.5 days on eight P100 GPUs for WMT 2014 translation. This covers only that setup and development BLEU, not test quality or other hardware.',
    board: {
      kind: 'bars',
      title: 'Development BLEU by model size',
      unit: 'BLEU',
      higher_is_better: true,
      bars: [
        { label: 'base', value: 25.8 },
        { label: 'big', value: 26.4 },
      ],
    },
  },
  {
    name: 'scatter: BLEU against training cost',
    say: 'Transformer sets new best translation quality on these tests because higher BLEU appears at lower training cost. On English-German newstest2014, big Transformer reaches 28.4 BLEU versus 26.36 for ConvS2S Ensemble, a gain over 2 points. Results cover only WMT 2014 English-German and English-French newstest2014, so they do not show other languages.',
    board: {
      kind: 'scatter',
      title: 'BLEU EN-DE against Training Cost (FLOPs) EN-DE',
      x_label: 'Training Cost (FLOPs) EN-DE',
      y_label: 'BLEU EN-DE',
      x_log: true,
      better: 'up-left',
      points: [
        { label: 'GNMT + RL', x: 23000000000000000000, y: 24.6 },
        { label: 'ConvS2S', x: 9600000000000000000, y: 25.16 },
        { label: 'MoE', x: 20000000000000000000, y: 26.03 },
        { label: 'GNMT + RL Ensemble', x: 180000000000000000000, y: 26.3 },
        { label: 'ConvS2S Ensemble', x: 77000000000000000000, y: 26.36 },
        { label: 'Transformer (base model)', x: 3300000000000000000, y: 27.3 },
        { label: 'Transformer (big)', x: 23000000000000000000, y: 28.4 },
      ],
      source: 'document',
    },
  },
  {
    name: 'formula: scaled dot-product attention',
    say: 'This equation defines how queries, keys and values produce weighted outputs. Q times K transposed measures compatibility of each query with all keys. Division by the square root of d k keeps dot products small so the softmax stays in a region with usable gradients. The softmax turns those scaled scores into weights summing to one. Multiplying by V mixes the values according to those weights, so the output emphasizes values whose keys match the query.',
    board: {
      kind: 'formula',
      title: 'Scaled dot-product attention',
      latex: '\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}(\\frac{QK^T}{\\sqrt{d_k}})V',
      terms: [
        { latex: 'QK^T', label: 'compatibility of queries and keys' },
        { latex: '\\sqrt{d_k}', label: 'scale preventing tiny gradients' },
        { latex: '\\mathrm{softmax}', label: 'weights summing to one' },
        { latex: 'V', label: 'values being mixed' },
      ],
    },
  },
  {
    name: 'flow: multi-head scaled attention',
    say: 'The authors define attention over vector queries, keys and values. Each query is compared to all keys by dot product, then divided by square root of key dimension and passed through softmax to weight the values. Rather than one large attention, queries keys and values are linearly projected eight times into smaller 64-dimensional spaces, attended in parallel, then concatenated and projected again. This lets different heads capture different subspaces.',
    board: {
      kind: 'flow',
      title: 'Multi-head scaled attention',
      nodes: [
        { id: 'node-1', label: 'Project QKV' },
        { id: 'node-2', label: 'Scale dot products' },
        { id: 'node-3', label: 'Softmax weight values' },
        { id: 'node-4', label: 'Concatenate heads' },
        { id: 'node-5', label: 'Project output' },
      ],
      edges: [
        ['node-1', 'node-2'],
        ['node-2', 'node-3'],
        ['node-3', 'node-4'],
        ['node-4', 'node-5'],
      ],
    },
  },
  {
    name: 'formula: the sigmoid of a weighted sum',
    say: "After nearest-neighbor voting, these slides move to a model that learns from data, building on slide 3's discrete label task. The lecture presents logistic regression as a way to turn features into probability of an event like survival. First it takes a weighted sum of the features, w transposed times x, so each weight shows direction and strength. The bias b shifts where the decision flips. Finally the sigmoid squashes the total into a probability between zero and one, as an illustrative formula.",
    board: {
      kind: 'formula',
      title: 'Logistic probability from features',
      latex: 'p = \\sigma(w^\\top x + b)',
      terms: [
        { latex: 'w^\\top x', label: 'weighted sum of the features' },
        { latex: 'b', label: 'shifts the decision point' },
        { latex: '\\sigma', label: 'squashes into probability' },
      ],
    },
  },
  {
    name: 'scatter: two classifiers on accuracy and sensitivity',
    say: 'These slides compare the two Titanic classifiers and inspect what the logistic model learned, building on slide 20 where KNN set the baseline. Logistic regression comes out slightly ahead on this data, which matters because it also explains itself. The large positive and negative weights point to first class and female gender favoring survival, while the small age weight suggests little effect per year, with the lecture warning that correlated features limit strong reading.',
    board: {
      kind: 'scatter',
      title: 'Accuracy against sensitivity',
      x_label: 'accuracy (fraction)',
      y_label: 'sensitivity (fraction)',
      better: 'up-right',
      points: [
        { label: 'KNN split', x: 0.766, y: 0.67 },
        { label: 'KNN LOO', x: 0.769, y: 0.663 },
        { label: 'LR split', x: 0.804, y: 0.719 },
        { label: 'LR LOO', x: 0.786, y: 0.705 },
      ],
      source: 'document',
    },
  },
  {
    name: 'heatmap: animals named by their class',
    say: 'These slides extend the single-neighbor idea into a majority vote. After slide 6 showed copying the closest training label, the lecture shows why one neighbor can mislead when data overlap or labels are noisy. The distance table lets the learner find the k smallest distances to the query, the handwritten-digit and dot plots show the query sitting among mixed neighbors, and the vote smooths the decision. As illustrative, three neighbors with two reptile votes would label the query reptile, even if its single nearest neighbor differed.',
    board: {
      kind: 'heatmap',
      title: 'Illustrative animal distances',
      rows: ['Cobra', 'Rattlesnake', 'Boa', 'Chicken'],
      cols: ['Cobra', 'Rattlesnake', 'Boa', 'Chicken'],
      values: [
        [0, 0, 1.414, 2.236],
        [0, 0, 1.414, 2.236],
        [1.414, 1.414, 0, 2.236],
        [2.236, 2.236, 2.236, 0],
      ],
      source: 'illustrative',
      unit: 'distance',
    },
  },
  {
    name: 'formula: spoken variables and Greek letters',
    say: 'This frequency shows why discrete levels appear. Omega is the mode frequency. Kay squared gives motion along the plates and em squared gives the field mass. The last factor gives evenly spaced transverse levels set by the coupling, like magnetic Landau spacing, with the angular number leaving the extra shift beyond the main ladder.',
    board: {
      kind: 'formula',
      title: 'Transverse-quantized mode frequency',
      latex: '\\omega = \\sqrt{k^2 + m^2 + \\alpha(2n + |l| + 1)}',
      terms: [
        { latex: '\\omega', label: 'mode frequency' },
        { latex: 'k^2', label: 'momentum along plates' },
        { latex: 'm^2', label: 'field mass' },
        { latex: '\\alpha(2n + |l| + 1)', label: 'Landau-like transverse levels' },
      ],
    },
  },
  {
    name: 'plot: liability ceiling',
    say: "Google's financial exposure under these terms has a fixed ceiling. That ceiling is the larger of the flat amount and a percentage of what was paid, so small payments keep the flat amount while larger payments push the percentage above it. Certain losses such as lost profits and indirect loss stay outside recovery. The flat line and sloping line with crossover are illustrative, not measured.",
    board: {
      curves: [
        { expression: '500+0*x', label: 'flat cap' },
        { expression: '1.25*x', label: '125% of fees' },
      ],
      kind: 'plot',
      marks: [{ curve: 1, label: 'crossover', other: 2, type: 'crossing' }],
      title: 'Illustrative liability ceiling',
      x: [0, 800],
      x_label: 'fees paid in prior 12 months',
      y: [0, 1000],
      y_label: 'liability ceiling',
    },
  },
  {
    name: 'timeline: three deadline windows',
    say: 'Three duties run on strict clocks that start at different moments. Missing the early tenant check means the record is treated as agreed, while the landlord protections turn on prompt action after receiving money and advance warning before a rent change. The shared bar view makes the lengths easy to compare, with the inventory period visibly shortest and the rent-notice window allowing the longest lead time.',
    board: {
      kind: 'timeline',
      title: 'Three key deadline windows',
      unit: 'day',
      source: 'document',
      anchor: { label: 'Tenancy start' },
      events: [
        { label: 'Inventory comments due', after: 'Tenancy start', offset: 14, deadline: true, position: 14 },
        { label: 'Deposit protection due', after: 'Tenancy start', offset: 30, deadline: true, position: 30 },
        { label: 'First review date', after: 'Tenancy start', offset: 1, offset_unit: 'year', position: 365.25 },
        { label: 'Earliest review notice', after: 'First review date', offset: -90, position: 275.25 },
        { label: 'Latest review notice', after: 'First review date', offset: -28, deadline: true, position: 337.25 },
      ],
      spans: [
        {
          label: 'Inventory window',
          from: 'Tenancy start',
          to: 'Inventory comments due',
          role: 'window',
          start: 0,
          end: 14,
        },
        {
          label: 'Deposit window',
          from: 'Tenancy start',
          to: 'Deposit protection due',
          role: 'window',
          start: 0,
          end: 30,
        },
        {
          label: 'Review notice window',
          from: 'Earliest review notice',
          to: 'Latest review notice',
          role: 'window',
          start: 275.25,
          end: 337.25,
        },
      ],
    },
  },
  {
    name: 'distribution: wide intervals',
    say: 'Precise synchrony cannot be claimed for every species, because uncertainty remains large. The authors note their model was built for hazard rates with typically five cohorts per species, so intervals span about half the scale. Treat the one-fifth average as assemblage evidence, not exact per-species values.',
    board: {
      kind: 'distribution',
      title: 'Wide intervals limit precision',
      x_label: 'ICC (shared variance proportion)',
      source: 'illustrative',
      dists: [{ family: 'normal', label: 'Typical species', mean: 0.21, sd: 0.13 }],
    },
  },
  {
    name: 'flow in German: identity check',
    say: 'Füllen Sie Adressat und Absender vollständig aus. Fügen Sie Kunden-, Rechnungsnummer oder Aktenzeichen zur eindeutigen Zuordnung hinzu. Der Verantwortliche darf nur bei sicherer Identifizierung antworten, sonst droht Versand an Unbefugte. Illustrativ gedacht bleibt eine unvollständige Anfrage zur Klärung liegen, eine vollständige führt direkt zur richtigen Akte und zur korrekten Auskunft.',
    board: {
      kind: 'flow',
      title: 'Identitätsprüfung verhindert Fehlversand',
      nodes: [
        { id: 'node-1', label: 'Angaben ergänzen' },
        { id: 'node-2', label: 'Identität prüfen' },
        { id: 'node-3', label: 'Auskunft korrekt' },
        { id: 'node-4', label: 'Angaben nachfordern' },
      ],
      edges: [
        ['node-1', 'node-2'],
        ['node-2', 'node-3'],
        ['node-2', 'node-4'],
        ['node-4', 'node-1'],
      ],
    },
  },
  {
    name: 'formula in German: elimination',
    say: 'Wir lösen das System durch Elimination weil sich dabei eine Unbekannte wegheben lässt und dann die andere direkt bestimmt werden kann. Wir nehmen das Fünffache der ersten Gleichung minus das Zweifache der zweiten Gleichung Dadurch fällt die erste Unbekannte weg und es bleibt sieben mal die zweite Unbekannte gleich neunundzwanzig übrig.',
    board: {
      kind: 'formula',
      title: 'Eliminiere x',
      latex: '2x+3y=7, 5x+4y=3 \\Rightarrow 7y=29',
      terms: [
        { latex: '7y=29', label: 'sieben mal zweite Unbekannte' },
        { latex: '2x+3y=7', label: 'erste Gleichung' },
      ],
    },
  },
  {
    name: 'formula in German: the value found is put in, its numbers spoken as fractions',
    say: 'Wir setzen das gefundene y in die erste Gleichung ein. Wir lösen nach x auf, dann ergibt x gleich minus neunzehn Siebtel. Also ist x minus neunzehn Siebtel und y neunundzwanzig Siebtel, die Probe in beiden Gleichungen stimmt.',
    board: {
      kind: 'formula',
      title: 'Berechne x',
      latex: '2x+3\\cdot\\frac{29}{7}=7 \\Rightarrow x=-\\frac{19}{7}',
      terms: [
        { latex: '3\\cdot\\frac{29}{7}', label: 'eingesetzter y Wert' },
        { latex: 'x=-\\frac{19}{7}', label: 'Wert für x' },
      ],
    },
  },
  {
    name: 'heatmap on an exercise sheet: reports by true colour',
    say: 'We will use Bayes rule to flip the witness accuracy into the chance the taxi was truly blue, because the rare base rate dominates the testimony. First we combine both ways the witness can say blue using total probability, so the rare blue base rate and common green errors both count.',
    board: {
      kind: 'heatmap',
      title: 'Illustrative reports by true color',
      rows: ['truly blue', 'truly green'],
      cols: ['reported blue', 'reported green'],
      values: [
        [99, 1],
        [2, 98],
      ],
      source: 'illustrative',
      unit: '%',
    },
  },
  {
    name: 'formula: the feed-forward network, its max said as a word',
    say: 'This formula computes the position wise transform applied after attention in every layer. The output F F N of x is the processed vector for one position. The middle rectified part max of zero and x W one plus b one expands to a larger inner size and keeps only positive values for nonlinearity. The final part W two plus b two projects back to model size for the next sublayer.',
    board: {
      kind: 'formula',
      title: 'Position-wise Feed-Forward Network',
      latex: 'FFN(x) = \\max(0, xW_1 + b_1)W_2 + b_2',
      terms: [
        { latex: 'FFN(x)', label: 'output at one position' },
        { latex: '\\max(0, xW_1 + b_1)', label: 'expanded rectified hidden layer' },
        { latex: 'W_2 + b_2', label: 'projects back to model' },
      ],
    },
  },
  {
    name: 'formula: a radial mode shape',
    say: 'The transverse motion is quantized by the radial shape, not by the plates. The power rho to |l| keeps the mode regular at the origin, the exponential e minus s damps it at large radius because the quadratic mass grows outward, and F of s only stays normalizable for integer n, which turns alpha into discrete Landau-like spacing with leftover l dependence.',
    board: {
      kind: 'formula',
      title: 'Radial mode shape',
      latex: 'R(\\rho) = \\rho^{|l|} e^{-s} F(s), \\quad s=\\frac{\\alpha \\rho^2}{2}',
      terms: [
        { latex: '\\rho^{|l|}', label: 'enforces regularity at origin' },
        { latex: 'e^{-s}', label: 'provides transverse confinement' },
        { latex: 'F(s)', label: 'selects discrete levels' },
      ],
    },
  },
  {
    name: 'formula: thrust from tail speed',
    say: 'Thrust prediction needs only speed, which creates the loophole. Tail speed is amplitude times frequency, and thrust grows with speed squared. A large slow stroke and a small fast flutter therefore yield the same speed and the same thrust in the model. Learning then prefers the flutter, outside the measured regime.',
    board: {
      kind: 'formula',
      title: 'Thrust from tail speed',
      latex: 'v = A \\cdot 2\\pi f, \\quad F_{thrust} \\propto v^2',
      terms: [
        { latex: 'v', label: 'tail speed' },
        { latex: 'A \\cdot 2\\pi f', label: 'amplitude times frequency' },
        { latex: 'F_{thrust} \\propto v^2', label: 'thrust from speed squared' },
      ],
    },
  },
  {
    name: 'scene: a cheap simulator, drawn as detailed fish against simple physics',
    say: 'An intentionally low-fidelity stateless simulator suffices for general closed-loop fish control that transfers zero-shot. Because training happens entirely offline in that cheap simulator instead of resolving flow with costly CFD or relying on hand-tuned gaits.',
    board: {
      kind: 'scene',
      title: 'Detailed fish, simple physics',
      objects: [
        {
          id: 'DetailTop',
          type: 'text',
          text: 'detailed fish: rigid head, five-hinge tail chain',
          x: 0.05,
          y: 0.78,
          w: 0.9,
          h: 0.16,
        },
        { id: 'HeadHigh', type: 'rect', x: 0.05, y: 0.58, w: 0.2, h: 0.12 },
        { id: 'TailHigh', type: 'rect', x: 0.28, y: 0.58, w: 0.67, h: 0.12 },
        { id: 'DownArrow', type: 'arrow', x: 0.5, y: 0.53, w: 0, h: -0.08 },
        { id: 'HeadSimple', type: 'circle', text: 'head ellipsoid', color: 'blue', x: 0.05, y: 0.24, w: 0.2, h: 0.18 },
        {
          id: 'TailSimple',
          type: 'circle',
          text: 'tail ellipsoids',
          color: 'green',
          x: 0.28,
          y: 0.24,
          w: 0.67,
          h: 0.18,
        },
        {
          id: 'PhysicsNote',
          type: 'text',
          text: 'hydrodynamics act only on approximations, CAD meshes only appearance',
          x: 0.05,
          y: 0.02,
          w: 0.9,
          h: 0.16,
        },
      ],
    },
  },
  {
    name: 'flow: causes of a tail shape, narrated as what blocks learning',
    say: 'Zero-shot learned control for a soft robotic fish is demonstrated while asking why generality stayed out of reach because compliance and costly fluids block learning. Its claims are constrained action to identified band, cheap stateless simulation suffices, one policy reaches rejects and tracks.',
    board: {
      kind: 'flow',
      title: 'Tail shape emerges from coupling',
      nodes: [
        { id: 'node-1', label: 'motor' },
        { id: 'node-2', label: 'elastic body' },
        { id: 'node-3', label: 'tendon routing' },
        { id: 'node-4', label: 'nonlinear fluid' },
        { id: 'node-5', label: 'tail shape' },
      ],
      edges: [
        ['node-1', 'node-5'],
        ['node-2', 'node-5'],
        ['node-3', 'node-5'],
        ['node-4', 'node-5'],
      ],
    },
  },
  {
    name: 'plot: a peak against a mean, narrated as the strongest delay and the average',
    source:
      'Finally, because the assemblage-level temperature test selects the peak correlation within a seven-lag window, it is upwardly biased under the null; the sensitivity analysis using the window-averaged correlation (Table S2) confirms that the positive signal is specific to each species’ best lag and does not hold as a broad, window-wide association.',
    say: 'A broad heat effect is not established here. Because the test keeps only each species strongest delay, chance highs are retained and lower values are discarded, so the average looks positive even when most delays show little signal. The authors therefore treat the pattern as provisional.',
    board: {
      kind: 'plot',
      title: 'Illustrative best-lag peak versus window mean',
      x_label: 'lag in days',
      y_label: 'correlation',
      x: [1, 7],
      y: [-0.1, 0.3],
      curves: [
        { expression: '0.16*exp(-(x-4)^2/3)', label: 'peak-picked' },
        { expression: '-0.03+0*x', label: 'window mean' },
      ],
    },
  },
] as Pair[];

export const UNRELATED: Pair[] = [
  {
    name: 'bars: synchrony of tiny and huge ants, while the narration explains a mechanism (borderline: it paraphrases the title)',
    source:
      'The decoupling is made vivid by the two highest-ICC species, which bracket almost the entire mass range: the small Chelaner cinctum (log10 mass = −0.745, ICC = 0.400) and the large Rhytidoponera metallica (log10 mass = +0.539, ICC = 0.371).',
    say: 'Larger size slows individual wear, not shared overwhelm. Because lower metabolic rate, greater reserves and antioxidant capacity lower the daily background risk for each worker, yet a heat pulse or pathogen wave hits all nestmates at once, raising deaths together regardless of that background. Illustrative intuition: thicker walls delay damp, but a flood fills small and large rooms alike.',
    board: {
      kind: 'bars',
      title: 'Synchrony in tiny versus huge',
      unit: 'ICC',
      higher_is_better: false,
      bars: [
        { label: 'Chelaner cinctum', value: 0.4 },
        { label: 'Rhytidoponera metallica', value: 0.371 },
      ],
    },
  },
  {
    name: 'bars: arrivals of a controller, while the narration explains why a cheap simulator suffices',
    source:
      'We show that an intentionally low-fidelity simulator is enough: a stateless, quasi-steady fluid model with no wake and no added-mass history suffices to learn a general, closed-loop controller that transfers to hardware without tuning. We show that this low-fidelity simulator is enough, provided the policy is held inside the regime its fluid coefficients were identified on (Figure 1).',
    say: 'Low-cost simulation can carry the whole learning load when the controller is kept inside validated motions. That matters because the expensive alternative resolves water flow in detail but cannot run the millions of steps training needs, so generality was previously out of reach.',
    board: {
      kind: 'bars',
      title: 'Arrivals within 5 cm',
      unit: 'count',
      higher_is_better: true,
      bars: [
        { label: 'static', value: 11 },
        { label: 'perturbed', value: 5 },
      ],
    },
  },
  {
    name: 'bars: arrivals again, in another round, while the narration explains one policy for many tasks',
    source:
      'Trained only on static targets, it followed a hand-moved one in both attempts, a proof of concept for driving it with an automated path The deployed policy was asked for several things it never saw in training, and did them. Its target distribution ended at ±120◦and 2.5 m, yet it reached targets at +158◦and −175◦, nearly directly behind, closing to 2.1 and 1.6 cm by a wide U-turn, and out to 2.8 m, closing to 2.3 cm.',
    say: 'One unchanged policy gives the soft fish general closed-loop control across reaching, disturbances, and tracking beyond training. Because earlier soft swimmers cruised straight or added steering to fixed gaits, while this learned policy governs the full gait for many tasks.',
    board: {
      kind: 'bars',
      title: '5-cm arrivals by condition',
      unit: 'arrivals',
      higher_is_better: true,
      bars: [
        { label: 'Static', value: 11 },
        { label: 'Perturbed', value: 5 },
      ],
    },
  },
] as Pair[];

/** A board with the narration of another step of the same tour: the same vocabulary, another point. */
export const SWAPPED: Pair[] = [
  {
    name: 'formula board of attention, narration on adding order',
    say: 'Because the Transformer has no recurrence, order must be added back in. The authors add sine and cosine positional encodings to embeddings, then process each position with the same feed forward network.',
    board: {
      kind: 'formula',
      title: 'Scaled dot product attention',
      latex: '\\text{Attention}(Q, K, V) = \\text{softmax}(\\frac{QK^T}{\\sqrt{d_k}})V',
      terms: [
        { latex: 'QK^T', label: 'query key similarity scores' },
        { latex: '\\sqrt{d_k}', label: 'scaling factor for stability' },
        { latex: 'V', label: 'values to blend' },
      ],
    },
  },
  {
    name: 'flow board of the encoder and decoder stacks, narration on the formula',
    say: 'This formula computes scaled dot product attention, the core weighting operation. First Q times K transposed measures query key similarity. Dividing by the square root of d k keeps scores stable. Finally softmax applied to V blends values by those weights.',
    board: {
      kind: 'flow',
      title: 'Transformer encoder decoder stacks',
      nodes: [
        { id: 'node-1', label: 'Input' },
        { id: 'node-2', label: 'Encoder x6' },
        { id: 'node-3', label: 'Decoder x6' },
        { id: 'node-4', label: 'Output' },
      ],
      edges: [
        ['node-1', 'node-2'],
        ['node-2', 'node-3'],
        ['node-3', 'node-4'],
      ],
    },
  },
  {
    name: 'flow board of adding order, narration on results',
    say: 'The big Transformer reaches twenty eight point four BLEU on English to German translation. That beats the best previous ensembles by more than two BLEU points and sets a new state of the art.',
    board: {
      kind: 'flow',
      title: 'Adding order then processing',
      nodes: [
        { id: 'node-1', label: 'Input embeddings' },
        { id: 'node-2', label: 'Add position codes' },
        { id: 'node-3', label: 'Apply feed forward' },
      ],
      edges: [
        ['node-1', 'node-2'],
        ['node-2', 'node-3'],
      ],
    },
  },
] as Pair[];
