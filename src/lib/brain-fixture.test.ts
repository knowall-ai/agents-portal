import { describe, expect, it } from 'vitest';
import { fixtureSnapshot, fixtureTick } from './brain-fixture';

describe('fixtureTick', () => {
  it('keeps the demo graph bounded and consistent over a long run', () => {
    const before = fixtureSnapshot();
    for (let i = 0; i < 5000; i++) fixtureTick();
    const after = fixtureSnapshot();

    // a demo tab left open for hours must not silt up with invented nodes/edges
    expect(after.stats.nodeCount).toBeLessThanOrEqual(before.stats.nodeCount + 6);
    // 12 invented edges, plus the one anchor edge each of the 6 live nodes holds
    expect(after.stats.relCount).toBeLessThanOrEqual(before.stats.relCount + 18);

    // every curated node survives; only generated ones are forgotten
    for (const n of before.nodes) expect(after.nodes.some((x) => x.id === n.id)).toBe(true);

    // no dangling edges, and ids stay unique once the graph starts shrinking
    const ids = new Set(after.nodes.map((n) => n.id));
    for (const r of after.rels) {
      expect(ids.has(r.source)).toBe(true);
      expect(ids.has(r.target)).toBe(true);
    }
    expect(new Set(after.rels.map((r) => r.id)).size).toBe(after.rels.length);
    expect(new Set(after.nodes.map((n) => n.name)).size).toBe(after.nodes.length);
  });
});
