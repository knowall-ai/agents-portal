import { describe, expect, it, vi } from 'vitest';
import type { AgentRegistryEntry, AzureResource } from '@/types';
import {
  buildAgent,
  OPENAI_PROJECT_ID,
  providerId,
  claimsResource,
  deriveStatus,
  groupResources,
  normaliseEnvironment,
  safeAvatarUrl,
  safeHttpsUrl,
  slugify,
  teamsCallUrl,
  teamsChatUrl,
} from './discover';

function resource(overrides: Partial<AzureResource>): AzureResource {
  return {
    id: `/subscriptions/sub/resourceGroups/${overrides.resourceGroup ?? 'rg'}/providers/x/${overrides.name ?? 'r'}`,
    name: 'r',
    type: 'microsoft.web/sites',
    location: 'uksouth',
    resourceGroup: 'rg',
    subscriptionId: 'sub',
    tenantId: 'tenant-a',
    tags: {},
    state: 'running',
    ...overrides,
  };
}

const registry: AgentRegistryEntry[] = [
  {
    id: 'sallie',
    name: 'Sallie',
    kind: 'openclaw',
    customer: 'KnowAll AI',
    resourceGroups: ['ka-agents'],
    subscriptionIds: ['sub'],
  },
  { id: 'allie', name: 'Allie', customer: 'Cairn Homes', planned: true },
];

describe('groupResources', () => {
  it('never hands a tagged resource to the resource-group claimant, even when the tag is junk', () => {
    const buckets = groupResources(
      [
        resource({
          name: 'stray-vm',
          type: 'microsoft.compute/virtualmachines',
          resourceGroup: 'ka-agents',
          tags: { agent: '!!!' },
        }),
      ],
      registry,
      ['agent']
    );
    expect(buckets.find((b) => b.id === 'sallie')?.resources).toEqual([]);
    expect(buckets.flatMap((b) => b.resources)).toEqual([]);
  });

  it('claims untagged resources by registry resource group', () => {
    const buckets = groupResources(
      [
        resource({
          name: 'ka-sallie-vm',
          type: 'microsoft.compute/virtualmachines',
          resourceGroup: 'ka-agents',
        }),
      ],
      registry,
      ['agent', 'project']
    );
    const sallie = buckets.find((b) => b.id === 'sallie');
    expect(sallie?.resources).toHaveLength(1);
    expect(sallie?.fromTags).toBe(false);
  });

  it('lets a tag beat a registry resource-group claim (shared resource group)', () => {
    const buckets = groupResources(
      [
        resource({ name: 'ka-sallie-vm', resourceGroup: 'ka-agents' }),
        resource({ name: 'ka-poppie-vm', resourceGroup: 'KA-Agents', tags: { agent: 'poppie' } }),
      ],
      registry,
      ['agent', 'project']
    );
    expect(buckets.find((b) => b.id === 'sallie')?.resources.map((r) => r.name)).toEqual([
      'ka-sallie-vm',
    ]);
    const poppie = buckets.find((b) => b.id === 'poppie');
    expect(poppie?.resources.map((r) => r.name)).toEqual(['ka-poppie-vm']);
    expect(poppie?.fromTags).toBe(true);
  });

  it('discovers agents from tags, case-insensitively', () => {
    const buckets = groupResources(
      [
        resource({
          name: 'bot-winnie',
          resourceGroup: 'rg-winnie-dev',
          tags: { project: 'winnie' },
        }),
        resource({
          name: 'func-winnie',
          resourceGroup: 'rg-winnie-dev',
          tags: { Project: 'Winnie' },
        }),
      ],
      registry,
      ['agent', 'project']
    );
    const winnie = buckets.find((b) => b.id === 'winnie');
    expect(winnie?.resources).toHaveLength(2);
    expect(winnie?.fromTags).toBe(true);
  });

  it('prefers the agent tag over the project tag', () => {
    const buckets = groupResources(
      [resource({ tags: { agent: 'pennie', project: 'tminus15' } })],
      registry,
      ['agent', 'project']
    );
    expect(buckets.map((b) => b.id)).toContain('pennie');
    expect(buckets.map((b) => b.id)).not.toContain('tminus15');
  });

  it('keeps planned registry agents with no resources', () => {
    const buckets = groupResources([], registry, ['agent']);
    expect(buckets.find((b) => b.id === 'allie')?.resources).toHaveLength(0);
  });

  it('does not let a same-named resource group in another subscription claim an entry', () => {
    const buckets = groupResources(
      [resource({ resourceGroup: 'ka-agents', subscriptionId: 'other-sub' })],
      registry,
      ['agent']
    );
    expect(buckets.find((b) => b.id === 'sallie')?.resources ?? []).toHaveLength(0);
  });
});

