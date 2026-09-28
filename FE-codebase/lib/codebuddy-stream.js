/** Collect OpenAI-style SSE chat chunks into the same shape as a JSON reply. */
export async function readCodeBuddyStream(response) {
  if (!response.body) throw new Error("CodeBuddy returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let model = null;
  let usage = null;
  let finishReason = null;
  let done = false;

  function consume(event) {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { done = true; return; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(`CodeBuddy API error: ${JSON.stringify(chunk.error)}`);
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    for (const choice of chunk.choices ?? []) {
      text += choice.delta?.content ?? "";
      finishReason = choice.finish_reason || finishReason;
    }
  }

  try {
    while (true) {
      const { value, done: ended } = await reader.read();
      pending += decoder.decode(value, { stream: !ended });
      pending = pending.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) !== -1) {
        consume(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (ended) break;
    }
    if (pending.trim()) consume(pending);
    if (!done) throw new Error("CodeBuddy stream ended before [DONE]");
    return { text, model, usage, finishReason };
  } finally {
    reader.releaseLock();
  }
}
