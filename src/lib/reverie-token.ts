import { agentTokenFor } from '@/lib/agent-token';

/**
 * The bearer token for an agent's `reverie serve`. Each agent may have its own
 * (REVERIE_TOKEN_<AGENT>, the id upper-cased with anything but letters and
 * digits as underscores); REVERIE_TOKEN is the shared fallback.
 */
export function reverieTokenFor(
  agentId: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return agentTokenFor('REVERIE_TOKEN', agentId, env);
}