describe('claimsResource', () => {
  const entry: AgentRegistryEntry = {
    id: 'sallie',
    name: 'Sallie',
    customer: 'KnowAll AI',
    resourceGroups: ['ka-agents'],
  };
  const home = { AZURE_AD_TENANT_ID: 'tenant-a' };

  it('claims the named groups in the registry tenant', () => {
    expect(claimsResource(entry, resource({ resourceGroup: 'ka-agents' }), home)).toBe(true);
    expect(claimsResource(entry, resource({ resourceGroup: 'KA-Agents' }), home)).toBe(true);
    expect(claimsResource(entry, resource({ resourceGroup: 'other-rg' }), home)).toBe(false);
    expect(
      claimsResource(entry, resource({ resourceGroup: 'ka-agents', tenantId: 'tenant-b' }), home)
    ).toBe(false);
  });

  it('claims by subscription when the entry names one, in any tenant', () => {
    const scoped = { ...entry, subscriptionIds: ['SUB'] };
    expect(
      claimsResource(scoped, resource({ resourceGroup: 'ka-agents', tenantId: 'tenant-b' }), {})
    ).toBe(true);
    expect(
      claimsResource(
        scoped,
        resource({ resourceGroup: 'ka-agents', subscriptionId: 'other' }),
        home
      )
    ).toBe(false);
  });

  it('claims nothing when several tenants are trusted and no subscription is named', () => {
    const multi = { AZURE_AD_ALLOWED_TENANTS: 'tenant-a,tenant-b' };
    expect(claimsResource(entry, resource({ resourceGroup: 'ka-agents' }), multi)).toBe(false);
  });

  it('scopes entries that name no resource group to the registry tenant', () => {
    const anyGroup: AgentRegistryEntry = { id: 'allie', name: 'Allie', customer: 'Cairn Homes' };
    expect(claimsResource(anyGroup, resource({ resourceGroup: 'anything' }), home)).toBe(true);
    expect(claimsResource(anyGroup, resource({ tenantId: 'tenant-b' }), home)).toBe(false);
  });
});

describe('deriveStatus', () => {
  it('is online when all compute runs', () => {
    expect(deriveStatus([resource({ state: 'running' })]).status).toBe('online');
  });
  it('is offline when all compute is stopped', () => {
    expect(
      deriveStatus([resource({ type: 'microsoft.compute/virtualmachines', state: 'deallocated' })])
        .status
    ).toBe('offline');
  });
  it('is degraded when some compute is stopped', () => {
    expect(
      deriveStatus([
        resource({ name: 'a', state: 'running' }),
        resource({ name: 'b', state: 'stopped' }),
      ]).status
    ).toBe('degraded');
  });
  it('treats managed-only deployments as online', () => {
    expect(
      deriveStatus([resource({ type: 'microsoft.botservice/botservices', state: 'provisioned' })])
        .status
    ).toBe('online');
  });
});

describe('buildAgent', () => {
  it('marks planned agents and flags Lighthouse-delegated resources', () => {
    const buckets = groupResources(
      [
        resource({
          resourceGroup: 'ka-agents',
          tenantId: 'tenant-b',
          type: 'microsoft.compute/virtualmachines',
        }),
      ],
      registry,
      ['agent']
    );
    const sallie = buildAgent(
      buckets.find((b) => b.id === 'sallie')!,
      [
        {
          subscriptionId: 'sub',
          name: 'Customer Sub',
          tenantId: 'tenant-b',
          managedByTenants: ['tenant-a'],
        },
      ],
      'tenant-a'
    );
    expect(sallie.delegated).toBe(true);
    expect(sallie.subscriptionName).toBe('Customer Sub');
    expect(sallie.kind).toBe('openclaw');

    const allie = buildAgent(buckets.find((b) => b.id === 'allie')!, [], 'tenant-a');
    expect(allie.status).toBe('planned');
    expect(allie.delegated).toBe(false);
  });
});

describe('helpers', () => {
  it('normalises environments', () => {
    expect(normaliseEnvironment('Production')).toBe('prod');
    expect(normaliseEnvironment('UAT')).toBe('test');
    expect(normaliseEnvironment('dev')).toBe('dev');
    expect(normaliseEnvironment(undefined)).toBe('unknown');
  });
  it('slugifies tag values', () => {
    expect(slugify('Zaplie Test')).toBe('zaplie-test');
  });
});

