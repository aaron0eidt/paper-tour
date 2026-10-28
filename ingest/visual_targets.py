#!/usr/bin/env python3
"""Measure diagram targets from source pixels; never invent semantic regions.

JSON stdin: {"image": "<base64 PNG/JPEG>"}
JSON stdout: {"targets": [{"kind", "label", "region": [x0,y0,x1,y1]}]}
All regions are relative to the complete supplied image, including its margins.
"""
import base64
import csv
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time

import cv2
import numpy as np

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_EDGE = 2200
OCR_SECONDS = 3
cv2.setNumThreads(1)


def area(r):
    return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def contains(outer, inner, tolerance=0):
    return all((inner[i] >= outer[i] - tolerance if i < 2 else inner[i] <= outer[i] + tolerance)
               for i in range(4))


def intersection(a, b):
    return area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def dedupe(rects):
    """Keep the outer ink edge of duplicate inside/outside contour pairs."""
    kept = []
    for rect in sorted(rects, key=area, reverse=True):
        if any(intersection(rect, other) / max(1, area(rect) + area(other) - intersection(rect, other)) > 0.82
               for other in kept):
            continue
        kept.append(rect)
    return kept


def contour_rects(mask, minimum, ratio=0.75, mode=cv2.RETR_TREE):
    contours, _ = cv2.findContours(mask, mode, cv2.CHAIN_APPROX_SIMPLE)
    found = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        touches = sum((x <= 1, y <= 1, x + w >= mask.shape[1] - 1, y + h >= mask.shape[0] - 1))
        if touches >= 2 and w * h >= mask.size * 0.92:
            continue  # image canvas/background, not a measured internal module
        if w * h < minimum or w < 10 or h < 8 or not 0.15 <= w / h <= 12:
            continue
        if cv2.contourArea(contour) / (w * h) < ratio:
            continue
        found.append((x, y, x + w, y + h))
    return dedupe(found)


