/**
 * Output budgets per model. The model's output cap also has to hold its reasoning: a reasoning model that thinks
 * through a long page used to spend the whole of the old fixed 8192 tokens before it wrote the answer.
 */

/** Output-token cap for a model id, from what the model families accept; unknown models get a middle value. */
export function maxOutputFor(modelId: string): number {
  const id = modelId.toLowerCase().replace(/^.*\//, ''); // "deepseek/deepseek-v4.1-flash" -> "deepseek-v4.1-flash"
  const rules: [RegExp, number][] = [
    [/gpt-3\.5/, 4096],
    [/^deepseek-chat$/, 8192],
    [/gemini-1\.|gemini-pro$/, 8192],
    [/gpt-4o|gpt-4-turbo|chatgpt-4o/, 16384],
    [/gpt-4\.1/, 32768],
    [/gpt-5|^o\d/, 65536],
    [/claude/, 32000],
    [/gemini/, 65536],
    [/deepseek|kimi|moonshot|glm|minimax/, 32768],
    [/qwen|grok|mistral|llama|gemma|phi/, 16384],
  ];
  return rules.find(([re]) => re.test(id))?.[1] ?? DEFAULT_MAX_OUTPUT;
}
export const DEFAULT_MAX_OUTPUT = 16384;
/** the old fixed value, which every OpenAI-compatible server accepts: the fallback when a server rejects a larger cap */
export const SAFE_MAX_OUTPUT = 8192;
export const MAX_OUTPUT_CEILING = 65536;

/** A provider refused the output cap itself (e.g. "max_tokens must be <= 8192"). */
export const isMaxTokensError = (e: unknown) => /max_(completion_)?tokens|max.?output|maximum.{0,20}tokens|tokens? .{0,20}(too large|exceed)/i.test(String((e as any)?.message ?? e));

/** A provider or model that does not do tool calling. */
export const isToolsUnsupportedError = (e: unknown) => /tool|function.?call/i.test(String((e as any)?.message ?? e))
  && /support|not (allowed|available|enabled)|invalid|unknown|unrecognized|extra/i.test(String((e as any)?.message ?? e));

/** The model ran out of output budget: the text is cut off and must never be parsed. */
export class OutputTruncated extends Error {
  constructor(readonly text: string, readonly maxTokens: number) { super(`Output truncated at ${maxTokens} tokens`); this.name = 'OutputTruncated'; }
}
