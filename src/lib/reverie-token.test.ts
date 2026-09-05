import { describe, expect, it } from 'vitest';
import { reverieTokenFor } from './reverie-token';

describe('reverieTokenFor', () => {
  it("prefers the agent's own token and falls back to the shared one", () => {
    const env = { REVERIE_TOKEN: 'shared', REVERIE_TOKEN_POPPIE: 'poppie-only' };
    expect(reverieTokenFor('poppie', env)).toBe('poppie-only');
    expect(reverieTokenFor('sallie', env)).toBe('shared');
    expect(reverieTokenFor('winnie-dev', { REVERIE_TOKEN_WINNIE_DEV: 'w' })).toBe('w');
    expect(reverieTokenFor('sallie', {})).toBeUndefined();
    expect(reverieTokenFor('sallie', { REVERIE_TOKEN_SALLIE: '', REVERIE_TOKEN: 'shared' })).toBe(
      'shared'
    );
  });
});