describe('claimsResource', () => {
  it('refuses a privileged entry that does not pin its subscriptions', () => {
    const env = { AZURE_AD_TENANT_ID: 'tenant-a' };
    const r = { resourceGroup: 'ka-agents', subscriptionId: 'sub', tenantId: 'tenant-a' };
    // metadata-only entries may still claim by group within the tenant
    expect(claimsResource({ id: 'a', name: 'A', resourceGroups: ['ka-agents'] }, r, env)).toBe(
      true
    );
    // anything that spends a server token needs explicit subscriptions
    const privileged = {
      id: 'a',
      name: 'A',
      resourceGroups: ['ka-agents'],
      brainUrl: 'https://a.example/reverie',
    };
    expect(claimsResource(privileged, r, env)).toBe(false);
    expect(claimsResource({ ...privileged, subscriptionIds: ['sub'] }, r, env)).toBe(true);
    expect(claimsResource({ ...privileged, subscriptionIds: ['other'] }, r, env)).toBe(false);
  });
});

describe('provider ids from tags', () => {
  it('reads well-formed OpenAI project and Anthropic workspace ids, and ignores junk', () => {
    const good = groupResources(
      [
        resource({
          tags: {
            agent: 'poppie',
            'agent-openai-project': 'proj_PeNiK7xb3bPeb6rMCijD6YTB',
            'agent-anthropic-workspace': 'wrkspc_abc123def',
          },
        }),
      ],
      [],
      ['agent']
    );
    const poppie = buildAgent(good[0], [], 't');
    expect(poppie.openaiProjectId).toBe('proj_PeNiK7xb3bPeb6rMCijD6YTB');
    expect(poppie.anthropicWorkspaceId).toBe('wrkspc_abc123def');
    const junk = groupResources(
      [resource({ tags: { agent: 'poppie', 'agent-openai-project': 'default project' } })],
      [],
      ['agent']
    );
    expect(buildAgent(junk[0], [], 't').openaiProjectId).toBeUndefined();
  });

  it('gives a registry-only agent no repo or portal URL, so server tokens are never spent for it', () => {
    vi.stubEnv('AZURE_AD_TENANT_ID', 't');
    try {
      const entry = {
        id: 'sallie',
        name: 'Sallie',
        resourceGroups: ['ka-agents'],
        subscriptionIds: ['sub'],
        repo: 'knowall-ai/sallie-openclaw',
        portalUrl: 'https://sallie.example.com',
      };
      const unseen = buildAgent(
        { id: 'sallie', registry: entry, resources: [], fromTags: false },
        [],
        't'
      );
      expect(unseen.repo).toBeUndefined();
      expect(unseen.portalUrl).toBeUndefined();
      const seen = buildAgent(
        {
          id: 'sallie',
          registry: entry,
          resources: [resource({ resourceGroup: 'ka-agents', tenantId: 't' })],
          fromTags: false,
        },
        [],
        't'
      );
      expect(seen.repo).toBe('knowall-ai/sallie-openclaw');
      expect(seen.portalUrl).toBe('https://sallie.example.com/');
      // tags still work without any registry entry: they sit on a visible resource
      const tagged = buildAgent(
        {
          id: 'poppie',
          registry: undefined,
          resources: [
            resource({
              tags: {
                agent: 'poppie',
                'agent-url': 'https://poppie.example.com',
                'agent-repo': 'knowall-ai/poppie-hermes',
              },
            }),
          ],
          fromTags: true,
        },
        [],
        't'
      );
      expect(tagged.repo).toBe('knowall-ai/poppie-hermes');
      expect(tagged.portalUrl).toBe('https://poppie.example.com/');
      // a trusted entry that says nothing about repo or URL defers to the tags
      const bare = buildAgent(
        {
          id: 'sallie',
          registry: { id: 'sallie', name: 'Sallie', resourceGroups: ['ka-agents'] },
          resources: [
            resource({
              resourceGroup: 'ka-agents',
              tenantId: 't',
              tags: { 'agent-url': 'https://sallie.example.com', 'agent-repo': 'knowall-ai/x' },
            }),
          ],
          fromTags: false,
        },
        [],
        't'
      );
      expect(bare.repo).toBe('knowall-ai/x');
      expect(bare.portalUrl).toBe('https://sallie.example.com/');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('takes a registry id only when the caller can see a resource the entry claims', () => {
    vi.stubEnv('AZURE_AD_TENANT_ID', 't');
    try {
      const entry = {
        id: 'sallie',
        name: 'Sallie',
        resourceGroups: ['ka-agents'],
        openaiProjectId: 'proj_registry',
      };
      const nothingVisible = buildAgent(
        { id: 'sallie', registry: entry, resources: [], fromTags: false },
        [],
        't'
      );
      expect(nothingVisible.openaiProjectId).toBeUndefined();
      const claimed = buildAgent(
        {
          id: 'sallie',
          registry: entry,
          resources: [resource({ resourceGroup: 'ka-agents', tenantId: 't' })],
          fromTags: false,
        },
        [],
        't'
      );
      expect(claimed.openaiProjectId).toBe('proj_registry');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('skips malformed values, and refuses to guess when resources disagree', () => {
    const laterValid = groupResources(
      [
        resource({ name: 'a', tags: { agent: 'poppie', 'agent-openai-project': 'oops' } }),
        resource({ name: 'b', tags: { agent: 'poppie', 'agent-openai-project': 'proj_good1' } }),
      ],
      [],
      ['agent']
    );
    expect(buildAgent(laterValid[0], [], 't').openaiProjectId).toBe('proj_good1');
    const disagree = groupResources(
      [
        resource({ name: 'a', tags: { agent: 'poppie', 'agent-openai-project': 'proj_one' } }),
        resource({ name: 'b', tags: { agent: 'poppie', 'agent-openai-project': 'proj_two' } }),
      ],
      [],
      ['agent']
    );
    expect(buildAgent(disagree[0], [], 't').openaiProjectId).toBeUndefined();
    // a malformed registry override is ignored too
    expect(
      providerId(
        'proj_',
        [resource({ tags: { 'agent-openai-project': 'proj_tagged' } })],
        'agent-openai-project',
        OPENAI_PROJECT_ID
      )
    ).toBe('proj_tagged');
  });
});

describe('teamsCallUrl', () => {
  it('calls the agent account by UPN and nothing else', () => {
    expect(teamsCallUrl({ id: 'sallie', name: 'Sallie', teamsUpn: 'sallie@example.com' }, [])).toBe(
      'https://teams.microsoft.com/l/call/0/0?users=sallie%40example.com&withVideo=true'
    );
    const tagged = resource({ tags: { agent: 'sallie', 'agent-teams-upn': 'sallie@example.com' } });
    expect(teamsCallUrl(undefined, [tagged])).toBe(
      'https://teams.microsoft.com/l/call/0/0?users=sallie%40example.com&withVideo=true'
    );
    expect(teamsCallUrl({ id: 'winnie', name: 'Winnie' }, [])).toBeUndefined();
    expect(teamsCallUrl(undefined, [])).toBeUndefined();
  });

  it('never offers a call link for a bot, even one with a UPN', () => {
    const bot = resource({ type: 'microsoft.botservice/botservices', botAppId: 'abc' });
    expect(
      teamsCallUrl({ id: 'winnie', name: 'Winnie', teamsUpn: 'winnie@example.com' }, [bot])
    ).toBeUndefined();
    expect(
      teamsCallUrl(undefined, [
        resource({ type: 'microsoft.botservice/botservices', botAppId: 'abc' }),
        resource({ tags: { 'agent-teams-upn': 'winnie@example.com' } }),
      ])
    ).toBeUndefined();
  });
});

describe('teamsChatUrl', () => {
  it('prefers the agent user account over a bot', () => {
    expect(
      teamsChatUrl({ id: 'sallie', name: 'Sallie', teamsUpn: 'sallie@example.com' }, [
        resource({ type: 'microsoft.botservice/botservices', botAppId: 'abc' }),
      ])
    ).toBe('https://teams.microsoft.com/l/chat/0/0?users=sallie%40example.com');
  });
  it('addresses bots by their Microsoft App ID', () => {
    expect(
      teamsChatUrl(undefined, [
        resource({ type: 'microsoft.botservice/botservices', botAppId: 'abc' }),
      ])
    ).toBe('https://teams.microsoft.com/l/chat/0/0?users=28:abc');
  });
  it('returns nothing when the agent cannot be reached in Teams', () => {
    expect(teamsChatUrl(undefined, [resource({})])).toBeUndefined();
  });
});

describe('url guards', () => {
  it('accepts https only for portal URLs', () => {
    expect(safeHttpsUrl('https://sallie.knowall.ai')).toBe('https://sallie.knowall.ai/');
    expect(safeHttpsUrl('http://169.254.169.254/metadata')).toBeUndefined();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpsUrl('not a url')).toBeUndefined();
  });
  it('accepts local paths or https for avatars', () => {
    expect(safeAvatarUrl('/agents/sallie.png')).toBe('/agents/sallie.png');
    expect(safeAvatarUrl('/../etc/passwd')).toBeUndefined();
    expect(safeAvatarUrl('data:image/png;base64,AAAA')).toBeUndefined();
  });
  it('drops malformed repo slugs from tags', () => {
    const buckets = groupResources(
      [resource({ tags: { agent: 'evil', 'agent-repo': '../../rate_limit' } })],
      [],
      ['agent']
    );
    expect(buildAgent(buckets[0], [], 'tenant-a').repo).toBeUndefined();
  });
});
