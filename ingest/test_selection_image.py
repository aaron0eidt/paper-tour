import hashlib
from pathlib import Path
import tempfile
import unittest

import pymupdf
from selection_image import render_selection


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


if __name__ == '__main__':
    unittest.main()
