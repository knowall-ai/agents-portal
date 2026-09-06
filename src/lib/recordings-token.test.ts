import { describe, expect, it } from 'vitest';
import { agentEnvKey, agentTokenFor } from './agent-token';
import { recordingsTokenFor } from './recordings-token';
import { reverieTokenFor } from './reverie-token';

describe('agentTokenFor', () => {
  it('prefers the per-agent setting and falls back to the shared one', () => {
    const env = { RECORDINGS_TOKEN: 'shared', RECORDINGS_TOKEN_SALLIE: 'own' };
    expect(recordingsTokenFor('sallie', env)).toBe('own');
    expect(recordingsTokenFor('poppie', env)).toBe('shared');
    expect(recordingsTokenFor('poppie', {})).toBeUndefined();
    expect(agentTokenFor('X', 'a', { X_A: '', X: 'shared' })).toBe('shared');
  });

  it('spells the agent id the way the setting name does', () => {
    expect(agentEnvKey('poppie-2.beta')).toBe('POPPIE_2_BETA');
    expect(reverieTokenFor('poppie-2', { REVERIE_TOKEN_POPPIE_2: 'r' })).toBe('r');
  });
});
