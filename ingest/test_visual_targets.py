import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from visual_targets import decode_image, detect_targets, intersection, area, ocr_words


def diagram():
    image = np.full((400, 600, 3), 255, np.uint8)
    cv2.rectangle(image, (100, 100), (260, 170), (0, 0, 0), 3)
    cv2.rectangle(image, (100, 240), (260, 310), (0, 0, 0), 3)
    cv2.arrowedLine(image, (180, 176), (180, 235), (0, 0, 0), 2)
    return image


def rect(target, width=600, height=400):
    return tuple(value * (width if i % 2 == 0 else height) for i, value in enumerate(target['region']))


class VisualTargetsTests(unittest.TestCase):
    def test_measured_closed_modules_no_border_duplicates_and_source_unchanged(self):
        image = diagram()
        before = image.copy()
        output = detect_targets(image, words=[])
        np.testing.assert_array_equal(image, before)
        modules = [target for target in output['targets'] if target['kind'] == 'component']
        self.assertEqual(len(modules), 2)
        for target, expected in zip(modules, [(98, 98, 263, 173), (98, 238, 263, 313)]):
            for actual, desired in zip(rect(target), expected):
                self.assertAlmostEqual(actual, desired, delta=1)
        self.assertEqual(intersection(rect(modules[0]), rect(modules[1])), 0)

    def test_png_and_jpeg_keep_original_coordinate_frame(self):
        image = diagram()
        for extension in ['.png', '.jpg']:
            with self.subTest(extension=extension):
                ok, encoded = cv2.imencode(extension, image)
                self.assertTrue(ok)
                data = base64.b64encode(encoded).decode()
                output = detect_targets(decode_image(data), words=[])
                components = [target for target in output['targets'] if target['kind'] == 'component']
                self.assertEqual(len(components), 2)
                self.assertAlmostEqual(components[0]['region'][0], 98 / 600, delta=0.005)
                self.assertAlmostEqual(components[0]['region'][1], 98 / 400, delta=0.005)
                self.assertTrue(all(0 <= v <= 1 for target in output['targets'] for v in target['region']))

    def test_nested_native_shades_require_multiple_modules(self):
        image = np.full((520, 620, 3), 255, np.uint8)
        cv2.rectangle(image, (20, 20), (600, 500), (240, 240, 240), -1)
        cv2.rectangle(image, (80, 70), (540, 340), (228, 228, 228), -1)
        for p0, p1 in [((150, 110), (450, 180)), ((150, 230), (450, 300)), ((150, 400), (450, 460))]:
            cv2.rectangle(image, p0, p1, (0, 0, 0), 3)
        output = detect_targets(image, words=[])
        components = [target for target in output['targets'] if target['kind'] == 'component']
        panels = [target for target in output['targets'] if target['kind'] == 'panel']
        self.assertEqual(len(components), 3)
        self.assertEqual(len(panels), 2, output)
        self.assertTrue(any(abs(target['region'][0] - 20 / 620) < 0.01 for target in panels))
        self.assertTrue(any(abs(target['region'][0] - 80 / 620) < 0.01 for target in panels))
        blank = np.full((400, 600, 3), 255, np.uint8)
        cv2.rectangle(blank, (50, 50), (500, 350), (235, 235, 235), -1)
        self.assertEqual(detect_targets(blank, words=[]), {'targets': []}, 'a shaded box alone is not a fabricated panel')

    def test_ocr_is_associated_with_module_and_remaining_lines_are_grouped(self):
        words = [
            {'text': 'Feed', 'rect': (130, 118, 175, 134), 'line': ('1', '1', '1')},
            {'text': 'Forward', 'rect': (176, 118, 240, 134), 'line': ('1', '1', '1')},
            {'text': 'Positional', 'rect': (350, 210, 430, 226), 'line': ('2', '1', '1')},
            {'text': 'Encoding', 'rect': (355, 234, 425, 250), 'line': ('2', '1', '2')},
        ]
        output = detect_targets(diagram(), words=words)
        components = [target for target in output['targets'] if target['kind'] == 'component']
        text = [target for target in output['targets'] if target['kind'] == 'text']
        self.assertEqual(components[0]['label'], 'Feed Forward')
        self.assertEqual(len(text), 1)
        self.assertEqual(text[0]['label'], 'Positional Encoding')
        for actual, expected in zip(rect(text[0]), (350, 210, 430, 250)):
            self.assertAlmostEqual(actual, expected, delta=0.001)

    def test_blank_and_invalid_images_do_not_emit_broad_fallback_targets(self):
        for color in [255, 0, 50, 235]:
            self.assertEqual(detect_targets(np.full((200, 300, 3), color, np.uint8), words=[]), {'targets': []}, f'canvas {color} is not a component')
        for invalid in [None, 'not base64!', base64.b64encode(b'not an image').decode()]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                decode_image(invalid)

    def test_ocr_failure_is_reported_instead_of_silently_returning_empty_labels(self):
        with patch('visual_targets.shutil.which', return_value='/mock/tesseract'), patch('visual_targets.subprocess.run', side_effect=subprocess.TimeoutExpired('tesseract', 3)) as run:
            with self.assertRaisesRegex(TimeoutError, 'tesseract OCR exceeded'):
                detect_targets(diagram())
            self.assertTrue(all(0 < call.kwargs['timeout'] <= 3 for call in run.call_args_list))
        with patch('visual_targets.shutil.which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'tesseract is required'):
                detect_targets(diagram())
        with patch('visual_targets.shutil.which', return_value='/mock/tesseract'), patch('visual_targets.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'tesseract')):
            with self.assertRaisesRegex(ValueError, 'tesseract OCR failed'):
                detect_targets(diagram())

    def test_repository_fixture_png_and_jpeg_have_matching_module_and_panel_geometry(self):
        root = Path(__file__).resolve().parents[1] / '.data/attention-harness-benchmark'
        png, jpeg = root / 'assets/figures/fig1.png', root / 'images/figures/fig1.jpg'
        if not png.exists() or not jpeg.exists():
            self.skipTest('Optional actual diagram fixtures are not present.')
        original = cv2.imread(str(png))
        encoded = cv2.imread(str(jpeg))
        left = detect_targets(original, words=[])['targets']
        right = detect_targets(encoded, words=[])['targets']
        for kind, expected in [('component', 14), ('panel', 2)]:
            a = sorted([item['region'] for item in left if item['kind'] == kind])
            b = sorted([item['region'] for item in right if item['kind'] == kind])
            self.assertEqual(len(a), expected)
            self.assertEqual(len(b), expected)
            for first, second in zip(a, b):
                for index, (x, y) in enumerate(zip(first, second)):
                    self.assertLessEqual(abs(x - y) * original.shape[1 if index % 2 == 0 else 0], 4)

    def test_cli_json_contract(self):
        image = diagram()
        cv2.putText(image, 'MODULE', (120, 146), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
        _, encoded = cv2.imencode('.png', image)
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('visual_targets.py'))],
                                input=json.dumps({'image': base64.b64encode(encoded).decode()}).encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8, check=True)
        output = json.loads(result.stdout)
        self.assertEqual(list(output), ['targets'])
        self.assertTrue(output['targets'])
        for target in output['targets']:
            self.assertEqual(set(target), {'kind', 'label', 'region'})


if __name__ == '__main__':
    unittest.main()
