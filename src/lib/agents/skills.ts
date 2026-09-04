// Pure helpers for combining an agent's skill sources.
import type { AgentRegistryEntry, Skill, SkillSource } from '@/types';

/**
 * Repos to list skills from, highest precedence first: the agent's own repo,
 * then any shared skill packs (`skillSources`) in registry order. This mirrors
 * how OpenClaw resolves skills — a local skill shadows a same-named plugin skill.
 */
export function skillSourcesFor(entry?: AgentRegistryEntry): SkillSource[] {
  const sources: SkillSource[] = [];
  if (entry?.repo && entry.skillsPath) sources.push({ repo: entry.repo, path: entry.skillsPath });
  for (const source of entry?.skillSources ?? []) sources.push(source);
  return sources;
}

/** Merge per-source skill lists: first occurrence of a name wins, result sorted by name. */
export function mergeSkillSources(lists: Skill[][]): Skill[] {
  const seen = new Set<string>();
  const merged: Skill[] = [];
  for (const list of lists) {
    for (const skill of list) {
      const key = skill.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(skill);
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}
