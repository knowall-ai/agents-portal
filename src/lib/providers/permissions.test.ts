import { describe, expect, it } from 'vitest';
import { buildAppPermissionItems, type ResourceServicePrincipal } from './graph';
import { shortenScope } from './azure';

const graph: ResourceServicePrincipal = {
  id: 'sp-graph',
  appId: '00000003-0000-0000-c000-000000000000',
  displayName: 'Microsoft Graph',
  oauth2PermissionScopes: [
    { id: 's1', value: 'Mail.ReadWrite', adminConsentDescription: 'Read and write mail.' },
    { id: 's2', value: 'Calendars.Read', adminConsentDescription: 'Read calendars.' },
  ],
  appRoles: [{ id: 'r1', value: 'User.Read.All', description: 'Read all users.' }],
};

describe('buildAppPermissionItems', () => {
  it('explains each requested permission and marks consent', () => {
    const items = buildAppPermissionItems(
      [
        {
          resourceAppId: graph.appId,
          resourceAccess: [
            { id: 's1', type: 'Scope' },
            { id: 's2', type: 'Scope' },
            { id: 'r1', type: 'Role' },
            { id: 'unknown', type: 'Scope' },
          ],
        },
      ],
      new Map([[graph.appId, graph]]),
      [{ resourceId: 'sp-graph', scope: 'Mail.ReadWrite User.Read' }],
      [{ resourceId: 'sp-graph', appRoleId: 'r1' }]
    );
    expect(items.map((i) => `${i.kind}:${i.name}:${i.granted}`)).toEqual([
      'application:User.Read.All:true',
      'delegated:Calendars.Read:false',
      'delegated:Mail.ReadWrite:true',
      'delegated:unknown:false',
    ]);
    expect(items.find((i) => i.name === 'Mail.ReadWrite')?.description).toBe(
      'Read and write mail.'
    );
    expect(items[0].resource).toBe('Microsoft Graph');
  });
});

describe('shortenScope', () => {
  it('shortens subscription, resource group and resource scopes', () => {
    expect(shortenScope('/subscriptions/a54d50b7-7824-47c2-a115-3cef52d0ab04')).toBe(
      'Subscription a54d50b7…'
    );
    expect(shortenScope('/subscriptions/x/resourceGroups/ka-agents')).toBe(
      'Resource group ka-agents'
    );
    expect(
      shortenScope(
        '/subscriptions/x/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv-winnie/secrets/sallie-bc-api-secret'
      )
    ).toBe('kv-winnie/sallie-bc-api-secret (Microsoft.KeyVault)');
  });
});
