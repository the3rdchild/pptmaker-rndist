import unittest
from unittest.mock import Mock, patch

from services import outline_service


OUTLINE_WITHOUT_VISUAL = """# Predictive Maintenance
## Implementasi Purwarupa
Purwarupa mengintegrasikan enam modul AI di lingkungan produksi.
- Overall Risk History
- Turbine Risk History
## Hasil Virtual Sensor
Model memperkirakan kondisi proses yang tidak terukur langsung.
Visual: Engineer memantau grafik sensor turbin pada layar di ruang kontrol industri.
- Dryness Prediction
"""


class OutlineVisualAutofillTests(unittest.TestCase):
    def test_raw_outline_generation_repairs_missing_visual_before_publishing(self):
        events = []
        repaired_visual = (
            "Tim engineer memeriksa dashboard enam modul AI di ruang kontrol pabrik."
        )
        repair = Mock(
            return_value={"visuals": [{"slide": 1, "visual": repaired_visual}]}
        )

        with (
            patch.object(outline_service.llm_client, "chat", return_value=OUTLINE_WITHOUT_VISUAL),
            patch.object(
                outline_service.llm_client,
                "chat_stream",
                return_value=iter([OUTLINE_WITHOUT_VISUAL]),
            ),
            patch.object(outline_service.llm_client, "chat_json", repair),
            patch.object(outline_service, "publish", side_effect=lambda _job, event: events.append(event)),
        ):
            outline_service.process(
                {
                    "job_id": "job-1",
                    "params": {
                        "prompt": "Predictive maintenance",
                        "language": "Bahasa Indonesia",
                        "stream_mode": "raw",
                    },
                }
            )

        published_text = "".join(
            event["text"] for event in events if event.get("type") == "chunk"
        )
        self.assertTrue(any(event.get("type") == "heartbeat" for event in events))
        self.assertIn(f"Visual: {repaired_visual}", published_text)
        self.assertEqual(published_text.count("Visual:"), 2)
        self.assertIn("- Overall Risk History", published_text)
        self.assertIn(
            "Visual: Engineer memantau grafik sensor turbin pada layar di ruang kontrol industri.",
            published_text,
        )
        self.assertEqual(repair.call_count, 1)
        repair_prompt = repair.call_args.kwargs["messages"][1]["content"]
        self.assertIn("Slide 1", repair_prompt)
        self.assertNotIn("Slide 2", repair_prompt)
        self.assertEqual(events[-1], {"type": "done"})

    def test_complete_outline_does_not_request_an_ai_repair(self):
        complete = """# Kopi
## Panen
Petani memilih buah matang.
Visual: Petani memetik buah kopi merah di lereng saat matahari terbit.
- Panen selektif
"""

        repair = Mock(side_effect=AssertionError("repair should not run"))
        result = outline_service.ensure_outline_visuals(
            complete,
            topic="Kopi",
            language="Bahasa Indonesia",
            provider=None,
            repair_json=repair,
        )

        self.assertEqual(result, complete)
        repair.assert_not_called()

    def test_malformed_ai_repair_still_leaves_no_image_brief_blank(self):
        result = outline_service.ensure_outline_visuals(
            OUTLINE_WITHOUT_VISUAL,
            topic="Predictive maintenance",
            language="Bahasa Indonesia",
            provider=None,
            repair_json=lambda **_kwargs: {"visuals": []},
        )

        self.assertEqual(result.count("Visual:"), 2)
        self.assertIn(
            "Visual: Implementasi Purwarupa — Purwarupa mengintegrasikan enam modul AI di lingkungan produksi.",
            result,
        )

    def test_empty_visual_marker_is_replaced_instead_of_duplicated(self):
        outline = """# Energi
## Panel Surya
Teknisi memasang sistem energi bersih di gedung perkotaan.
Visual:
- Efisiensi energi
"""
        result = outline_service.ensure_outline_visuals(
            outline,
            topic="Energi bersih",
            language="Bahasa Indonesia",
            provider=None,
            repair_json=lambda **_kwargs: {
                "visuals": [
                    {
                        "slide": 1,
                        "visual": "Teknisi memasang panel surya di atap gedung dengan skyline kota.",
                    }
                ]
            },
        )

        self.assertEqual(result.count("Visual:"), 1)
        self.assertNotIn("Visual:\n", result)
        self.assertIn(
            "Visual: Teknisi memasang panel surya di atap gedung dengan skyline kota.",
            result,
        )

    def test_raw_buffer_emits_periodic_heartbeat_while_chunks_arrive(self):
        complete = """# Kopi
## Panen
Petani memilih buah matang.
Visual: Petani memetik buah kopi merah di lereng saat matahari terbit.
- Panen selektif
"""
        events = []
        repair = Mock(side_effect=AssertionError("repair should not run"))

        with (
            patch.object(
                outline_service.llm_client,
                "chat_stream",
                return_value=iter([complete[:40], complete[40:]]),
            ),
            patch.object(outline_service.llm_client, "chat_json", repair),
            patch.object(outline_service.time, "monotonic", side_effect=[0, 16, 17]),
            patch.object(outline_service, "publish", side_effect=lambda _job, event: events.append(event)),
        ):
            outline_service.process(
                {
                    "job_id": "job-heartbeat",
                    "params": {
                        "prompt": "Kopi",
                        "language": "Bahasa Indonesia",
                        "stream_mode": "raw",
                    },
                }
            )

        outline_heartbeats = [
            event
            for event in events
            if event.get("type") == "heartbeat" and event.get("phase") == "outline"
        ]
        self.assertEqual(len(outline_heartbeats), 2)
        repair.assert_not_called()

    def test_valid_visual_followed_by_empty_duplicate_is_canonicalized(self):
        outline = """# Energi
## Panel Surya
Teknisi memasang sistem energi bersih di gedung perkotaan.
Visual: Teknisi memasang panel surya di atap gedung dengan skyline kota.
Visual:
- Efisiensi energi
"""
        repair = Mock(side_effect=AssertionError("repair should not run"))

        result = outline_service.ensure_outline_visuals(
            outline,
            topic="Energi bersih",
            language="Bahasa Indonesia",
            provider=None,
            repair_json=repair,
        )

        self.assertEqual(result.count("Visual:"), 1)
        self.assertNotIn("Visual:\n", result)
        self.assertIn(
            "Visual: Teknisi memasang panel surya di atap gedung dengan skyline kota.",
            result,
        )
        repair.assert_not_called()


if __name__ == "__main__":
    unittest.main()
