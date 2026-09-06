import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the VM round trip is faked; the rest of the Azure helpers stay real.
const runVmScript = vi.hoisted(() => vi.fn());
vi.mock('@/lib/providers/azure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/azure')>()),
  runVmScript,
}));

import { parseBoostOutput, parseBoostRequest, setBoost } from './service';
import { findVm, parseRunCommandMessage } from '@/lib/providers/azure';
import { getRegistryEntry as lookupRegistryEntry } from '@/lib/registry';
import type { UserContext } from '@/lib/tokens';
import type { AgentDetail, AzureResource } from '@/types';

describe('parseRunCommandMessage', () => {
  it('splits the Azure run-command message into stdout and stderr', () => {
    const { stdout, stderr } = parseRunCommandMessage(
      'Enable succeeded: \n[stdout]\n{"active":true}\n\n[stderr]\nwarning: x\n'
    );
    expect(stdout).toBe('{"active":true}');
    expect(stderr).toBe('warning: x');
  });
});

describe('parseBoostOutput', () => {
  it('takes the last JSON line and ignores chatter', () => {
    expect(
      parseBoostOutput(
        'reloading\n{"active":false}\n{"active":true,"hours":2,"model":"openai/gpt-5.6-sol"}'
      )
    ).toEqual({ active: true, hours: 2, model: 'openai/gpt-5.6-sol' });
    expect(() => parseBoostOutput('nothing here')).toThrow(/no JSON/);
  });
});

describe('findVm', () => {
  it('picks the first virtual machine', () => {
    const vm = {
      id: '1',
      name: 'ka-sallie-vm',
      type: 'microsoft.compute/virtualmachines',
      resourceGroup: 'ka-agents',
      subscriptionId: 'sub',
    } as unknown as AzureResource;
    const web = { ...vm, name: 'site', type: 'microsoft.web/sites' } as unknown as AzureResource;
    expect(findVm([web, vm])).toEqual({
      subscriptionId: 'sub',
      resourceGroup: 'ka-agents',
      name: 'ka-sallie-vm',
    });
    expect(findVm([web])).toBeUndefined();
  });
});

describe('parseBoostRequest', () => {
  it('accepts only the documented bodies', () => {
    expect(parseBoostRequest({ action: 'refresh' })).toEqual({ action: 'refresh' });
    expect(parseBoostRequest({ action: 'on' })).toEqual({ action: 'on' });
    expect(parseBoostRequest({ action: 'on', hours: 4 })).toEqual({ action: 'on', hours: 4 });
    expect(parseBoostRequest({ action: 'off' })).toEqual({ action: 'off' });
  });

  it('rejects malformed payloads rather than throwing on them', () => {
    expect(parseBoostRequest(null)).toBeNull();
    expect(parseBoostRequest(['on'])).toBeNull();
    expect(parseBoostRequest('on')).toBeNull();
    expect(parseBoostRequest({})).toBeNull();
    expect(parseBoostRequest({ action: 'reboot' })).toBeNull();
    expect(parseBoostRequest({ action: 'on', script: '/tmp/evil.sh' })).toBeNull();
    expect(parseBoostRequest({ action: 'refresh', hours: 2 })).toBeNull();
    expect(parseBoostRequest({ action: 'on', hours: '4' })).toBeNull();
    expect(parseBoostRequest({ action: 'on', hours: Number.NaN })).toBeNull();
    expect(parseBoostRequest({ action: 'on', hours: -1 })).toBeNull();
    expect(parseBoostRequest({ action: 'on', hours: 0 })).toBeNull();
    expect(parseBoostRequest({ action: 'on', hours: 0.3 })).toBeNull();
    expect(parseBoostRequest({ action: 'off', hours: 2 })).toBeNull();
    expect(parseBoostRequest({ action: 'on', hours: 0.5 })).toEqual({ action: 'on', hours: 0.5 });
  });
});

describe('setBoost', () => {
  const vm = {
    id: '1',
    name: 'ka-sallie-vm',
    type: 'microsoft.compute/virtualmachines',
    // the fixture VM must sit in the group and subscription the registry pins
    resourceGroup: lookupRegistryEntry('sallie')?.resourceGroups?.[0] ?? 'ka-sallie-prod',
    subscriptionId: lookupRegistryEntry('sallie')?.subscriptionIds?.[0] ?? 'sub',
    tenantId: 'tenant-1',
  } as unknown as AzureResource;
  // `sallie` is the registry entry with a boost script, so Boost is supported here
  const agent = { id: 'sallie', resources: [vm] } as unknown as AgentDetail;
  const ctx = { armToken: 'token' } as unknown as UserContext;

  beforeEach(() => {
    // The registry only applies to resources in its own tenant
    vi.stubEnv('AZURE_AD_TENANT_ID', 'tenant-1');
    runVmScript.mockReset();
    runVmScript.mockResolvedValue({ stdout: '{"active":true,"hours":0.5}', stderr: '' });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects hours that are not quarter hours or are out of range', async () => {
    const message = /Hours must be a multiple of 0\.25 between 0\.25 and 8/;
    await expect(setBoost(ctx, agent, true, 0)).rejects.toThrow(message);
    await expect(setBoost(ctx, agent, true, 0.3)).rejects.toThrow(message);
    await expect(setBoost(ctx, agent, true, 9)).rejects.toThrow(message);
    await expect(setBoost(ctx, agent, true, Number.NaN)).rejects.toThrow(message);
    expect(runVmScript).not.toHaveBeenCalled();
  });

  it('accepts quarter hours, including the 30-minute option the UI offers', async () => {
    await expect(setBoost(ctx, agent, true, 0.5)).resolves.toMatchObject({ active: true });
    await expect(setBoost(ctx, agent, true, 1.5)).resolves.toMatchObject({ active: true });
    expect(runVmScript.mock.calls.map((call) => call[2][0])).toEqual([
      expect.stringContaining('boost.sh on 0.5'),
      expect.stringContaining('boost.sh on 1.5'),
    ]);
  });
});
