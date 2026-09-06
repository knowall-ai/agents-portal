// Pure filtering for the agent page's Skills tab: free-text search over name and
// description, plus a single-select filter by source label.
import type { Skill } from '@/types';

/** The "all sources" sentinel; also what an absent `source` filter means. */
export const ALL_SOURCES = 'all';

export interface SkillFilter {
  /** Free text matched case-insensitively anywhere in the name or description */
  q?: string;
  /** A `sourceLabel` to keep, or `all` / undefined for every source */
  source?: string;
}

/** One source chip: the label, how many skills carry it, and where it came from. */
export interface SourceCount {
  label: string;
  count: number;
  source: Skill['source'];
}

const normalise = (value: string): string => value.trim().toLowerCase();

/** True when the skill's name or description contains `q` (case-insensitive). */
export function matchesQuery(skill: Skill, q: string): boolean {
  const needle = normalise(q);
  if (!needle) return true;
  return (
    skill.name.toLowerCase().includes(needle) ||
    (skill.description ?? '').toLowerCase().includes(needle)
  );
}

/**
 * Skills matching both the text query and the source filter, in the order they
 * were given. An empty or missing query matches everything, as does a `source`
 * of `all`, an empty string or `undefined`; an unknown source matches nothing.
 */
export function filterSkills(skills: Skill[], filter: SkillFilter = {}): Skill[] {
  const q = filter.q ?? '';
  const source = filter.source ?? ALL_SOURCES;
  const bySource = source && source !== ALL_SOURCES ? source : null;
  return skills.filter(
    (skill) => (!bySource || skill.sourceLabel === bySource) && matchesQuery(skill, q)
  );
}

/**
 * How many skills each distinct `sourceLabel` holds, ordered for the chip row:
 * `primaryLabel` (the agent's own repo) first, then the remaining GitHub packs
 * in the order they first appear, then Foundry assistants.
 */
export function sourceCounts(skills: Skill[], primaryLabel?: string): SourceCount[] {
  const counts = new Map<string, SourceCount>();
  for (const skill of skills) {
    const existing = counts.get(skill.sourceLabel);
    if (existing) existing.count += 1;
    else
      counts.set(skill.sourceLabel, { label: skill.sourceLabel, count: 1, source: skill.source });
  }
  const rank = (entry: SourceCount): number => {
    if (primaryLabel && entry.label === primaryLabel) return 0;
    return entry.source === 'foundry' ? 2 : 1;
  };
  // Map preserves insertion order, so a stable sort by rank alone keeps packs
  // in the order they first appeared in the list.
  return [...counts.values()].sort((a, b) => rank(a) - rank(b));
}
