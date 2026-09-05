import { describe, expect, it } from 'vitest';
import { parseDemoQuery } from './brain-query';

const q = (s: string) => new URLSearchParams(s);

describe('parseDemoQuery', () => {
  it('accepts nothing or exactly demo=1', () => {
    expect(parseDemoQuery(q(''))).toBe(false);
    expect(parseDemoQuery(q('demo=1'))).toBe(true);
  });
  it('rejects other values, repeats and unknown keys', () => {
    expect(parseDemoQuery(q('demo=0'))).toBeNull();
    expect(parseDemoQuery(q('demo=true'))).toBeNull();
    expect(parseDemoQuery(q('demo=1&demo=1'))).toBeNull();
    expect(parseDemoQuery(q('demo=1&limit=5'))).toBeNull();
    expect(parseDemoQuery(q('x=1'))).toBeNull();
  });
});
