import Anthropic from '@anthropic-ai/sdk';

// System prompt is tagged ephemeral-cacheable and kept byte-stable by the
// caller (assistant.js) so Anthropic's prompt caching holds across requests.
export async function streamChat({ config, system, messages, maxTokens, onDelta, signal }) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const stream = client.messages.stream({
    model: config.anthropicModel,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  signal?.addEventListener('abort', () => stream.abort());

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onDelta(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  return {
    stopReason: final.stop_reason,
    usage: { input: final.usage.input_tokens, output: final.usage.output_tokens },
  };
}

// Returns null when the "error" is just the client disconnecting — nothing
// to report in that case.
export function friendlyError(err) {
  if (err?.name === 'AbortError') return null;
  const status = err?.status;
  if (status === 401) return 'your Anthropic API key was rejected — check it in your account settings';
  if (status === 429) return 'the assistant is rate-limited right now — try again in a moment';
  if (status >= 500) return 'the Claude API is having trouble — try again shortly';
  return 'assistant request failed — try again';
}
