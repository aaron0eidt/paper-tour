"""Render every step of a tour the way the player would frame it, to check targets by eye.

Mirrors player/src/resolve.ts (ID -> rects, regions, block line merging), camera.ts (focus/zoom
framing, clamping) and engine.ts (persist/clear, at_word order). One image per camera segment of
a step: <out>/NN-<step>-<k>.png. Also prints the word at every timed action's at_word.

Usage: check_tour.py <paper-folder>/tour.json <out-dir>. doc.json and paper.pdf are read from the
tour's folder.
"""
import json
import os
import sys
import textwrap

import fitz

tour_path, out_dir = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.abspath(tour_path))
os.makedirs(out_dir, exist_ok=True)
VP_W, VP_H = 1152, 720          # assumed stage viewport in screen px (1440x900 window minus sidebar/controls)
DOC_MARGIN, PAGE_GAP = 32, 28
MAX_ZOOM, MIN_ZOOM = 4, 0.1

doc = json.load(open(f'{ROOT}/doc.json'))
tour = json.load(open(tour_path))
pdf = fitz.open(f'{ROOT}/paper.pdf')

blocks = {b['id']: b for b in doc['blocks']}
sents = {s['id']: s for s in doc['sentences']}
sections = {s['id']: s['block'] for s in doc['sections']}
figs = {}
for f in doc['figures']:
    figs[f['id']] = f
    for p in f['panels']:
        figs[p['id']] = dict(p, page=f['page'])
for e in doc['equations']:
    figs[e['id']] = e
pages = [(p['width'], p['height']) for p in doc['pages']]
page_y = []
y = DOC_MARGIN
for w, h in pages:
    page_y.append(y)
    y += h + PAGE_GAP
LAYOUT_W = max(w for w, _ in pages) + 2 * DOC_MARGIN
LAYOUT_H = y - PAGE_GAP + DOC_MARGIN


def union(rects):
    return [min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects)]


def merge_lines(rects):
    out = []
    for r in sorted(rects, key=lambda r: (r[1], r[0])):
        if out:
            p = out[-1]
            overlap = min(p[3], r[3]) - max(p[1], r[1])
            same = overlap > 0.5 * min(p[3] - p[1], r[3] - r[1])
            touch = r[0] <= p[2] + 8 and p[0] <= r[2] + 8
            if same and touch:
                out[-1] = union([p, r])
                continue
        out.append(list(r))
    return out


def resolve(tid, lines=False):
    """-> (page, rects) or None."""
    if tid in sents:
        return sents[tid]['page'], sents[tid]['rects']
    bid = tid if tid in blocks else sections.get(tid)
    if bid:
        b = blocks[bid]
        if lines:
            rs = [r for s in b['sentences'] for r in sents[s]['rects']]
            if rs:
                return b['page'], merge_lines(rs)
        return b['page'], [b['bbox']]
    if tid in figs:
        return figs[tid]['page'], [figs[tid]['bbox']]
    if tid.startswith('page') and tid[4:].isdigit():
        n = int(tid[4:])
        if 1 <= n <= len(pages):
            return n, [[0, 0, pages[n - 1][0], pages[n - 1][1]]]
    return None


def resolve_target(tid, region=None, lines=False):
    g = resolve(tid, False if region else lines)
    if not g or not region:
        return g
    page, rects = g
    x0, y0, x1, y1 = union(rects)
    w, h = x1 - x0, y1 - y0
    a, b, c, d = [min(1, max(0, v)) for v in region]
    return page, [[x0 + min(a, c) * w, y0 + min(b, d) * h, x0 + max(a, c) * w, y0 + max(b, d) * h]]


def to_stage(page, r):
    return [DOC_MARGIN + r[0], page_y[page - 1] + r[1], DOC_MARGIN + r[2], page_y[page - 1] + r[3]]


def clamp_axis(c, s, view, size):
    half = view / (2 * s)
    if 2 * half >= size:
        return size / 2
    return min(max(c, half), size - half)


def clamp_view(cx, cy, s):
    return clamp_axis(cx, s, VP_W, LAYOUT_W), clamp_axis(cy, s, VP_H, LAYOUT_H), s


