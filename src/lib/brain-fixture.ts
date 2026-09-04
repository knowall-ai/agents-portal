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
    if (!s || !t || s === t) return;
    if (rels.some((r) => r.source === s.id && r.target === t.id)) return;
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

  // A wider world so the picture has depth: generated people, organisations,
  // projects, concepts, meetings, decisions and risks, wired up plausibly.
  const FIRST = [
    'Aoife',
    'Cian',
    'Niamh',
    'Oisín',
    'Saoirse',
    'Fionn',
    'Róisín',
    'Darragh',
    'Emma',
    'Jack',
    'Grace',
    'Liam',
    'Hannah',
    'Noah',
    'Ava',
    'Ryan',
    'Ella',
    'Ollie',
    'Mia',
    'Sam',
  ];
  const LAST = [
    'Byrne',
    'Murphy',
    'Kelly',
    'Walsh',
    'Doyle',
    'Brennan',
    'Ryan',
    'Nolan',
    'Hughes',
    'Flynn',
    'Reid',
    'Clarke',
    'Moore',
    'Hayes',
    'Burke',
  ];
  const ORG_A = [
    'Northwind',
    'Shannon',
    'Liffey',
    'Atlantic',
    'Harbour',
    'Summit',
    'Beacon',
    'Kestrel',
    'Granite',
    'Willow',
    'Ardent',
    'Lumen',
    'Meridian',
    'Copper',
    'Tidal',
  ];
  const ORG_B = [
    'Logistics',
    'Health',
    'Foods',
    'Energy',
    'Capital',
    'Systems',
    'Retail',
    'Pharma',
    'Construction',
    'Media',
  ];
  const PROJ = [
    'Rollout',
    'Migration',
    'Pilot',
    'Renewal',
    'Assessment',
    'Automation',
    'Dashboard',
    'Integration',
    'Onboarding',
    'Audit',
    'Roadmap',
    'Discovery',
  ];
  const CONC = [
    'Data classification',
    'Retention policy',
    'Least privilege',
    'Blue-green deploy',
    'Feature flags',
    'On-call rota',
    'Incident review',
    'SLA credits',
    'Quarterly business review',
    'Renewal pricing',
    'Discovery workshop',
    'Pilot success criteria',
    'Change freeze',
    'Vendor lock-in',
    'Total cost of ownership',
    'Prompt injection',
    'Tool permissions',
    'Graph hygiene',
    'Zero trust',
    'Copilot licensing',
    'Data residency',
    'Change control',
    'Rate limits',
    'Token budget',
    'Lighthouse delegation',
    'Conditional access',
    'Backlog hygiene',
    'Definition of done',
    'Sprint cadence',
    'Stand-up etiquette',
    'Escalation path',
    'Runbook',
    'Observability',
    'Cost centre',
    'Procurement',
    'Renewal window',
  ];
  const MEET = [
    'Kick-off',
    'Weekly sync',
    'Steering',
    'Retro',
    'Demo',
    'Workshop',
    'Site visit',
    'Board update',
    'Vendor call',
    'QBR',
  ];
  const DEC = [
    'Go with Azure OpenAI',
    'Single rate card',
    'Ship read-only first',
    'Monthly billing',
    'Per-agent graph',
    'Pause the pilot',
    'Extend the trial',
  ];
  const RISK = [
    'Key person dependency',
    'Quota exhaustion',
    'Consent not granted',
    'Scope creep',
    'Data leak via tags',
    'Unpatched VM',
  ];
  const pickR = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const people: BrainNode[] = [];
  const orgs: BrainNode[] = [];
  const projects: BrainNode[] = [];
  const concepts: BrainNode[] = [];
  const add = (label: string, name: string, bucket: BrainNode[]) => {
    if (byName.has(name)) return byName.get(name) as BrainNode;
    const n = node(label, name, nodes.length);
    nodes.push(n);
    byName.set(name, n);
    bucket.push(n);
    return n;
  };
  for (let k = 0; k < 44; k++)
    add(
      'Organization',
      `${ORG_A[k % ORG_A.length]} ${ORG_B[(k * 7 + Math.floor(k / ORG_A.length)) % ORG_B.length]}`,
      orgs
    );
  for (let k = 0; k < 150; k++)
    add(
      'Person',
      `${FIRST[(k * 3 + Math.floor(k / 20)) % FIRST.length]} ${LAST[(k * 5 + 2 + Math.floor(k / 15)) % LAST.length]}`,
      people
    );
  for (let k = 0; k < 45; k++)
    add(
      'Project',
      `${ORG_A[(k * 4 + 1 + Math.floor(k / 15)) % ORG_A.length]} ${PROJ[(k + Math.floor(k / 12)) % PROJ.length]}`,
      projects
    );
  for (const c of CONC) add('Concept', c, concepts);
  const meetings = Array.from({ length: 36 }, (_, k) =>
    add('Meeting', `${MEET[k % MEET.length]} ${k + 1}`, [])
  );
  const decisions = Array.from({ length: 21 }, (_, k) =>
    add(
      'Decision',
      k < DEC.length ? DEC[k] : `${DEC[k % DEC.length]} (${Math.floor(k / DEC.length) + 1})`,
      []
    )
  );
  const risks = Array.from({ length: 18 }, (_, k) =>
    add(
      'Risk',
      k < RISK.length ? RISK[k] : `${RISK[k % RISK.length]} (${Math.floor(k / RISK.length) + 1})`,
      []
    )
  );
  const allOrgs = [...orgs, ...ORGS.map((o) => byName.get(o) as BrainNode)];
  for (const p of people) link(p.name, pickR(allOrgs).name, 'WORKS_AT');
  for (const pr of projects) {
    link(pickR(allOrgs).name, pr.name, 'OWNS');
    link(pickR(people).name, pr.name, 'DISCUSSED');
    link(pickR(people).name, pr.name, 'INTERESTED_IN');
    link(pr.name, pickR(concepts).name, 'DISCUSSED');
  }
  for (const m of meetings) {
    for (let k = 0; k < 3; k++) link(pickR(people).name, m.name, 'MET_WITH');
    link(m.name, pickR(projects).name, 'DISCUSSED');
    link(m.name, pickR(concepts).name, 'DISCUSSED');
  }
  for (const d of decisions) {
    link(
      pickR([...people, 'Ben Weeks', 'Poppie'].map((x) => (typeof x === 'string' ? x : x.name))),
      d.name,
      'DECIDED'
    );
    link(d.name, pickR(concepts).name, 'DISCUSSED');
  }
  for (const r of risks) link(pickR(projects).name, r.name, 'BLOCKED_BY');
  for (let k = 0; k < 90; k++) link(pickR(people).name, pickR(people).name, 'INTRODUCED_BY');
  for (let k = 0; k < 50; k++) link(pickR(allOrgs).name, pickR(allOrgs).name, 'PARTNERS_WITH');
  for (let k = 0; k < 60; k++) link(pickR(people).name, pickR(concepts).name, 'INTERESTED_IN');
  for (let k = 0; k < 40; k++) link(pickR(people).name, pickR(meetings).name, 'MET_WITH');
  // A real contact to search for: the Irish FA's project sponsor for Winnie.
  // Facts as remembered from calls; the dog's name is not recorded yet.
  const thomas = add('Person', 'Thomas Fulton', people);
  thomas.props = {
    name: thomas.name,
    role: 'Project sponsor',
    lives: 'Belfast',
    hobby: 'Hill walking',
    pet: 'Frida (Shar-Pei)',
    studying: 'TU Dublin, Evolving Technologies',
  };
  add('Concept', 'Belfast', concepts);
  add('Concept', 'Hill walking', concepts);
  add('Concept', 'Frida the Shar-Pei', concepts);
  add('Concept', 'TU Dublin', concepts);
  link(thomas.name, 'Irish FA', 'WORKS_AT');
  link(thomas.name, 'Belfast', 'LIVES_IN');
  link(thomas.name, 'Hill walking', 'ENJOYS');
  link(thomas.name, 'Frida the Shar-Pei', 'HAS_PET');
  link(thomas.name, 'TU Dublin', 'STUDIES_AT');
  link(thomas.name, 'Ticketing assistant', 'SPONSORS');
  link(thomas.name, 'Ben Weeks', 'MET_WITH');
  add('Concept', 'Football', concepts);
  link(thomas.name, 'Football', 'ENJOYS');
  const norrie = add('Person', 'Norrie Clarke', people);
  norrie.props = { name: norrie.name, role: 'Head of Fan Experience' };
  link(norrie.name, 'Irish FA', 'WORKS_AT');
  link(thomas.name, norrie.name, 'COLLEAGUE_OF');
  const jordan = add('Person', 'Jordan Armstrong', people);
  jordan.props = { name: jordan.name, role: 'Account manager' };
  link(jordan.name, 'Eir Evo', 'WORKS_AT');
  link(thomas.name, jordan.name, 'WORKS_WITH');
  return { nodes, rels };
}

const graph = build();
let extra = 0;
let cpu = 23;

/** A CPU figure that wanders like a real box, with the odd spike. */
export function fixtureHostStats(): {
  cpuPercent: number;
  load1: number;
  memPercent: number;
  memUsedGb: number;
  memTotalGb: number;
} {
  const spike = rand() < 0.08 ? 25 + rand() * 40 : 0;
  cpu = Math.max(3, Math.min(97, cpu + (rand() - 0.5) * 12 + spike * 0.5 - (cpu > 60 ? 6 : 0)));
  const memTotalGb = 32;
  const memUsedGb = Math.round((19.6 + cpu / 40) * 10) / 10;
  return {
    cpuPercent: Math.round(cpu * 10) / 10,
    load1: Math.round((cpu / 25) * 100) / 100,
    memPercent: Math.round((memUsedGb / memTotalGb) * 1000) / 10,
    memUsedGb,
    memTotalGb,
  };
}

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
      ...fixtureHostStats(),
      usage: {
        mode: 'sub',
        sub: { pct_left: 63, reset_at: Math.floor(now) + 3 * 86400 + 5400 },
        api: { usd_mtd: 12.4 },
        budget: 100,
      },
      boost: { active: false },
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
