from unittest.mock import patch

from services import image_client


def test_runware_image_cost_is_returned_with_image_bytes():
    class Reply:
        content = b"png"

        def raise_for_status(self):
            pass

        def json(self):
            return {"data": [{"imageURL": "https://example.test/image.png", "cost": 0.0044}]}

    with (
        patch.object(image_client, "RUNWARE_API_KEY", "local-test"),
        patch.object(image_client.requests, "post", return_value=Reply()) as request,
        patch.object(image_client.requests, "get", return_value=Reply()),
    ):
        result = image_client.generate_image("test")
    assert result == (b"png", 0.0044)
    assert request.call_args.kwargs["json"][0]["includeCost"] is True
