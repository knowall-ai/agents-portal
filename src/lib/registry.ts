import registry from '../../config/agents.json';
import type { AgentRegistryEntry } from '@/types';

/**
 * Static agent registry (config/agents.json).
 *
 * The registry is optional metadata: agents are primarily discovered from Azure
 * resource tags. Registry entries add friendly names, customer, portal URLs and
 * GitHub repos, and can claim untagged resource groups — inside the
 * subscriptions the entry names, or the registry's own tenant.
 */
export function getRegistry(): AgentRegistryEntry[] {
  return (registry.agents as AgentRegistryEntry[]).map((entry) => ({
    ...entry,
    id: entry.id.toLowerCase(),
    resourceGroups: (entry.resourceGroups ?? []).map((rg) => rg.toLowerCase()),
    subscriptionIds: (entry.subscriptionIds ?? []).map((id) => id.toLowerCase()),
  }));
}

export function getRegistryEntry(id: string): AgentRegistryEntry | undefined {
  return getRegistry().find((entry) => entry.id === id.toLowerCase());
}