def camera_view(a):
    if a['type'] == 'zoom':
        page, rects = resolve_target(a['target'], a.get('region'))
        r = to_stage(page, union(rects))
        pad = a.get('padding', 0.12)
        w, h = max(1, r[2] - r[0]), max(1, r[3] - r[1])
        s = min(VP_W / (w * (1 + 2 * pad)), VP_H / (h * (1 + 2 * pad)))
        return clamp_view((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, min(max(s, MIN_ZOOM), MAX_ZOOM))
    page, rects = resolve(a['target'])
    r = to_stage(page, union(rects))
    margin = min(max(VP_W * 0.04, 16), 56)
    s = min(max((VP_W - 2 * margin) / pages[page - 1][0], MIN_ZOOM), MAX_ZOOM)
    view_h = VP_H / s
    h = r[3] - r[1]
    cy = r[1] - view_h * 0.06 + view_h / 2 if h > view_h * 0.8 else (r[1] + r[3]) / 2
    return clamp_view(DOC_MARGIN + pages[page - 1][0] / 2, cy, s)


def initial_view():
    w, h = pages[0]
    return camera_view({'type': 'focus', 'target': 'page1'})


COLORS = {'yellow': (1, 0.8, 0), 'blue': (0.15, 0.45, 1), 'green': (0.1, 0.7, 0.25), 'pink': (1, 0.3, 0.65), 'orange': (1, 0.5, 0)}

OUT_W = 632
VIEW_W = 620
VIEW_H = VIEW_W * VP_H / VP_W
CAP_H = 120


def render(path, title, say_marked, view, overlays):
    cx, cy, s = view
    vw, vh = VP_W / s, VP_H / s
    vx0, vy0 = cx - vw / 2, cy - vh / 2
    k = VIEW_W / vw
    out = fitz.open()
    pg = out.new_page(width=OUT_W, height=VIEW_H + CAP_H)
    pg.draw_rect(fitz.Rect(0, 0, VIEW_W, VIEW_H), color=None, fill=(0.85, 0.85, 0.85))
    for n, (pw, ph) in enumerate(pages, start=1):
        sr = [DOC_MARGIN, page_y[n - 1], DOC_MARGIN + pw, page_y[n - 1] + ph]
        ix0, iy0, ix1, iy1 = max(sr[0], vx0), max(sr[1], vy0), min(sr[2], vx0 + vw), min(sr[3], vy0 + vh)
        if ix1 - ix0 < 1 or iy1 - iy0 < 1:
            continue
        clip = fitz.Rect(ix0 - sr[0], iy0 - sr[1], ix1 - sr[0], iy1 - sr[1])
        dst = fitz.Rect((ix0 - vx0) * k, (iy0 - vy0) * k, (ix1 - vx0) * k, (iy1 - vy0) * k)
        pg.draw_rect(dst, color=None, fill=(1, 1, 1))
        pg.show_pdf_page(dst, pdf, n - 1, clip=clip)

    def scr(page, r):
        st = to_stage(page, r)
        return fitz.Rect((st[0] - vx0) * k, (st[1] - vy0) * k, (st[2] - vx0) * k, (st[3] - vy0) * k)

    view_rect = fitz.Rect(0, 0, VIEW_W, VIEW_H)
    problems = []
    holes = []
    notes = []
    labels = []
    for a in overlays:
        t = a['type']
        if t == 'highlight':
            col = COLORS[a.get('color', 'yellow')]
            for tid in a['targets']:
                page, rects = resolve(tid, lines=True)
                for r in rects:
                    R = scr(page, r)
                    if not view_rect.contains(R):
                        problems.append(f'highlight {tid} off view')
                    if a.get('style') == 'underline':
                        pg.draw_line(R.bl, R.br, color=col, width=2)
                    else:
                        pg.draw_rect(R, color=None, fill=col, fill_opacity=0.35)
        elif t == 'box':
            page, rects = resolve_target(a['target'], a.get('region'))
            u = union(rects)
            R = scr(page, [u[0] - 3, u[1] - 3, u[2] + 3, u[3] + 3])
            col = COLORS[a.get('color', 'yellow')]
            if not view_rect.contains(R):
                problems.append(f'box {a["target"]} off view')
            pg.draw_rect(R, color=col, width=2)
            if a.get('label'):
                labels.append((R, a['label'], col))
        elif t == 'spotlight':
            page, rects = resolve_target(a['target'], a.get('region'))
            u = union(rects)
            holes.append(scr(page, [u[0] - 5, u[1] - 5, u[2] + 5, u[3] + 5]))
        elif t == 'note':
            page, rects = resolve_target(a['anchor'], a.get('region'))
            R = scr(page, union(rects))
            if not view_rect.intersects(R):
                problems.append(f'note anchor {a["anchor"]} off view')
            notes.append((R, a['text'], a.get('side', 'auto')))
    if holes:
        sh = pg.new_shape()
        sh.draw_rect(view_rect)
        for h in holes:
            sh.draw_rect(h)
        sh.finish(color=None, fill=(0, 0, 0), fill_opacity=0.5, even_odd=True)
        sh.commit()
    # Box labels as in ScreenLayer: 12px chip, 6px above the box (inside when the box is near the top).
    q = VIEW_W / VP_W                      # image units per viewport px
    for R, text, col in labels:
        w = (fitz.get_text_length(text, fontname='hebo', fontsize=12) + 16) * q
        h = 20 * q
        x = min(max(R.x0, 10 * q), VIEW_W - 120 * q)
        y1 = R.y0 - 6 * q if R.y0 > 34 * q else R.y0 + 6 * q + h
        tr = fitz.Rect(x, y1 - h, x + w, y1)
        pg.draw_rect(tr, color=None, fill=col)
        pg.insert_text((tr.x0 + 8 * q, tr.y1 - 5 * q), text, fontsize=12 * q, color=(1, 1, 1), fontname='hebo')
    # Note cards placed like NoteCard: chosen side, 14px gap, clamped 10px from the edges.
    for i, (R, text, side) in enumerate(notes, start=1):
        pg.draw_rect(R, color=(0.5, 0, 0.8), width=0.6, dashes='[2] 0')
        plain = text.replace('**', '').replace('`', '')
        tw = fitz.get_text_length(plain, fontname='helv', fontsize=13.5)
        cw = min(300, tw + 30)
        nlines = max(1, -(-int(tw) // 272)) if tw + 30 > 300 else 1
        cw, ch = cw * q, (nlines * 20.25 + 24) * q
        room = {'right': VIEW_W - R.x1, 'left': R.x0, 'top': R.y0, 'bottom': VIEW_H - R.y1}
        need = {'right': cw + 24 * q, 'left': cw + 24 * q, 'top': ch + 24 * q, 'bottom': ch + 24 * q}
        if side == 'auto':
            side = 'right'
            for s in ['left', 'bottom', 'top']:
                if room[s] / need[s] > room[side] / need[side]:
                    side = s
        cx, cy = (R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2
        x = R.x1 + 14 * q if side == 'right' else R.x0 - 14 * q - cw if side == 'left' else cx - cw / 2
        y = R.y1 + 14 * q if side == 'bottom' else R.y0 - 14 * q - ch if side == 'top' else cy - ch / 2
        x = min(max(x, 10 * q), VIEW_W - cw - 10 * q)
        y = min(max(y, 10 * q), VIEW_H - ch - 10 * q)
        card = fitz.Rect(x, y, x + cw, y + ch)
        pg.draw_rect(card, color=(0.3, 0.3, 0.4), fill=(0.08, 0.09, 0.13), fill_opacity=0.93, width=0.5)
        pg.insert_textbox(card + (14 * q, 9 * q, -10 * q, 0), plain, fontsize=11.5 * q, fontname='helv', color=(1, 1, 1))
        if card.intersects(R):
            problems.append(f'note {i} covers its anchor')
    pg.draw_rect(view_rect, color=(0, 0, 0), width=0.5)
    cap = '\n'.join(textwrap.wrap(say_marked, 128))
    probs = ('PROBLEMS: ' + '; '.join(problems)) if problems else ''
    pg.insert_textbox(fitz.Rect(6, VIEW_H + 4, OUT_W - 6, VIEW_H + CAP_H - 2), f'{title}\n{cap}\n{probs}', fontsize=8.5, fontname='helv')
    out[0].get_pixmap(dpi=110).save(path)
    return problems


def main():
    steps = [(ci, ch, st) for ci, ch in enumerate(tour['chapters']) for st in ch['steps']]
    persistent = []          # overlays carried across steps
    camera = None
    all_problems = []
    print('at_word check:')
    for n, (ci, ch, st) in enumerate(steps, start=1):
        words = st['say'].split()
        sched = sorted(enumerate(st['actions']), key=lambda ia: (ia[1].get('at_word', 0), ia[0]))
        for _, a in sched:
            if a.get('at_word'):
                tgt = a.get('target') or a.get('anchor') or ','.join(a.get('targets', []))
                print(f'  {st["id"]:<18} {a["type"]:<9} {tgt:<14} @{a["at_word"]:>2} -> {words[a["at_word"]]!r}')
        # Split into camera segments.
        segments = [[]]
        for _, a in sched:
            if a['type'] in ('focus', 'zoom') and any(x['type'] != 'clear' for x in segments[-1]):
                segments.append([])
            segments[-1].append(a)
        live = list(persistent)
        for k, seg in enumerate(segments, start=1):
            for a in seg:
                if a['type'] == 'clear':
                    live = [o for o in live if not o.get('_persist_from_step') and not o.get('persist')]
                elif a['type'] in ('focus', 'zoom'):
                    camera = a
                else:
                    live.append(a)
            view = camera_view(camera) if camera else initial_view()
            marked = []
            for i, w in enumerate(words):
                tags = [a['type'] + ':' + (a.get('target') or a.get('anchor') or '+'.join(a.get('targets', [])))
                        for a in st['actions'] if a.get('at_word', 0) == i]
                marked.append((f'[{" ".join(tags)}] ' if tags and i > 0 else '') + w)
            start_tags = [a['type'] + ':' + (a.get('target') or a.get('anchor') or '+'.join(a.get('targets', [])) or '')
                          for a in st['actions'] if a.get('at_word', 0) == 0]
            title = f'{n:02d} {ch["title"]} / {st["id"]} ({st.get("speaker", "host")}), segment {k}/{len(segments)}, ' \
                    f'camera {camera["type"]} {camera["target"]}{" region" if camera.get("region") else ""}; start: {" ".join(start_tags)}'
            probs = render(f'{out_dir}/{n:02d}-{st["id"]}-{k}.png', title, ' '.join(marked), view, live)
            all_problems += [f'{st["id"]}: {p}' for p in probs]
        # End of step: keep persistent overlays only (engine.advance).
        persistent = [o for o in live if o.get('persist')]
    print('problems:', all_problems or 'none')


main()
