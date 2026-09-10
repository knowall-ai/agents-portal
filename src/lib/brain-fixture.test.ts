import { describe, expect, it } from 'vitest';
import type { BrainNode, BrainRel } from '@/types';
import { MAX_EXTRAS, MAX_EXTRA_RELS, fixtureSnapshot, fixtureTick } from './brain-fixture';

/** Applies a diff the way BrainView does, so the test sees what a live tab sees. */
function client(nodes: BrainNode[], rels: BrainRel[]) {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  const links = new Map(rels.map((r) => [r.id, { ...r }]));
  return {
    byId,
    links,
    apply(diff: {
      nodesAdded?: BrainNode[];
      nodesRemoved?: string[];
      relsAdded?: BrainRel[];
      relsRemoved?: string[];
    }) {
      for (const id of diff.nodesRemoved ?? []) {
        byId.delete(id);
        // BrainView drops every edge that touched it, listed or not
        for (const [rid, r] of links) if (r.source === id || r.target === id) links.delete(rid);
      }
      for (const rid of diff.relsRemoved ?? []) links.delete(rid);
      for (const n of diff.nodesAdded ?? []) byId.set(n.id, { ...n });
      for (const r of diff.relsAdded ?? []) links.set(r.id, { ...r });
    },
  };
}

describe('fixtureTick', () => {
  it('keeps a long-running demo graph bounded, consistent and in step with the client', () => {
    const before = fixtureSnapshot();
    const view = client(before.nodes, before.rels);
    let removedNodes = 0;
    let removedRels = 0;

    for (let i = 0; i < 5000; i++) {
      const { diff } = fixtureTick();
      if (!diff) continue;
      removedNodes += diff.nodesRemoved.length;
      removedRels += diff.relsRemoved.length;
      view.apply(diff);
    }
    const after = fixtureSnapshot();

    // a demo tab left open for hours must not silt up with invented nodes/edges
    expect(after.stats.nodeCount).toBeLessThanOrEqual(before.stats.nodeCount + MAX_EXTRAS);
    // the invented edges, plus the one anchor edge each live invented node holds
    expect(after.stats.relCount).toBeLessThanOrEqual(
      before.stats.relCount + MAX_EXTRA_RELS + MAX_EXTRAS
    );

    // forgetting must be announced, not just done server-side, or an open tab
    // would keep drawing nodes and edges the server has dropped
    expect(removedNodes).toBeGreaterThan(0);
    expect(removedRels).toBeGreaterThan(0);
    expect([...view.byId.keys()].sort()).toEqual(after.nodes.map((n) => n.id).sort());
    expect([...view.links.keys()].sort()).toEqual(after.rels.map((r) => r.id).sort());

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
