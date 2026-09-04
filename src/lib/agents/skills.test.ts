import { describe, expect, it } from 'vitest';
import type { Skill } from '@/types';
import { mergeSkillSources, skillSourcesFor } from './skills';

const skill = (name: string, repo: string): Skill => ({
  id: `github:${repo}:${name}`,
  name,
  source: 'github',
  sourceLabel: repo,
});

describe('skillSourcesFor', () => {
  it('lists the agent repo first, then shared skill packs in registry order', () => {
    expect(
      skillSourcesFor({
        id: 'sallie',
        name: 'Sallie',
        repo: 'knowall-ai/sallie-openclaw',
        skillsPath: '.claude/skills',
        skillSources: [
          { repo: 'knowall-ai/claude-plugins', path: 'skills' },
          { repo: 'T-Minus-15/claude-plugins', path: 'skills' },
        ],
      })
    ).toEqual([
      { repo: 'knowall-ai/sallie-openclaw', path: '.claude/skills' },
      { repo: 'knowall-ai/claude-plugins', path: 'skills' },
      { repo: 'T-Minus-15/claude-plugins', path: 'skills' },
    ]);
  });

  it('skips the agent repo when it has no skillsPath', () => {
    expect(
      skillSourcesFor({
        id: 'x',
        name: 'X',
        repo: 'org/x',
        skillSources: [{ repo: 'org/plugins', path: 'skills' }],
      })
    ).toEqual([{ repo: 'org/plugins', path: 'skills' }]);
    expect(skillSourcesFor(undefined)).toEqual([]);
  });
});

describe('mergeSkillSources', () => {
  it('lets a local skill shadow a same-named plugin skill and sorts by name', () => {
    const local = [
      skill('epic', 'knowall-ai/sallie-openclaw'),
      skill('teams', 'knowall-ai/sallie-openclaw'),
    ];
    const plugin = [
      skill('Epic', 'T-Minus-15/claude-plugins'),
      skill('bug', 'T-Minus-15/claude-plugins'),
    ];
    const merged = mergeSkillSources([local, plugin]);
    expect(merged.map((s) => `${s.name}@${s.sourceLabel}`)).toEqual([
      'bug@T-Minus-15/claude-plugins',
      'epic@knowall-ai/sallie-openclaw',
      'teams@knowall-ai/sallie-openclaw',
    ]);
  });
});
