// A built-in graph for developing and screenshotting the Brain view without an
// agent VM. Enabled with BRAIN_FIXTURE=1; it plays a slow stream of activations
// and the occasional new node so the picture moves.
import type { BrainActivation, BrainDiff, BrainNode, BrainRel, BrainSnapshot } from '@/types';

const PEOPLE = [
  'Matt Lacey',
  'Louise Byrne',
  'Ciarán Walsh',
  'Priya Nair',
  'Tom Hendry',
  'Sarah Quinn',
  'Dev Patel',
  'Aoife Kelly',
  'Ben Weeks',
  'Poppie',
];
const ORGS = ['Medite Smartply', 'Cairn Homes', 'Irish FA', 'Eir Evo', 'KnowAll AI', 'Glanua'];
const PROJECTS = ['CISP renewal', 'Ticketing assistant', 'Timesheets', 'Agents Portal', 'Reverie'];
const PRODUCTS = ['Presence', 'Thyme', 'ZapDesk'];
const CONCEPTS = [
  'Graph memory',
  'Dreaming',
  'Fast mode',
  'Azure Lighthouse',
  'Rule of Quarters',
  'Rate card',
];
const MEETINGS = ['Daily stand-up', 'Cairn discovery call', 'Eir account review', 'Sprint review'];
const DECISIONS = ['One rate card', 'Reverie per agent', 'Boost auto-revert'];
const RISKS = ['E3 seats exhausted', 'Codex quota'];