def container_rects(image, components):
    """Locate real light fills, retaining only groups with several modules.

    Separate native color bins preserve nested containers of different shades.
    A light rectangle without measured child modules is not a panel target.
    """
    h, w = image.shape[:2]
    small = cv2.resize(image, (max(1, round(w * min(1, 512 / max(w, h)))),
                               max(1, round(h * min(1, 512 / max(w, h))))), interpolation=cv2.INTER_AREA)
    bins = small.astype(np.uint16) // 8
    packed = bins[:, :, 0] * 1024 + bins[:, :, 1] * 32 + bins[:, :, 2]
    counts = np.bincount(packed.ravel(), minlength=32768)
    colors = np.argsort(counts)[-16:][::-1]
    kernel_size = max(3, round(min(w, h) * 0.012) | 1)
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    rects = []
    # JPEG perturbs a flat gray fill across neighboring color bins. A tolerant
    # neutral-light mask reconnects that measured background, while per-color
    # masks below still distinguish nested containers of different shades.
    low, high = image.min(axis=2), image.max(axis=2)
    neutral = (((high.astype(np.int16) - low) < 8) & (low > 220) & (high < 252)).astype(np.uint8) * 255
    neutral = cv2.morphologyEx(neutral, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    neutral = cv2.morphologyEx(neutral, cv2.MORPH_CLOSE, kernel)
    masks = [neutral]
    for color in colors:
        if counts[color] < small.shape[0] * small.shape[1] * 0.008:
            continue
        lo = np.array([color // 1024, color // 32 % 32, color % 32], dtype=np.int32) * 8
        hi = np.minimum(255, lo + 7)
        if min(lo) >= 248 or float(np.mean(lo)) < 180:
            continue
        mask = cv2.inRange(image, lo.astype(np.uint8), hi.astype(np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        masks.append(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel))
    for mask in masks:
        for rect in contour_rects(mask, w * h * 0.01, 0.65, cv2.RETR_EXTERNAL):
            children = [part for part in components if contains(rect, part, 2) and area(part) < area(rect) * 0.6]
            if len(children) >= 2:
                rects.append(rect)
    return dedupe(rects)


def ocr_words(image, timeout=OCR_SECONDS, psm=11, confidence=80):
    executable = shutil.which('tesseract')
    if not executable:
        raise ValueError('tesseract is required for visual target OCR.')
    ok, png = cv2.imencode('.png', image)
    if not ok:
        raise ValueError('The OCR image could not be encoded.')
    try:
        result = subprocess.run([executable, 'stdin', 'stdout', '--psm', str(psm), 'tsv'], input=png.tobytes(),
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout,
                                check=True, env={**os.environ, 'OMP_THREAD_LIMIT': '1'})
    except subprocess.TimeoutExpired as error:
        raise TimeoutError('tesseract OCR exceeded its three-second budget.') from error
    except (subprocess.CalledProcessError, OSError) as error:
        raise ValueError('tesseract OCR failed to process the image.') from error
    words = []
    reader = csv.DictReader(io.StringIO(result.stdout.decode('utf-8', errors='replace')), delimiter='\t')
    if not {'text', 'conf', 'left', 'top', 'width', 'height'}.issubset(reader.fieldnames or []):
        raise ValueError('tesseract returned an invalid OCR result.')
    for row in reader:
        try:
            text = row['text'].strip()
            if float(row['conf']) < confidence or not text or not (any(char.isalnum() for char in text) or text == '&'):
                continue
            x, y, w, h = (int(row[key]) for key in ('left', 'top', 'width', 'height'))
            if w <= 0 or h <= 0:
                continue
            words.append({'text': text, 'rect': (x, y, x + w, y + h),
                          'line': tuple(row[key] for key in ('block_num', 'par_num', 'line_num'))})
        except (KeyError, TypeError, ValueError):
            continue
    return words


def measured_words(image, components):
    """OCR module interiors without borders, plus standalone source labels.

    One contact sheet gives closed modules a text-friendly OCR layout without
    changing their measured geometry. Both OCR passes share a three-second
    deadline; text boxes are mapped back into the original image frame.
    """
    deadline = time.monotonic() + OCR_SECONDS
    parts = []
    for rect in sorted(components, key=lambda r: (r[1], r[0])):
        x0, y0, x1, y1 = rect
        inset = min(3, max(1, (y1 - y0) // 8))
        crop = image[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
        if not crop.size:
            continue
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
        parts.append((rect, inset, binary))
    mapped = []
    recovered = []
    if parts:
        canvas = np.full((sum(part.shape[0] + 24 for _, _, part in parts), max(part.shape[1] for _, _, part in parts) + 32), 255, np.uint8)
        placements, y = [], 0
        for rect, inset, part in parts:
            h, w = part.shape
            canvas[y + 12:y + 12 + h, 16:16 + w] = part
            placements.append((rect, inset, (16, y + 12, 16 + w, y + 12 + h)))
            y += h + 24
        factor = min(3, 3200 / max(canvas.shape))
        canvas = cv2.resize(canvas, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        sheet_words = ocr_words(canvas, timeout=max(0.05, deadline - time.monotonic()), psm=6, confidence=70)
        for word in sheet_words:
            local = tuple(value / factor for value in word['rect'])
            for index, (source, inset, placed) in enumerate(placements):
                if contains(placed, local, 1):
                    x0, y0 = source[0] + inset - placed[0], source[1] + inset - placed[1]
                    mapped.append({**word, 'rect': (local[0] + x0, local[1] + y0, local[2] + x0, local[3] + y0),
                                   'line': ('component', index, word['line'])})
                    recovered.append(source)
                    break
    remaining = deadline - time.monotonic()
    if remaining <= 0.05:
        raise TimeoutError('tesseract OCR exceeded its three-second budget.')
    if remaining > 0.05:
        mapped.extend(word for word in ocr_words(image, timeout=remaining) if not any(
            rect[0] <= (word['rect'][0] + word['rect'][2]) / 2 <= rect[2] and
            rect[1] <= (word['rect'][1] + word['rect'][3]) / 2 <= rect[3] for rect in recovered))
    return mapped


def union(rects):
    return (min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects))


def text_groups(words):
    lines = {}
    for word in words:
        lines.setdefault(word['line'], []).append(word)
    groups = []
    for line in lines.values():
        line.sort(key=lambda item: item['rect'][0])
        groups.append({'rect': union([word['rect'] for word in line]), 'label': ' '.join(word['text'] for word in line)})
    groups.sort(key=lambda item: (item['rect'][1], item['rect'][0]))
    merged = []
    for group in groups:
        rect = group['rect']
        previous = next((item for item in reversed(merged) if
            0 <= rect[1] - item['rect'][3] <= max(rect[3] - rect[1], item['rect'][3] - item['rect'][1]) and
            min(rect[2], item['rect'][2]) - max(rect[0], item['rect'][0]) >= 0.5 * min(rect[2] - rect[0], item['rect'][2] - item['rect'][0])), None)
        if previous:
            previous['rect'] = union([previous['rect'], rect])
            previous['label'] += ' ' + group['label']
        else:
            merged.append(group)
    return merged


def detect_targets(image, words=None):
    """The input BGR array remains unchanged; coordinates use its original frame."""
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError('A valid RGB image is required.')
    h, w = image.shape[:2]
    if h * w > MAX_PIXELS or min(h, w) < 8:
        raise ValueError('Image dimensions are outside the supported range.')
    scale = min(1, MAX_EDGE / max(w, h))
    source = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else image
    h, w = source.shape[:2]
    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    _, ink = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
    closed = contour_rects(ink, w * h * 0.003)
    # Larger contour enclosures are panels, not duplicate component targets.
    panels = [rect for rect in closed if sum(contains(rect, child) and area(child) < area(rect) * 0.6 for child in closed) >= 2]
    components = [rect for rect in closed if rect not in panels]
    panels = container_rects(source, components)
    words = measured_words(source, components) if words is None else words
    assigned = set()
    targets = []
    for rect in sorted(components, key=area):
        inside = [(index, word) for index, word in enumerate(words) if index not in assigned and contains(rect, word['rect'], 2)]
        inside.sort(key=lambda item: (item[1]['rect'][1], item[1]['rect'][0]))
        assigned.update(index for index, _ in inside)
        targets.append({'kind': 'component', 'label': re.sub(r'(?<=\w)-\s+(?=\w)', '-', ' '.join(word['text'] for _, word in inside)), 'rect': rect})
    for rect in panels:
        labels = [target['label'] for target in sorted(targets, key=lambda item: (item['rect'][1], item['rect'][0]))
                  if target['kind'] == 'component' and target['label'] and contains(rect, target['rect'], 2)]
        targets.append({'kind': 'panel', 'label': ' / '.join(labels)[:400], 'rect': rect})
    targets.extend({'kind': 'text', **group} for group in text_groups([word for index, word in enumerate(words) if index not in assigned]))
    targets.sort(key=lambda target: (target['rect'][1], target['rect'][0], target['kind']))
    return {'targets': [{'kind': target['kind'], 'label': target['label'],
                         'region': [round(value / (w if i % 2 == 0 else h), 7) for i, value in enumerate(target['rect'])]}
                        for target in targets]}


def decode_image(encoded):
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 4 // 3 + 256:
        raise ValueError('Image payload is missing or too large.')
    if encoded.startswith('data:image/'):
        encoded = encoded.split(',', 1)[-1]
    data = base64.b64decode(encoded, validate=True)
    if len(data) > MAX_BYTES:
        raise ValueError('Image payload is too large.')
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Image could not be decoded.')
    return image


def main():
    def timeout(_signal, _frame):
        raise TimeoutError('Visual target detection exceeded its time budget.')
    signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, 7)
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES * 4 // 3 + 1024)
        payload = json.loads(raw)
        print(json.dumps(detect_targets(decode_image(payload.get('image'))), ensure_ascii=False))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, TypeError, AttributeError, TimeoutError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
