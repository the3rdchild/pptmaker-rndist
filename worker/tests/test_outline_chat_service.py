import unittest

from services.outline_chat_service import parse_revision_block


class ParseRevisionBlockTests(unittest.TestCase):
    def test_visual_line_is_image_brief_not_visible_bullet(self):
        revision = parse_revision_block(
            """```slide
Pemulihan Mangrove
Akar mangrove melindungi garis pantai.
Visual: Peneliti mengukur bibit mangrove di pesisir berlumpur saat pagi.
- Mengurangi abrasi
```"""
        )

        self.assertEqual(
            revision["imageBrief"],
            "Peneliti mengukur bibit mangrove di pesisir berlumpur saat pagi.",
        )
        self.assertEqual(revision["bullets"], ["Mengurangi abrasi"])


if __name__ == "__main__":
    unittest.main()
