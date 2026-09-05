import { describe, expect, it } from 'vitest';
import { parseBoostOutput, parseBoostRequest } from './service';
import { findVm, parseRunCommandMessage } from '@/lib/providers/azure';
import type { AzureResource } from '@/types';

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
  });
});
