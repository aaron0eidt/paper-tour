"""Builder for demo/attention/tour.json: edit the tour here, then run this file.

The narration and actions are hand-written below. The builder only turns anchor words into
at_word indexes (so edits to the narration cannot silently shift timings) and writes the JSON
in a readable layout. Needs doc.json next to it (run the README quick start first).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
doc = json.load(open(f'{ROOT}/doc.json'))
BBOX = {f['id']: f['bbox'] for f in doc['figures']}
for f in doc['figures']:
    for p in f['panels']:
        BBOX[p['id']] = p['bbox']


def rebase(src, region, dst):
    """Region measured relative to `src` bbox, re-expressed relative to `dst` bbox."""
    sx0, sy0, sx1, sy1 = BBOX[src]
    dx0, dy0, dx1, dy1 = BBOX[dst]
    x0 = sx0 + region[0] * (sx1 - sx0)
    y0 = sy0 + region[1] * (sy1 - sy0)
    x1 = sx0 + region[2] * (sx1 - sx0)
    y1 = sy0 + region[3] * (sy1 - sy0)
    r = [(x0 - dx0) / (dx1 - dx0), (y0 - dy0) / (dy1 - dy0), (x1 - dx0) / (dx1 - dx0), (y1 - dy0) / (dy1 - dy0)]
    return [round(min(1, max(0, v)), 3) for v in r]


# Regions, normalized to the bbox of the element they are used with (measured on grid renders).
FIG1 = {
    'encoder': [0.11, 0.368, 0.475, 0.728],
    # The right half reaches up to the output head, so the box label sits above the figure
    # instead of on top of the Linear box.
    'decoder': [0.525, 0.0, 0.882, 0.728],
    'nx_left': [0.02, 0.54, 0.095, 0.59],
    'enc_unit_mha': [0.125, 0.553, 0.455, 0.695],
    'enc_unit_ffn': [0.125, 0.388, 0.455, 0.52],
    # Row of the encoder's upper Add & Norm, from the figure's left edge, so a left-side note
    # lands in the white margin instead of on the encoder.
    'enc_an_row': [0.0, 0.394, 0.437, 0.42],
    'dec_cross': [0.562, 0.41, 0.792, 0.469],
    'dec_masked': [0.562, 0.576, 0.792, 0.659],
    'outputs_shifted': [0.555, 0.932, 0.8, 1.0],
    'linear_softmax': [0.562, 0.095, 0.792, 0.183],
    'bottom': [0.0, 0.7, 1.0, 0.9],
    # Label, sine and plus sign; the bottom stays clear of the embedding boxes.
    'pe_left': [0.0, 0.742, 0.36, 0.797],
    'pe_right': [0.645, 0.745, 1.0, 0.797],
}
FIG2A = {
    'matmul_qk': [0.257, 0.786, 0.598, 0.86],
    'scale': [0.308, 0.643, 0.548, 0.717],
    'mask': [0.238, 0.505, 0.615, 0.577],
    'softmax': [0.257, 0.367, 0.596, 0.439],
    'matmul_v': [0.391, 0.226, 0.757, 0.298],
    'mask_softmax': [0.238, 0.367, 0.615, 0.577],
}
FIG2B = {
    'linears': [0.014, 0.645, 0.896, 0.776],
    'sdpa': [0.019, 0.43, 0.87, 0.585],
    'concat': [0.287, 0.278, 0.558, 0.35],
    'top_linear': [0.31, 0.12, 0.545, 0.2],
    'h': [0.83, 0.46, 1.0, 0.58],
    'sdpa_h': [0.0, 0.42, 1.0, 0.6],
}
TAB1 = {
    # Columns, measured from word positions; ~2pt gaps between neighbouring boxes after padding.
    'complexity': [0.318, 0.0, 0.562, 1.0],
    'sequential': [0.584, 0.0, 0.71, 1.0],
    'path': [0.732, 0.0, 0.99, 1.0],
    # Self-attention and recurrent rows: labels through complexity cells, and the cells alone.
    'sa_rec_rows': [0.0, 0.36, 0.52, 0.66],
    'sa_rec_complexity': [0.38, 0.36, 0.5, 0.66],
}
TAB2 = {
    # Digit extents from word positions, shrunk so the 3pt box padding stays clear of the
    # neighbouring rows and rules (rows are only ~11pt apart).
    'big_ende': [0.469, 0.925, 0.518, 0.949],
    'big_enfr': [0.586, 0.925, 0.635, 0.949],
    'prev_best_ende': [0.461, 0.763, 0.525, 0.783],
    'ensembles_enfr': [0.579, 0.613, 0.642, 0.786],
    'base_cost': [0.788, 0.841, 0.911, 0.871],
}
TAB3_TOP = [0.0, 0.0, 1.0, 0.335]
FIG3 = {
    'making': [0.518, 0.0, 0.545, 0.31],
    'more_difficult': [0.706, 0.695, 0.757, 1.0],
}
# Word columns in Figure 4 are contiguous (14.1pt pitch), so these regions are the column bounds
# shrunk by the 3pt box padding: the drawn box then sits exactly on the column edges.
FIG4B = {
    'its': [0.3003, 0.0122, 0.3219, 0.2878],
    'law': [0.0381, 0.6918, 0.0597, 0.9878],
    'application': [0.3377, 0.6918, 0.3592, 0.9878],
}


# ----------------------------------------------------------------------------- tour content
# Each action may carry `at` = anchor word (or (word, n) for the n-th occurrence, 1-based);
# it becomes at_word. Matching ignores case and surrounding punctuation.

def focus(t, at=None): return {'type': 'focus', 'target': t, 'at': at}
def zoom(t, region=None, at=None, padding=None): return {'type': 'zoom', 'target': t, 'region': region, 'padding': padding, 'at': at}
def hl(targets, at=None, color=None, style=None, persist=None):
    return {'type': 'highlight', 'targets': targets if isinstance(targets, list) else [targets], 'color': color, 'style': style, 'at': at, 'persist': persist}
def box(t, region=None, at=None, label=None, color=None, persist=None):
    return {'type': 'box', 'target': t, 'region': region, 'label': label, 'color': color, 'at': at, 'persist': persist}
def spot(t, region=None, at=None): return {'type': 'spotlight', 'target': t, 'region': region, 'at': at}
def note(anchor, text, region=None, at=None, side=None, persist=None):
    return {'type': 'note', 'anchor': anchor, 'region': region, 'text': text, 'side': side, 'at': at, 'persist': persist}
def clear(at=None): return {'type': 'clear', 'at': at}


CHAPTERS = [
    ('recurrence', 'The trouble with recurrence', [
        ('welcome', 'host',
         "Welcome to a guided tour of Attention Is All You Need, the twenty seventeen paper that introduced the Transformer.",
         [focus('p1.b2'), hl('p1.s1', at='Attention')]),
        ('abstract', 'host',
         "The starting point: the dominant sequence models were recurrent or convolutional encoder-decoder networks, "
         "the best of them connected through attention. The proposal is the Transformer, based solely on attention, "
         "dispensing with recurrence and convolutions entirely.",
         [focus('p1.b12'), hl('p1.s11', at='dominant'), hl('p1.s12', at='best'), hl('p1.s13', at='proposal', color='green')]),
        ('sequential', 'host',
         "Why drop recurrence? A recurrent network computes each hidden state from the previous one, "
         "which rules out parallelizing within a training example. Later efficiency tricks helped, "
         "but that sequential constraint remained.",
         [focus('p2.b3'), hl('p2.s5', at='computes'), hl('p2.s6', at='rules', color='orange'),
          hl('p2.s7', at='Later', style='underline'), hl('p2.s8', at='but', color='pink')]),
        ('attention-only', 'host',
         "Attention already modeled dependencies regardless of distance, but almost always alongside a recurrent network. "
         "The Transformer keeps only the attention, and reaches a new state of the art in translation "
         "after just twelve hours on eight P100 GPUs.",
         [hl('p2.s9', at='Attention'), hl('p2.s10', at='almost'), hl('p2.s11', at='keeps', color='green'),
          hl('p2.s12', at='reaches', color='green')]),
        ('distance', 'expert',
         "It's also about distance. In convolutional models like ByteNet and ConvS2S, relating two positions takes more operations "
         "the farther apart they are. In the Transformer it's constant, at the cost of some averaging that multi-head attention counteracts.",
         [focus('p2.b7'), hl('p2.s14', at='convolutional', style='underline'), hl('p2.s15', at='relating', color='orange'),
          hl('p2.s17', at='constant,', color='green')]),
    ]),
    ('architecture', 'The architecture in one picture', [
        ('fig1-overview', 'host',
         "Here is the whole model, Figure 1: the encoder on the left, the decoder on the right. "
         "Each is a stack of N identical layers, with N equals six.",
         [zoom('fig1'),
          box('fig1', FIG1['encoder'], at='encoder', label='Encoder', color='blue', persist=True),
          box('fig1', FIG1['decoder'], at='decoder', label='Decoder', color='orange', persist=True),
          note('fig1', '**N = 6** identical layers in each stack', region=FIG1['nx_left'], at='stack', side='left')]),
        ('encoder-layer', 'host',
         "Each encoder layer has two sub-layers: multi-head self-attention, then a position-wise feed-forward network. "
         "Each one is wrapped in a residual connection followed by layer normalization; those are the Add and Norm boxes.",
         [box('fig1', FIG1['enc_unit_mha'], at='multi-head', color='green'),
          box('fig1', FIG1['enc_unit_ffn'], at='feed-forward', color='green'),
          note('fig1', 'Each sub-layer outputs `LayerNorm(x + Sublayer(x))`, always of width **d_model = 512**',
               region=FIG1['enc_an_row'], at='wrapped', side='left')]),
        ('decoder-cross', 'host',
         "The decoder layer adds a third sub-layer in the middle, which performs multi-head attention over the output "
         "of the encoder stack. That lets every decoder position attend over all input positions.",
         [box('fig1', FIG1['dec_cross'], at='third', color='green')]),
        ('decoder-mask', 'host',
         "Its first sub-layer is masked, so a position cannot attend to later positions. "
         "With the outputs also shifted right by one, each prediction depends only on earlier outputs.",
         [box('fig1', FIG1['dec_masked'], at='masked,', color='pink'),
          box('fig1', FIG1['outputs_shifted'], at='shifted', color='pink')]),
        ('output-head', 'host',
         "At the top, a linear layer and a softmax turn the decoder stack's output into next-token probabilities.",
         [box('fig1', FIG1['linear_softmax'], at='linear', color='green')]),
    ]),
    ('scaled-attention', 'Scaled dot-product attention', [
        ('attention-def', 'host',
         "So what does attention compute? It maps a query and a set of key-value pairs to an output: a weighted sum of the values, "
         "where each weight comes from how well the query fits the corresponding key.",
         [clear(), focus('p3.b7'), hl('p3.s16', at='maps'), hl('p3.s17', at='weighted')]),
        ('sdpa-figure', 'host',
         "The paper's version is the left half of Figure 2. Multiply the queries with the keys, scale, optionally mask, "
         "apply a softmax, and multiply the resulting weights with the values.",
         [zoom('fig2.a'),
          box('fig2.a', FIG2A['matmul_qk'], at='Multiply', color='blue', persist=True),
          box('fig2.a', FIG2A['scale'], at='scale,', color='blue', persist=True),
          box('fig2.a', FIG2A['mask'], at='mask,', color='blue', persist=True),
          box('fig2.a', FIG2A['softmax'], at='softmax,', color='blue', persist=True),
          box('fig2.a', FIG2A['matmul_v'], at=('multiply', 2), color='blue', persist=True)]),
        ('mask', 'host',
         "The mask is how the decoder hides the future. Inside this same attention, every connection to a later position "
         "is set to minus infinity before the softmax, so it gets zero weight.",
         [spot('fig2.a', FIG2A['mask_softmax'], at='mask'),
          note('fig2.a', 'Illegal connections are set to `−∞` before the softmax, so their weight is **0**',
               region=FIG2A['mask'], at='minus', side='left')]),
        ('equation-1', 'host',
         "Packing the queries, keys and values into matrices Q, K and V gives equation one: the softmax of Q times K transpose, "
         "divided by the square root of d k, multiplied by V.",
         [clear(), focus('eq1'), hl(['p4.s7', 'p4.s8'], at='Packing'), box('eq1', at='equation', label='Equation 1', color='blue')]),
        ('why-scale', 'host',
         "Why scale? For large d k, unscaled dot products lose to additive attention, and the authors suspect why: "
         "they grow large, pushing the softmax into regions with extremely small gradients. "
         "Scaling by one over root d k counteracts this.",
         [focus('p4.b10'), hl('p4.s14', at='unscaled', color='orange'), hl('p4.s15', at='suspect'),
          hl('p4.s16', at='Scaling', color='green')]),
        ('variance', 'expert',
         "The footnote makes it concrete: if the components of q and k are independent with mean zero and variance one, "
         "their dot product has variance d k. Dividing by root d k restores variance one.",
         [focus('p4.b13'), hl('p4.s21', at='independent'), hl('p4.s22', at=('variance', 2)),
          note('p4.b13', '`Var(q · k) = d_k`, so `Var(q · k / √d_k) = 1`', at=('variance', 2), side='bottom')]),
    ]),
    ('multi-head', 'Multi-head attention', [
        ('mh-figure', 'host',
         "The right half of Figure 2 is multi-head attention. Queries, keys and values are projected h times with different "
         "learned projections, attention runs on each in parallel, and the outputs are concatenated and projected once more.",
         [zoom('fig2.b'),
          box('fig2.b', FIG2B['linears'], at='projected', color='blue', persist=True),
          box('fig2.b', FIG2B['sdpa'], at=('attention', 2), color='blue', persist=True),
          box('fig2.b', FIG2B['concat'], at='concatenated', color='blue', persist=True),
          box('fig2.b', FIG2B['top_linear'], at=('projected', 2), color='blue', persist=True)]),
        ('mh-numbers', 'host',
         "The paper uses h equals eight heads, each working in sixty-four dimensions: the model width of five hundred twelve, "
         "divided by eight. So the total cost is similar to one head with full dimensionality.",
         [spot('fig2.b', FIG2B['sdpa_h'], at='eight'),
          note('fig2.b', '**h = 8** heads, each with `d_k = d_v = 512 / 8 = 64`', region=FIG2B['h'], at='sixty-four', side='right')]),
        ('mh-why', 'host',
         "Why several heads? They let the model jointly attend to information from different representation subspaces "
         "at different positions. With a single head, averaging inhibits this.",
         [clear(), focus('p5.b2'), hl('p5.s3', at='jointly'), hl('p5.s4', at='single', color='orange')]),
        ('mh-ablation', 'expert',
         "The ablations agree. In Table 3, a single head is zero point nine BLEU worse than the best setting, "
         "but quality also drops off with too many heads.",
         [zoom('tab3', TAB3_TOP), hl('p9.b6', at='single', color='pink'), hl(['p9.b5', 'p9.b9'], at='best', color='green'),
          hl('p9.b10', at='quality', color='orange')]),
        ('three-uses', 'host',
         "In the full model, multi-head attention appears in three ways: encoder-decoder attention, with queries from the decoder "
         "and keys and values from the encoder; self-attention in the encoder; and masked self-attention in the decoder.",
         [focus('p5.b9'), hl('p5.s11', at='encoder-decoder', color='blue'), hl('p5.s14', at='self-attention', color='green'),
          hl(['p5.s17', 'p5.s18'], at='masked', color='pink')]),
    ]),
    ('positions', 'Word order, and why self-attention', [
        ('positional', 'host',
         "With no recurrence and no convolution, the model has no built-in notion of word order. "
         "So positional encodings are added to the input embeddings at the bottom of both stacks.",
         [zoom('fig1', FIG1['bottom']), box('fig1', FIG1['pe_left'], at='positional', color='pink'),
          box('fig1', FIG1['pe_right'], at='added', color='pink')]),
        ('sinusoids', 'host',
         "They are sines and cosines of different frequencies. The authors hypothesized this lets the model attend by relative "
         "position easily. Learned embeddings worked about as well, but sinusoids may extrapolate to longer sequences.",
         [focus('p6.b11'), hl('p6.s8', at='sines'), box('p6.b11', at='frequencies.', color='blue'),
          hl('p6.s12', at='relative'), hl('p6.s13', at='Learned', color='blue'), hl('p6.s14', at='sinusoids', color='green')]),
        ('table-1', 'host',
         "Section four makes the case with Table 1, comparing layer types on complexity per layer, minimum sequential operations, "
         "and maximum path length between positions.",
         [zoom('tab1'),
          box('tab1', TAB1['complexity'], at='complexity', color='blue', persist=True),
          box('tab1', TAB1['sequential'], at='sequential', color='orange', persist=True),
          box('tab1', TAB1['path'], at='path', color='green', persist=True)]),
        ('table-1-rows', 'host',
         "A recurrent layer needs order n sequential operations, and its path length is order n. Self-attention connects "
         "all positions with a constant number of operations, so both are order one.",
         [hl('p6.b5', at='recurrent', color='pink'), hl('p6.b4', at='Self-attention', color='green')]),
        ('table-1-cost', 'host',
         "The price is order n squared times d per layer, versus n times d squared for recurrence. That's faster whenever the "
         "sequence length n is smaller than the representation size d, which is the usual case for sentences in translation.",
         [spot('tab1', TAB1['sa_rec_rows'], at='price'),
          note('tab1', 'Self-attention is cheaper when **n < d**', region=TAB1['sa_rec_complexity'], at='faster', side='right')]),
    ]),
    ('results', 'Training and results', [
        ('training', 'host',
         "The models were trained on WMT twenty fourteen: four and a half million English-German sentence pairs, "
         "and thirty-six million English-French sentences. On eight P100 GPUs, the base model took twelve hours, "
         "the big one three and a half days.",
         [clear(), focus('p7.b7'), hl('p7.s16', at='four', color='blue'), hl('p7.s18', at='thirty-six', color='blue'),
          hl('p7.s22', at='eight', color='green'), hl('p7.s24', at='base', color='green'), hl('p7.s26', at='big', color='green')]),
        ('table-2-en-de', 'host',
         "Now Table 2. On English-to-German, the big Transformer reaches twenty-eight point four BLEU, "
         "more than two points above the best previous models, ensembles included.",
         [zoom('tab2'), hl('p8.b14', at='big', persist=True),
          box('tab2', TAB2['big_ende'], at='twenty-eight', color='green', persist=True),
          box('tab2', TAB2['prev_best_ende'], at='above', color='orange')]),
        ('table-2-en-fr', 'host',
         "On English-to-French it scores forty-one point eight, a new single-model state of the art, "
         "and higher than every ensemble in the table.",
         [box('tab2', TAB2['big_enfr'], at='forty-one', color='green', persist=True),
          box('tab2', TAB2['ensembles_enfr'], at='higher', color='orange')]),
        ('table-2-cost', 'host',
         "Then look at training cost. Even the base model beats every earlier model and ensemble on English-to-German, "
         "at a fraction of their estimated training cost.",
         [hl('p8.b13', at='base', color='blue'),
          box('tab2', TAB2['base_cost'], at='fraction', color='blue')]),
        ('bleu-discrepancy', 'expert',
         "A detail for careful readers: the text of section six point one gives forty-one point zero for English-to-French, "
         "while the abstract and Table 2 both report forty-one point eight.",
         [clear(), focus('p8.b20'), hl('p8.s13', at='forty-one', color='orange'),
          note('p8.s13', 'Section 6.1 says **41.0**; the abstract and Table 2 say **41.8**', at='while')]),
    ]),
    ('visualizations', 'What the heads learned', [
        ('figure-3', 'host',
         "The appendix looks inside the trained model. Figure 3 shows encoder self-attention in layer five of six, "
         "for the word making only, one color per head. Many heads reach the distant words more difficult.",
         [zoom('fig3'), box('fig3', FIG3['making'], at='making', color='blue'),
          box('fig3', FIG3['more_difficult'], at='distant', color='orange')]),
        ('figure-4-top', 'host',
         "Figure 4 shows two heads, also in layer five, apparently involved in anaphora resolution. "
         "The top panel is the full attention pattern of head five.",
         [zoom('fig4'), box('fig4.a', at='top', label='Head 5, all words', color='blue')]),
        ('figure-4-bottom', 'host',
         "The bottom panel isolates the word its, for heads five and six. The attention is very sharp: "
         "it lands on application, and on Law, the word its refers to.",
         [zoom('fig4.b'), box('fig4.b', FIG4B['its'], at='its', color='blue'),
          box('fig4.b', FIG4B['application'], at='application,', color='orange'), box('fig4.b', FIG4B['law'], at='Law,', color='orange')]),
        ('figure-5', 'host',
         "Figure 5 shows two more heads from the same layer. Their patterns seem related to the structure of the sentence, "
         "and they clearly learned to perform different tasks.",
         [zoom('fig5'), box('fig5.a', at='two', color='green'), box('fig5.b', at='Their', color='pink')]),
        ('caution', 'expert',
         "A word of caution: these are a few selected examples, and the captions hedge with words like apparently and seems. "
         "Suggestive pictures, not proof of what each head does.",
         [focus('p15.b5'), hl('p15.s2', at='examples,'), hl('p15.s1', at='seems.', color='orange')]),
    ]),
    ('wrap-up', 'Wrap-up', [
        ('conclusion', 'host',
         "To sum up: the Transformer replaces recurrent layers with multi-headed self-attention, trains significantly faster "
         "than recurrent or convolutional architectures, and set a new state of the art on both WMT twenty fourteen translation tasks.",
         [focus('p10.b20'), hl('p10.s7', at='replaces'), hl('p10.s8', at='trains', color='green'),
          hl('p10.s9', at='new', color='blue')]),
        ('outlook', 'host',
         "Beyond translation, a four-layer Transformer did surprisingly well on English constituency parsing, in Table 4. "
         "The authors planned to extend it to images, audio and video. Thanks for taking the tour.",
         [zoom('tab4'), hl(['p10.b7', 'p10.b12'], at='four-layer', color='green'),
          focus('p10.b21', at='authors'), hl('p10.s12', at='images,', color='blue')]),
    ]),
]


# ----------------------------------------------------------------------------- assembly

def norm(w):
    return re.sub(r"^[^\w]+|[^\w]+$", '', w.lower())


def word_index(say, at):
    if at is None:
        return None
    word, n = (at, 1) if isinstance(at, str) else at
    words = say.split()
    hits = [i for i, w in enumerate(words) if norm(w) == norm(word)]
    if len(hits) < n:
        sys.exit(f'anchor {at!r} not found in: {say}')
    return hits[n - 1]


KEY_ORDER = ['type', 'target', 'targets', 'anchor', 'region', 'padding', 'label', 'text', 'side', 'color', 'style', 'at_word', 'persist']


def finish_action(a, say):
    out = dict(a)
    idx = word_index(say, out.pop('at'))
    if idx:  # 0 is the default, leave it out
        out['at_word'] = idx
    out = {k: v for k, v in out.items() if v is not None}
    return {k: out[k] for k in KEY_ORDER if k in out}


def build():
    chapters = []
    for cid, title, steps in CHAPTERS:
        ch = {'id': cid, 'title': title, 'steps': []}
        for sid, speaker, say, actions in steps:
            step = {'id': sid}
            if speaker != 'host':
                step['speaker'] = speaker
            step['say'] = say
            step['actions'] = [finish_action(a, say) for a in actions]
            ch['steps'].append(step)
        chapters.append(ch)
    return {
        'schema': 'paper-tour/tour@0.1',
        'title': 'Attention Is All You Need: a guided tour',
        'paper': 'attention',
        'doc_sha256': doc['source']['sha256'],
        'level': 'grad',
        'voices': {
            'host': {'lang': 'en-US', 'name_hint': 'Samantha', 'rate': 1.0},
            'expert': {'lang': 'en-US', 'name_hint': 'Daniel', 'rate': 1.0},
        },
        'chapters': chapters,
    }


def dump(tour):
    """2-space JSON with one action per line."""
    def j(v):
        return json.dumps(v, ensure_ascii=False)
    lines = ['{']
    head = [k for k in tour if k != 'chapters']
    for k in head:
        if k == 'voices':
            lines.append('  "voices": {')
            vs = list(tour['voices'].items())
            for i, (name, v) in enumerate(vs):
                lines.append(f'    {j(name)}: {j(v)}' + (',' if i < len(vs) - 1 else ''))
            lines.append('  },')
        else:
            lines.append(f'  {j(k)}: {j(tour[k])},')
    lines.append('  "chapters": [')
    for ci, ch in enumerate(tour['chapters']):
        lines.append('    {')
        lines.append(f'      "id": {j(ch["id"])},')
        lines.append(f'      "title": {j(ch["title"])},')
        lines.append('      "steps": [')
        for si, st in enumerate(ch['steps']):
            lines.append('        {')
            for k in [k for k in st if k != 'actions']:
                lines.append(f'          {j(k)}: {j(st[k])},')
            lines.append('          "actions": [')
            for ai, a in enumerate(st['actions']):
                lines.append(f'            {j(a)}' + (',' if ai < len(st['actions']) - 1 else ''))
            lines.append('          ]')
            lines.append('        }' + (',' if si < len(ch['steps']) - 1 else ''))
        lines.append('      ]')
        lines.append('    }' + (',' if ci < len(tour['chapters']) - 1 else ''))
    lines.append('  ]')
    lines.append('}')
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    tour = build()
    text = dump(tour)
    assert json.loads(text) == tour
    out = sys.argv[1] if len(sys.argv) > 1 else f'{ROOT}/tour.json'
    open(out, 'w').write(text)
    words = sum(len(s['say'].split()) for c in tour['chapters'] for s in c['steps'])
    steps = sum(len(c['steps']) for c in tour['chapters'])
    print(f'wrote {out}: {len(tour["chapters"])} chapters, {steps} steps, {words} words, ~{words / 165:.1f} min')
