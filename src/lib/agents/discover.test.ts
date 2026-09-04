import { describe, expect, it } from 'vitest';
import type { AgentRegistryEntry, AzureResource } from '@/types';
import {
  buildAgent,
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
  },
  { id: 'allie', name: 'Allie', customer: 'Cairn Homes', planned: true },
];

describe('groupResources', () => {
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

describe('teamsCallUrl', () => {
  it('calls the agent account by UPN and nothing else', () => {
    expect(teamsCallUrl({ id: 'sallie', name: 'Sallie', teamsUpn: 'sallie@example.com' })).toBe(
      'https://teams.microsoft.com/l/call/0/0?users=sallie%40example.com'
    );
    expect(teamsCallUrl({ id: 'winnie', name: 'Winnie' })).toBeUndefined();
    expect(teamsCallUrl(undefined)).toBeUndefined();
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
