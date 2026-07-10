"""AI writing assist service — rewrite/expand/summarize selected text.

Streams the rewritten text as raw chunks.
"""
import logging

from services import llm_client
from services.pubsub import publish

logger = logging.getLogger(__name__)

COMMAND_PROMPTS = {
    "rewrite": "Rewrite the following text to improve clarity and flow. Keep the same meaning:\n\n",
    "expand": "Expand and elaborate on the following text with more detail and examples:\n\n",
    "summarize": "Summarize the following text concisely:\n\n",
    "polish": "Polish and refine the following text for a professional presentation:\n\n",
    # PPTist sends Chinese command keys — map them to the same prompts
    "美化改写": "Polish and refine the following text for a professional presentation:\n\n",
    "扩写丰富": "Expand and elaborate on the following text with more detail and examples:\n\n",
    "精简提炼": "Summarize the following text concisely:\n\n",
}


def process(ctx: dict):
    params = ctx["params"]
    content = params.get("content", "")
    command = params.get("command", "rewrite")
    stream_mode = params.get("stream_mode")

    prompt_prefix = COMMAND_PROMPTS.get(command, COMMAND_PROMPTS["rewrite"])
    messages = [
        {"role": "system", "content": "You are a professional writing assistant for presentations. Output only the rewritten text, no explanations."},
        {"role": "user", "content": prompt_prefix + content},
    ]

    logger.info("[writing_service] command=%s len=%d", command, len(content))

    if stream_mode == "raw":
        for chunk in llm_client.chat_stream(messages, temperature=0.5):
            publish(ctx["job_id"], {"type": "chunk", "text": chunk})
        publish(ctx["job_id"], {"type": "done"})
    else:
        text = llm_client.chat(messages, temperature=0.5)
        from core.db.repository import save_result
        save_result(ctx["request_id"], ctx["job_id"], "writing", {"text": text})
        publish(ctx["job_id"], {"type": "done", "result": {"text": text}, "resultType": "writing"})

    logger.info("[writing_service] done | job_id=%s", ctx["job_id"])
