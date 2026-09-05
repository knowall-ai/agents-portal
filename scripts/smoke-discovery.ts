// Run agent discovery against real Azure data using your `az login` session —
// no browser sign-in needed. Useful when onboarding a new agent or debugging tags.
//
//   bun run smoke
//
import { execSync } from 'child_process';
import { getRegistry } from '@/lib/registry';
import { listAgentResources, listSubscriptions } from '@/lib/providers/azure';
import { listAssistants, listFoundryProjects } from '@/lib/providers/foundry';
import { probeUrl } from '@/lib/providers/health';
import { buildAgent, groupResources, sortAgents } from '@/lib/agents/discover';
import { queryAzureCosts } from '@/lib/providers/costs';

function azToken(scope: string): string {
  return execSync(`az account get-access-token --scope ${scope} --query accessToken -o tsv`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const tenantId = execSync('az account show --query tenantId -o tsv', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

// Registry resource-group claims only apply inside the registry's own tenant
// (or an entry's subscriptionIds); for a smoke run that tenant is the az session's.
process.env.AZURE_AD_TENANT_ID = tenantId;

const armToken = azToken('https://management.azure.com/.default');
const [resources, subscriptions] = await Promise.all([
  listAgentResources(armToken),
  listSubscriptions(armToken),
]);
console.log(
  `Tenant ${tenantId}: ${resources.length} agent-shaped resources in ${subscriptions.length} subscription(s)\n`
);

const agents = sortAgents(
  groupResources(resources, getRegistry()).map((b) => buildAgent(b, subscriptions, tenantId))
);

let foundryToken: string | null = null;
try {
  foundryToken = azToken('https://ai.azure.com/.default');
} catch {
  console.warn('No AI Foundry token available — skipping assistants');
}

const costRows = await queryAzureCosts(
  armToken,
  subscriptions[0]?.subscriptionId ?? '',
  'MonthToDate'
).catch((e) => {
  console.warn('Cost query failed:', e instanceof Error ? e.message : e);
  return [];
});

for (const agent of agents) {
  const badge = agent.delegated ? ' [Lighthouse]' : '';
  console.log(
    `${agent.name} (${agent.id}) — ${agent.customer} · ${agent.kind} · ${agent.environment}${badge}`
  );
  console.log(`  status: ${agent.status} — ${agent.statusReason}`);
  for (const r of agent.resources) {
    console.log(
      `  - ${r.type.split('/').pop()} ${r.name} [${r.rawState ?? r.state}] (${r.resourceGroup})`
    );
  }
  if (agent.portalUrl) {
    const probe = await probeUrl(agent.portalUrl);
    console.log(
      `  probe: ${probe.url} → ${probe.reachable ? 'reachable' : 'unreachable'} (HTTP ${probe.httpStatus ?? 'n/a'})`
    );
  }
  const groups = new Set(agent.resourceGroups);
  const byCurrency = new Map<string, number>();
  for (const row of costRows) {
    if (!groups.has(row.resourceGroup)) continue;
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
  }
  if (byCurrency.size) {
    console.log(
      `  cost MTD: ${[...byCurrency].map(([c, v]) => `${v.toFixed(2)} ${c}`).join(', ')}`
    );
  }
  const projects = await listFoundryProjects(armToken, agent.resources);
  if (projects.length && foundryToken) {
    const assistants = await listAssistants(foundryToken, projects);
    for (const a of assistants) {
      console.log(`  assistant: ${a.name} (${a.model}) tools=${a.tools.join(',') || 'none'}`);
    }
  }
  console.log();
}
