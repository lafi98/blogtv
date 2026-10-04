/**
 * Server-side Claude client. The API key is read by the SDK from the ANTHROPIC_API_KEY
 * environment variable on the server — it is never sent to, or bundled for, the browser.
 * This module must only be imported from server code (pages' frontmatter, endpoints, CLI).
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

let client: Anthropic | null = null;

export function aiAvailable(): boolean {
  return config.ai.apiKeyConfigured;
}

export function getClient(): Anthropic {
  if (!aiAvailable()) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  client ??= new Anthropic({ maxRetries: 3, timeout: 15 * 60 * 1000 });
  return client;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  calls: number;
}

export const emptyUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, calls: 0 });

export function addUsage(total: Usage, u: { input_tokens?: number | null; output_tokens?: number | null } | undefined) {
  total.input_tokens += u?.input_tokens ?? 0;
  total.output_tokens += u?.output_tokens ?? 0;
  total.calls += 1;
}

/** Model-dependent request options: effort, and server-side refusal fallback where supported. */
export function modelOptions() {
  const model = config.ai.model;
  const supportsEffort = !/haiku|sonnet-4-5|opus-4-5/.test(model);
  const supportsDefaultFallback = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
  return {
    model,
    ...(supportsEffort ? { output_config: { effort: config.ai.effort } } : {}),
    ...(supportsDefaultFallback ? { betas: ['server-side-fallback-2026-07-01'] as string[], fallbacks: 'default' as const } : {}),
  };
}

export class RefusalError extends Error {
  constructor(public category: string | null | undefined) {
    super(`The model declined this request${category ? ` (${category})` : ''}.`);
  }
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic API key was rejected (401). Check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'API key lacks permission for this model or feature (403).';
  if (err instanceof Anthropic.NotFoundError) return `Model "${config.ai.model}" was not found (404). Check AI_MODEL.`;
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API (429). Try again later.';
  if (err instanceof Anthropic.BadRequestError) return `Bad request to the Anthropic API: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API (network error).';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  if (err instanceof RefusalError) return err.message;
  return (err as Error)?.message ?? String(err);
}
