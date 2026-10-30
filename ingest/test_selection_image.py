import hashlib
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pymupdf
from selection_image import ink_map, render_selection


class SelectionImageTests(unittest.TestCase):
    def test_real_crop_and_rotated_page_coordinates(self):
        for rotation in [0, 90]:
            with self.subTest(rotation=rotation), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                with pymupdf.open() as pdf:
                    page = pdf.new_page(width=400, height=600)
                    page.draw_rect(pymupdf.Rect(200, 300, 400, 600), color=(1, 0, 0), fill=(1, 0, 0))
                    page.set_rotation(rotation)
                    pdf.save(root / 'source.pdf')
                sha = hashlib.sha256((root / 'source.pdf').read_bytes()).hexdigest()
                rect, size = ([0.5, 0.5, 1, 1], [400, 600]) if rotation == 0 else ([0, 0.5, 0.5, 1], [600, 400])
                result = render_selection(root / 'source.pdf', root, 1, rect, sha, size)
                self.assertLessEqual(max(result['dimensions'][0]), 1281)
                self.assertLessEqual(max(result['dimensions'][1]), 1801)
                crop = pymupdf.Pixmap(str(root / 'selection.jpg'))
                red, green, blue = crop.pixel(crop.width // 2, crop.height // 2)[:3]
                self.assertGreater(red, 230)
                self.assertLess(green, 25)
                self.assertLess(blue, 25)
                with self.assertRaises(ValueError):
                    render_selection(root / 'source.pdf', root, 2, rect, sha, size)
                with self.assertRaises(ValueError):
                    render_selection(root / 'source.pdf', root, 1, rect, '0' * 64, size)
                with self.assertRaises(ValueError):
                    render_selection(root / 'source.pdf', root, 1, rect, sha, [1, 1])

    def render_ink(self, draw, rect):
        """The crop's ink as height x width zeros and ones, for a 400 x 600 page that `draw` paints on."""
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with pymupdf.open() as pdf:
                draw(pdf.new_page(width=400, height=600))
                pdf.save(root / 'source.pdf')
            sha = hashlib.sha256((root / 'source.pdf').read_bytes()).hexdigest()
            result = render_selection(root / 'source.pdf', root, 1, rect, sha, [400, 600])
            width, height = result['dimensions'][1]
            bits = (root / 'selection.ink').read_bytes()
            self.assertEqual(len(bits), (width * height + 7) // 8, 'a bit a pixel, rows packed together')
            return np.unpackbits(np.frombuffer(bits, dtype=np.uint8))[:width * height].reshape(height, width)

    def test_ink_is_what_differs_from_the_paper(self):
        def object_on_paper(page):
            page.draw_rect(pymupdf.Rect(100, 100, 200, 150), color=(0, 0, 0), fill=(0, 0, 0))

        ink = self.render_ink(object_on_paper, [0.1, 0.1, 0.9, 0.4])
        height, width = ink.shape
        # The crop shows x 40 to 360 and y 60 to 240 of the page; the rectangle is 100 x 50 points of that.
        def at(x, y):
            return ink[int((y - 60) * height / 180), int((x - 40) * width / 320)]

        self.assertEqual(at(150, 125), 1, 'inside the object')
        self.assertEqual(at(300, 200), 0, 'the paper around it')
        self.assertEqual(at(98, 125), 0, 'just outside its edge')
        self.assertAlmostEqual(ink.mean(), 100 * 50 / (320 * 180), delta=0.004)

        blank = self.render_ink(lambda page: None, [0.1, 0.1, 0.9, 0.4])
        self.assertEqual(int(blank.sum()), 0, 'blank paper has no ink')

        def faint(page):
            page.draw_rect(pymupdf.Rect(100, 100, 200, 150), color=(0.95, 0.95, 0.95), fill=(0.95, 0.95, 0.95))

        self.assertEqual(int(self.render_ink(faint, [0.1, 0.1, 0.9, 0.4]).sum()), 0, 'a faint tint is still paper')

        def tinted_paper(page):
            page.draw_rect(page.rect, color=(0.85, 0.85, 0.8), fill=(0.85, 0.85, 0.8))
            page.draw_rect(pymupdf.Rect(100, 100, 200, 150), color=(0.1, 0.1, 0.1), fill=(0.1, 0.1, 0.1))

        tinted = self.render_ink(tinted_paper, [0.1, 0.1, 0.9, 0.4])
        self.assertAlmostEqual(tinted.mean(), 100 * 50 / (320 * 180), delta=0.004, msg='the paper is its own colour')

        def coloured_fill(page):
            page.draw_rect(pymupdf.Rect(100, 100, 200, 150), color=(0.2, 0.4, 0.8), fill=(0.2, 0.4, 0.8))

        filled = self.render_ink(coloured_fill, [0.1, 0.1, 0.9, 0.4])
        self.assertAlmostEqual(filled.mean(), 100 * 50 / (320 * 180), delta=0.004, msg='a filled box is an object')

    def test_ink_tolerates_a_noisy_scan(self):
        rng = np.random.default_rng(1)
        noise = np.clip(rng.normal(236, 5, (200, 300, 1)), 0, 255).astype(np.uint8).repeat(3, axis=2)
        noise[80:120, 100:200] = 20
        pix = pymupdf.Pixmap(pymupdf.csRGB, 300, 200, noise.tobytes(), False)
        ink = ink_map(pix)
        self.assertAlmostEqual(ink.mean(), 40 * 100 / (300 * 200), delta=0.002)


if __name__ == '__main__':
    unittest.main()