let seed = 7;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function node(label: string, name: string, i: number): BrainNode {
  const t = 1_756_000_000 + i * 3600;
  return {
    id: `${label.toLowerCase()}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    labels: [label],
    name,
    degree: 0,
    updatedAt: t,
    createdAt: t - 86400,
    props: { name, ...(label === 'Person' ? { role: ['CEO', 'CTO', 'PM', 'Ops'][i % 4] } : {}) },
  };
}

function build(): { nodes: BrainNode[]; rels: BrainRel[] } {
  const nodes: BrainNode[] = [];
  let i = 0;
  for (const n of PEOPLE) nodes.push(node('Person', n, i++));
  for (const n of ORGS) nodes.push(node('Organization', n, i++));
  for (const n of PROJECTS) nodes.push(node('Project', n, i++));
  for (const n of PRODUCTS) nodes.push(node('Product', n, i++));
  for (const n of CONCEPTS) nodes.push(node('Concept', n, i++));
  for (const n of MEETINGS) nodes.push(node('Meeting', n, i++));
  for (const n of DECISIONS) nodes.push(node('Decision', n, i++));
  for (const n of RISKS) nodes.push(node('Risk', n, i++));
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const rels: BrainRel[] = [];
  const link = (a: string, b: string, type: string) => {
    const s = byName.get(a);
    const t = byName.get(b);
    if (!s || !t) return;
    rels.push({ id: `r${rels.length}`, type, source: s.id, target: t.id, updatedAt: s.updatedAt });
    s.degree++;
    t.degree++;
  };
  link('Matt Lacey', 'Medite Smartply', 'WORKS_AT');
  link('Louise Byrne', 'Cairn Homes', 'WORKS_AT');
  link('Ciarán Walsh', 'Irish FA', 'WORKS_AT');
  link('Priya Nair', 'Eir Evo', 'WORKS_AT');
  link('Tom Hendry', 'Glanua', 'WORKS_AT');
  link('Sarah Quinn', 'Cairn Homes', 'WORKS_AT');
  link('Dev Patel', 'KnowAll AI', 'WORKS_AT');
  link('Aoife Kelly', 'Irish FA', 'WORKS_AT');
  link('Ben Weeks', 'KnowAll AI', 'WORKS_AT');
  link('Poppie', 'KnowAll AI', 'WORKS_AT');
  link('Matt Lacey', 'CISP renewal', 'DISCUSSED');
  link('Medite Smartply', 'CISP renewal', 'OWNS');
  link('Louise Byrne', 'Cairn discovery call', 'MET_WITH');
  link('Ben Weeks', 'Cairn discovery call', 'MET_WITH');
  link('Cairn discovery call', 'Reverie', 'DISCUSSED');
  link('Cairn discovery call', 'Presence', 'DISCUSSED');
  link('Ciarán Walsh', 'Ticketing assistant', 'INTERESTED_IN');
  link('Irish FA', 'Ticketing assistant', 'OWNS');
  link('Priya Nair', 'Eir account review', 'MET_WITH');
  link('Eir Evo', 'Rate card', 'DISCUSSED');
  link('One rate card', 'Rate card', 'DECIDED');
  link('Ben Weeks', 'One rate card', 'DECIDED');
  link('Ben Weeks', 'Reverie per agent', 'DECIDED');
  link('Reverie per agent', 'Reverie', 'DISCUSSED');
  link('Reverie', 'Graph memory', 'DISCUSSED');
  link('Reverie', 'Dreaming', 'DISCUSSED');
  link('Boost auto-revert', 'Fast mode', 'DECIDED');
  link('Agents Portal', 'Azure Lighthouse', 'DISCUSSED');
  link('Agents Portal', 'Boost auto-revert', 'DISCUSSED');
  link('Dev Patel', 'Timesheets', 'OWNS');
  link('Timesheets', 'Thyme', 'DISCUSSED');
  link('Poppie', 'Daily stand-up', 'MET_WITH');
  link('Daily stand-up', 'Rule of Quarters', 'DISCUSSED');
  link('Sprint review', 'Agents Portal', 'DISCUSSED');
  link('E3 seats exhausted', 'Poppie', 'BLOCKED_BY');
  link('Codex quota', 'Fast mode', 'BLOCKED_BY');
  link('Sarah Quinn', 'Louise Byrne', 'INTRODUCED_BY');
  link('Glanua', 'ZapDesk', 'INTERESTED_IN');
  link('Tom Hendry', 'ZapDesk', 'DISCUSSED');
  return { nodes, rels };
}

const graph = build();
let extra = 0;

function stats(): BrainSnapshot['stats'] {
  const labels: Record<string, number> = {};
  const relTypes: Record<string, number> = {};
  for (const n of graph.nodes) labels[n.label] = (labels[n.label] ?? 0) + 1;
  for (const r of graph.rels) relTypes[r.type] = (relTypes[r.type] ?? 0) + 1;
  return {
    nodeCount: graph.nodes.length,
    relCount: graph.rels.length,
    labels,
    relTypes,
    shown: graph.nodes.length,
  };
}

export function fixtureSnapshot(): BrainSnapshot {
  const now = Date.now() / 1000;
  return {
    nodes: graph.nodes.map((n) => ({ ...n })),
    rels: graph.rels.map((r) => ({ ...r })),
    stats: stats(),
    state: {
      dreaming: false,
      lastActivityAt: now - 40,
      lastDreamAt: now - 6 * 3600,
      lastDreamName: new Date((now - 6 * 3600) * 1000).toISOString().slice(0, 10),
      recentReads: 7,
      recentWrites: 2,
      eventsAvailable: true,
    },
    generatedAt: now,
  };
}

/** One synthetic activation: mostly recalls, sometimes a write, rarely a new node. */
export function fixtureTick(): { activation?: BrainActivation; diff?: BrainDiff } {
  const now = Date.now() / 1000;
  const roll = rand();
  const pick = () => graph.nodes[Math.floor(rand() * graph.nodes.length)];
  if (roll < 0.55) {
    const a = pick();
    const neighbours = graph.rels
      .filter((r) => r.source === a.id || r.target === a.id)
      .map((r) => (r.source === a.id ? r.target : r.source))
      .slice(0, 2);
    const ids = [a.id, ...neighbours];
    return {
      activation: {
        ts: now,
        kind: 'recall',
        terms: [a.name.toLowerCase()],
        ids,
        names: ids.map((id) => graph.nodes.find((n) => n.id === id)?.name ?? null),
      },
    };
  }
  if (roll < 0.8) {
    const a = pick();
    a.updatedAt = Math.floor(now);
    return {
      activation: { ts: now, kind: 'remember', id: a.id, label: a.label, name: a.name },
      diff: {
        nodesAdded: [],
        nodesUpdated: [{ ...a }],
        nodesRemoved: [],
        relsAdded: [],
        relsRemoved: [],
      },
    };
  }
  if (roll < 0.93) {
    const a = pick();
    const b = pick();
    if (a.id === b.id) return {};
    const rel: BrainRel = {
      id: `r${graph.rels.length}`,
      type: 'DISCUSSED',
      source: a.id,
      target: b.id,
      updatedAt: Math.floor(now),
    };
    graph.rels.push(rel);
    a.degree++;
    b.degree++;
    return {
      activation: { ts: now, kind: 'connect', names: [a.name, b.name], type: rel.type },
      diff: {
        nodesAdded: [],
        nodesUpdated: [{ ...a }, { ...b }],
        nodesRemoved: [],
        relsAdded: [rel],
        relsRemoved: [],
        stats: stats(),
      },
    };
  }
  extra += 1;
  const fresh = node('Concept', `New idea ${extra}`, graph.nodes.length + extra);
  fresh.updatedAt = Math.floor(now);
  const anchor = pick();
  const rel: BrainRel = {
    id: `r${graph.rels.length}`,
    type: 'DISCUSSED',
    source: anchor.id,
    target: fresh.id,
    updatedAt: Math.floor(now),
  };
  graph.nodes.push(fresh);
  graph.rels.push(rel);
  fresh.degree = 1;
  anchor.degree++;
  return {
    activation: { ts: now, kind: 'remember', id: fresh.id, label: fresh.label, name: fresh.name },
    diff: {
      nodesAdded: [{ ...fresh }],
      nodesUpdated: [{ ...anchor }],
      nodesRemoved: [],
      relsAdded: [rel],
      relsRemoved: [],
      stats: stats(),
    },
  };
}
