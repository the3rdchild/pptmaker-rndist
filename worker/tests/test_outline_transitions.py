import unittest

from services.outline_transitions import (
    insert_transition_lines,
    parse_transition_line,
    split_transition_lines,
)

OUTLINE = """# Kopi Nusantara
## Cover
Transition: morph — should be forced to none
Pembuka tentang kopi.
Visual: Petani memetik ceri kopi merah di lereng Gayo.
- poin
## Dari Kebun
Perjalanan biji kopi.
Visual: Biji kopi dijemur di bawah matahari.
Transisi: Magic-Move — judul cover mengecil ke pojok kiri atas
- poin
## Angka Ekspor
Transition: spin — unknown id
Data ekspor.
- poin
"""


class OutlineTransitionTests(unittest.TestCase):
    def test_parses_ids_aliases_and_notes(self):
        self.assertEqual(parse_transition_line("Transition: morph — judul mengecil"), ("morph", "judul mengecil"))
        self.assertEqual(parse_transition_line("transition: fade - babak baru"), ("fade-black", "babak baru"))
        self.assertIsNone(parse_transition_line("Transition: spin"))
        self.assertIsNone(parse_transition_line("Visual: laut"))

    def test_split_removes_every_line_and_keeps_the_valid_plan(self):
        text, plan = split_transition_lines(OUTLINE)
        self.assertNotIn("Transition", text)
        self.assertNotIn("Transisi", text)
        self.assertEqual(plan[2], ("morph", "judul cover mengecil ke pojok kiri atas"))
        self.assertNotIn(3, plan)
        # the description is the first copy line again, not the transition line
        self.assertIn("## Cover\nPembuka tentang kopi.", text)

    def test_insert_writes_one_canonical_line_per_slide(self):
        text, plan = split_transition_lines(OUTLINE)
        result = insert_transition_lines(text, plan)
        lines = result.splitlines()
        transitions = [line for line in lines if line.startswith("Transition:")]
        self.assertEqual(
            transitions,
            [
                "Transition: none",
                "Transition: morph — judul cover mengecil ke pojok kiri atas",
                "Transition: fade-black",
            ],
        )
        # after the Visual line when there is one, after the description otherwise
        self.assertEqual(lines[lines.index("Visual: Biji kopi dijemur di bawah matahari.") + 1], transitions[1])
        self.assertEqual(lines[lines.index("Data ekspor.") + 1], "Transition: fade-black")


if __name__ == "__main__":
    unittest.main()
