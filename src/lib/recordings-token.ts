import { agentTokenFor } from '@/lib/agent-token';

/**
 * The bearer token for an agent's recordings API (the Presence bridge).
 * RECORDINGS_TOKEN_<AGENT> per agent, RECORDINGS_TOKEN as the shared fallback.
 */
export function recordingsTokenFor(
  agentId: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return agentTokenFor('RECORDINGS_TOKEN', agentId, env);
}
