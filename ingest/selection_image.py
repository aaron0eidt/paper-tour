#!/usr/bin/env python3
"""Render a page and normalized selection from its verified original PDF."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import pymupdf

try:
    import numpy as np
except ImportError:  # the crop is still rendered; the server then cannot weigh what a snapped outline covers
    np = None

# A pixel is ink when one of its colour channels differs from the crop's paper colour by more than this (of 255).
INK_DELTA = 32


def ink_map(pix):
    """Which pixels of a crop differ from its paper: 1 for ink, 0 for paper, height x width.

    The paper is the crop's most common colour (the low three bits dropped, so a noisy scan still has one), and a
    crop of nothing but paper has no ink at all. A figure's own background, such as a filled box, counts as ink.
    """
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    bins = (rgb >> 3).astype(np.int32)
    key = (bins[:, :, 0] << 10) | (bins[:, :, 1] << 5) | bins[:, :, 2]
    paper = rgb[key == np.bincount(key.ravel(), minlength=1 << 15).argmax()].mean(axis=0)
    return (np.abs(rgb.astype(np.int16) - paper).max(axis=2) > INK_DELTA).astype(np.uint8)


def render_selection(pdf_path, out_dir, page_number, rect, sha256, size):
    pdf_path, out_dir = Path(pdf_path), Path(out_dir)
    if hashlib.sha256(pdf_path.read_bytes()).hexdigest() != sha256:
        raise ValueError('The original PDF does not match the analysis.')
    if (not isinstance(rect, list) or len(rect) != 4
            or any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0 or n > 1 for n in rect)
            or rect[0] >= rect[2] or rect[1] >= rect[3]):
        raise ValueError('Selection must be a non-empty normalized rectangle.')
    with pymupdf.open(pdf_path) as pdf:
        if isinstance(page_number, bool) or not isinstance(page_number, int) or not 1 <= page_number <= len(pdf):
            raise ValueError('Selection page is outside the original PDF.')
        page = pdf[page_number - 1]
        bounds = page.rect
        if len(size) != 2 or any(not math.isfinite(n) or abs(n - actual) > 2 for n, actual in zip(size, [bounds.width, bounds.height])):
            raise ValueError('Analysis page dimensions do not match the original PDF.')
        clip = pymupdf.Rect(rect[0] * bounds.width, rect[1] * bounds.height,
                           rect[2] * bounds.width, rect[3] * bounds.height)
        out_dir.mkdir(parents=True, exist_ok=True)
        dimensions = []
        for name, area, edge in [('page.jpg', bounds, 1280), ('selection.jpg', clip, 1800)]:
            scale = min(8, edge / max(area.width, area.height))
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=area,
                                  colorspace=pymupdf.csRGB, alpha=False)
            pix.save(out_dir / name, jpg_quality=85)
            dimensions.append([pix.width, pix.height])
            if np is not None and name == 'selection.jpg':
                # The crop's ink, a bit a pixel row by row (high bit first), for the server to weigh a snapped outline.
                (out_dir / 'selection.ink').write_bytes(np.packbits(ink_map(pix)).tobytes())
        return {'page': page_number, 'rect': rect, 'dimensions': dimensions}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf')
    parser.add_argument('--out', required=True)
    parser.add_argument('--page', required=True, type=int)
    parser.add_argument('--rect', required=True, type=json.loads)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--size', required=True, type=json.loads)
    args = parser.parse_args()
    print(json.dumps(render_selection(args.pdf, args.out, args.page, args.rect, args.sha256, args.size)))
