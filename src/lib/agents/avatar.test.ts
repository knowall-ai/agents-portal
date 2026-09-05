import { describe, expect, it } from 'vitest';
import { azureAvatarPath, isDefaultBotIcon } from './discover';
import type { AzureResource } from '@/types';

const resource = (type: string): AzureResource => ({
  id: `/subscriptions/s/resourceGroups/rg/providers/${type}/x`,
  name: 'x',
  type,
  location: 'uksouth',
  resourceGroup: 'rg',
  subscriptionId: 's',
  tenantId: 't',
  tags: {},
  state: 'running',
});

describe('isDefaultBotIcon', () => {
  it('treats the Bot Framework placeholder, nothing and junk as no icon', () => {
    expect(
      isDefaultBotIcon(
        'https://docs.botframework.com/static/devportal/client/images/bot-framework-default.png'
      )
    ).toBe(true);
    expect(isDefaultBotIcon(undefined)).toBe(true);
    expect(isDefaultBotIcon('not a url')).toBe(true);
  });
  it('keeps an icon the owner set', () => {
    expect(isDefaultBotIcon('https://example.blob.core.windows.net/icons/winnie.png')).toBe(false);
  });
});

describe('azureAvatarPath', () => {
  it('points at the avatar route when there is a bot or an account to read', () => {
    expect(azureAvatarPath('winnie-dev', [resource('microsoft.botservice/botservices')])).toBe(
      '/api/agents/winnie-dev/avatar'
    );
    expect(
      azureAvatarPath('sallie', [resource('microsoft.compute/virtualmachines')], 'sallie')
    ).toBe('/api/agents/sallie/avatar');
  });
  it('gives nothing when the agent has neither', () => {
    expect(azureAvatarPath('planned', [])).toBeUndefined();
    expect(
      azureAvatarPath('vm-only', [resource('microsoft.compute/virtualmachines')])
    ).toBeUndefined();
  });
});
