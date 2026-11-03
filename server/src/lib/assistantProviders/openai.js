import { friendlyStatus, ProviderError, readSse } from './sse.js';

const BASE_URL = 'https://api.openai.com/v1';

export async function listModels(config) {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { authorization: `Bearer ${config.openaiApiKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new ProviderError(res.status);
  const body = await res.json();
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|image|transcribe|tts|embedding)/.test(id))
    .sort()
    .reverse();
}

export async function streamChat({ config, system, messages, maxTokens, onDelta, signal }) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new ProviderError(res.status);

  const final = { stopReason: 'stop', usage: { input: 0, output: 0 } };
  await readSse(res, (chunk) => {
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) onDelta(choice.delta.content);
    if (choice?.finish_reason) final.stopReason = choice.finish_reason;
    if (chunk.usage) {
      final.usage = { input: chunk.usage.prompt_tokens || 0, output: chunk.usage.completion_tokens || 0 };
    }
  });
  return final;
}

export function friendlyError(err) {
  return friendlyStatus(err, 'OpenAI');
}
