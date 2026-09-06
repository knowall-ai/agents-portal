import { describe, expect, it } from 'vitest';
import type { Skill } from '@/types';
import { ALL_SOURCES, filterSkills, matchesQuery, sourceCounts } from './skills-filter';

const skill = (name: string, sourceLabel: string, extra: Partial<Skill> = {}): Skill => ({
  id: `${sourceLabel}:${name}`,
  name,
  source: 'github',
  sourceLabel,
  ...extra,
});

const OWN = 'knowall-ai/sallie';
const PACK = 'knowall-ai/t-minus-15';

const skills: Skill[] = [
  skill('proposal', OWN, { description: 'Draft a branded client Proposal' }),
  skill('Business Central', OWN, { description: 'Query the ERP' }),
  skill('create-pr', PACK, { description: 'Open a pull request' }),
  skill('epic', PACK),
  skill('file_search', 'Assistant: Sallie', { source: 'foundry' }),
];

describe('matchesQuery', () => {
  it('matches the name anywhere, case-insensitively', () => {
    expect(matchesQuery(skills[0], 'PROPOSAL')).toBe(true);
    expect(matchesQuery(skills[1], 'central')).toBe(true);
    expect(matchesQuery(skills[2], 'e-p')).toBe(true);
    expect(matchesQuery(skills[0], 'invoice')).toBe(false);
  });

  it('matches the description too, and tolerates a missing one', () => {
    expect(matchesQuery(skills[2], 'pull request')).toBe(true);
    expect(matchesQuery(skills[3], 'pull request')).toBe(false);
  });

  it('treats an empty or whitespace query as matching everything', () => {
    expect(matchesQuery(skills[3], '')).toBe(true);
    expect(matchesQuery(skills[3], '   ')).toBe(true);
  });
});

describe('filterSkills', () => {
  it('returns everything with no filter', () => {
    expect(filterSkills(skills)).toHaveLength(5);
    expect(filterSkills(skills, {})).toHaveLength(5);
    expect(filterSkills(skills, { q: '', source: ALL_SOURCES })).toHaveLength(5);
  });

  it('filters by text over name and description', () => {
    expect(filterSkills(skills, { q: 'PRO' }).map((s) => s.name)).toEqual(['proposal']);
    // "request" only appears in create-pr's description
    expect(filterSkills(skills, { q: 'request' }).map((s) => s.name)).toEqual(['create-pr']);
  });

  it('filters by source label', () => {
    expect(filterSkills(skills, { source: PACK }).map((s) => s.name)).toEqual([
      'create-pr',
      'epic',
    ]);
    expect(filterSkills(skills, { source: 'Assistant: Sallie' })).toHaveLength(1);
    expect(filterSkills(skills, { source: 'nobody/nothing' })).toEqual([]);
  });

  it('combines text and source, preserving the given order', () => {
    expect(filterSkills(skills, { q: 'r', source: OWN }).map((s) => s.name)).toEqual([
      'proposal',
      'Business Central',
    ]);
    expect(filterSkills(skills, { q: 'erp', source: OWN }).map((s) => s.name)).toEqual([
      'Business Central',
    ]);
    expect(filterSkills(skills, { q: 'zzz', source: OWN })).toEqual([]);
  });
});

describe('sourceCounts', () => {
  it('counts each distinct source label', () => {
    expect(sourceCounts(skills)).toEqual([
      { label: OWN, count: 2, source: 'github' },
      { label: PACK, count: 2, source: 'github' },
      { label: 'Assistant: Sallie', count: 1, source: 'foundry' },
    ]);
  });

  it('puts the agent’s own repo first and Foundry last', () => {
    const shuffled = [skills[4], skills[2], skills[0]];
    expect(sourceCounts(shuffled, OWN).map((s) => s.label)).toEqual([
      OWN,
      PACK,
      'Assistant: Sallie',
    ]);
  });

  it('keeps pack order when the primary label is absent', () => {
    expect(sourceCounts(skills, 'not/here').map((s) => s.label)).toEqual([
      OWN,
      PACK,
      'Assistant: Sallie',
    ]);
  });

  it('is empty for no skills', () => {
    expect(sourceCounts([])).toEqual([]);
  });
});
