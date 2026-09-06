/**
 * A server-held bearer token for one of an agent's own services. Each agent
 * may have its own (`<PREFIX>_<AGENT>`, the id upper-cased with anything but
 * letters and digits as underscores); `<PREFIX>` alone is the shared fallback.
 */
export function agentTokenFor(
  prefix: string,
  agentId: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const own = env[`${prefix}_${agentEnvKey(agentId)}`];
  return own || env[prefix] || undefined;
}

/** The agent id as it appears in a per-agent setting name: `poppie-2` -> `POPPIE_2` */
export function agentEnvKey(agentId: string): string {
  return agentId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
