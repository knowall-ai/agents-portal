// A built-in graph for developing and screenshotting the Brain view without an
// agent VM. Enabled with BRAIN_FIXTURE=1; it plays a slow stream of activations
// and the occasional new node so the picture moves.
import type { BrainActivation, BrainDiff, BrainNode, BrainRel, BrainSnapshot } from '@/types';

// Demo data only. The named people and companies are well-known public figures
// and firms (or Microsoft's fictional Contoso) so the picture is recognisable in
// a video, and only public facts are attached to them; everything else is
// generated. Never put a customer, colleague or private contact in here: this
// ships in a public repo and in screenshots.
const PEOPLE = [
  'Satoshi Nakamoto',
  'Jack Dorsey',
  'Michael Saylor',
  'Satya Nadella',
  'Jensen Huang',
  'Sam Altman',
  'Hal Finney',
  'Ada Lovelace',
  'Bill Gates',
  'Clippy',
];
const ORGS = ['Contoso', 'Microsoft', 'Nvidia', 'OpenAI', 'Block', 'Strategy'];
const PROJECTS = [
  'Contoso rollout',
  'Lightning payments',
  'Copilot licensing',
  'GPU cluster',
  'Memory engine',
];
const PRODUCTS = ['Azure', 'Bitcoin', 'CUDA'];
const CONCEPTS = [
  'Graph memory',
  'Dreaming',
  'Fast mode',
  'Azure Lighthouse',
  'Proof of work',
  'Rate card',
];
const MEETINGS = [
  'Daily stand-up',
  'Contoso discovery call',
  'Microsoft account review',
  'Sprint review',
];
const DECISIONS = ['One rate card', 'Graph per agent', 'Turbo auto-revert'];
const RISKS = ['Seats exhausted', 'Model quota'];

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
  link('Satya Nadella', 'Microsoft', 'WORKS_AT');
  link('Bill Gates', 'Microsoft', 'WORKS_AT');
  link('Clippy', 'Microsoft', 'WORKS_AT');
  link('Jensen Huang', 'Nvidia', 'WORKS_AT');
  link('Sam Altman', 'OpenAI', 'WORKS_AT');
  link('Jack Dorsey', 'Block', 'WORKS_AT');
  link('Michael Saylor', 'Strategy', 'WORKS_AT');
  link('Satoshi Nakamoto', 'Bitcoin', 'CREATED');
  link('Hal Finney', 'Bitcoin', 'DISCUSSED');
  link('Ada Lovelace', 'Contoso', 'WORKS_AT');
  link('Contoso', 'Contoso rollout', 'OWNS');
  link('Ada Lovelace', 'Contoso rollout', 'DISCUSSED');
  link('Ada Lovelace', 'Contoso discovery call', 'MET_WITH');
  link('Clippy', 'Contoso discovery call', 'MET_WITH');
  link('Contoso discovery call', 'Memory engine', 'DISCUSSED');
  link('Contoso discovery call', 'Azure', 'DISCUSSED');
  link('Jack Dorsey', 'Lightning payments', 'INTERESTED_IN');
  link('Block', 'Lightning payments', 'OWNS');
  link('Michael Saylor', 'Bitcoin', 'INTERESTED_IN');
  link('Strategy', 'Bitcoin', 'OWNS');
  link('Satya Nadella', 'Microsoft account review', 'MET_WITH');
  link('Microsoft', 'Copilot licensing', 'OWNS');
  link('Microsoft', 'Rate card', 'DISCUSSED');
  link('One rate card', 'Rate card', 'DECIDED');
  link('Bill Gates', 'One rate card', 'DECIDED');
  link('Bill Gates', 'Graph per agent', 'DECIDED');
  link('Graph per agent', 'Memory engine', 'DISCUSSED');
  link('Memory engine', 'Graph memory', 'DISCUSSED');
  link('Memory engine', 'Dreaming', 'DISCUSSED');
  link('Turbo auto-revert', 'Fast mode', 'DECIDED');
  link('Contoso rollout', 'Azure Lighthouse', 'DISCUSSED');
  link('Contoso rollout', 'Turbo auto-revert', 'DISCUSSED');
  link('Jensen Huang', 'GPU cluster', 'OWNS');
  link('GPU cluster', 'CUDA', 'DISCUSSED');
  link('Nvidia', 'CUDA', 'OWNS');
  link('Clippy', 'Daily stand-up', 'MET_WITH');
  link('Daily stand-up', 'Proof of work', 'DISCUSSED');
  link('Sprint review', 'Contoso rollout', 'DISCUSSED');
  link('Seats exhausted', 'Copilot licensing', 'BLOCKED_BY');
  link('Model quota', 'Fast mode', 'BLOCKED_BY');
  link('Hal Finney', 'Satoshi Nakamoto', 'INTRODUCED_BY');
  link('OpenAI', 'Azure', 'INTERESTED_IN');
  link('Sam Altman', 'GPU cluster', 'DISCUSSED');

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
  // Recognisable companies and public figures, each tied only to a public fact
  const KNOWN_ORGS = [
    'Apple',
    'Google',
    'Amazon',
    'Meta',
    'Tesla',
    'SpaceX',
    'Coinbase',
    'Stripe',
    'Shopify',
    'Salesforce',
    'Oracle',
    'IBM',
    'Intel',
    'AMD',
    'Netflix',
    'Cloudflare',
    'GitHub',
    'Anthropic',
    'Fabrikam',
    'Tailwind Traders',
  ];
  const KNOWN_PEOPLE: [string, string, string][] = [
    ['Tim Cook', 'Apple', 'CEO'],
    ['Sundar Pichai', 'Google', 'CEO'],
    ['Jeff Bezos', 'Amazon', 'Founder'],
    ['Mark Zuckerberg', 'Meta', 'CEO'],
    ['Elon Musk', 'Tesla', 'CEO'],
    ['Brian Armstrong', 'Coinbase', 'CEO'],
    ['Patrick Collison', 'Stripe', 'CEO'],
    ['Tobi Lütke', 'Shopify', 'CEO'],
    ['Marc Benioff', 'Salesforce', 'CEO'],
    ['Larry Ellison', 'Oracle', 'Founder'],
    ['Lisa Su', 'AMD', 'CEO'],
    ['Matthew Prince', 'Cloudflare', 'CEO'],
    ['Linus Torvalds', 'Linux Foundation', 'Creator of Linux'],
    ['Grace Hopper', 'US Navy', 'Computer scientist'],
    ['Alan Turing', 'Bletchley Park', 'Mathematician'],
    ['Adam Back', 'Blockstream', 'CEO'],
    ['Nick Szabo', 'Bit gold', 'Cryptographer'],
    ['Vitalik Buterin', 'Ethereum Foundation', 'Co-founder'],
    ['Dario Amodei', 'Anthropic', 'CEO'],
    ['Guido van Rossum', 'Python Software Foundation', 'Creator of Python'],
  ];
  for (const o of KNOWN_ORGS) add('Organization', o, orgs);
  for (const [person, org, role] of KNOWN_PEOPLE) {
    const p = add('Person', person, people);
    p.props = { name: person, role };
    add('Organization', org, orgs);
    link(person, org, 'WORKS_AT');
  }
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
      pickR([...people, 'Bill Gates', 'Clippy'].map((x) => (typeof x === 'string' ? x : x.name))),
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
  // A well-connected figure to search for in demos, wired with public facts only
  const satoshi = byName.get('Satoshi Nakamoto') as BrainNode;
  satoshi.props = { name: satoshi.name, role: 'Creator of Bitcoin', location: 'Unknown' };
  add('Concept', 'Bitcoin whitepaper', concepts);
  add('Concept', 'Cryptography', concepts);
  add('Concept', 'Genesis block', concepts);
  link(satoshi.name, 'Bitcoin whitepaper', 'AUTHORED');
  link(satoshi.name, 'Proof of work', 'DISCUSSED');
  link(satoshi.name, 'Cryptography', 'INTERESTED_IN');
  link(satoshi.name, 'Genesis block', 'CREATED');
  link(satoshi.name, 'Hal Finney', 'WORKS_WITH');
  link('Jack Dorsey', satoshi.name, 'INTERESTED_IN');
  link('Michael Saylor', 'Bitcoin whitepaper', 'DISCUSSED');
  (byName.get('Jack Dorsey') as BrainNode).props = {
    name: 'Jack Dorsey',
    role: 'Co-founder, Block',
  };
  (byName.get('Michael Saylor') as BrainNode).props = {
    name: 'Michael Saylor',
    role: 'Executive chairman, Strategy',
  };
  (byName.get('Satya Nadella') as BrainNode).props = { name: 'Satya Nadella', role: 'CEO' };
  (byName.get('Jensen Huang') as BrainNode).props = { name: 'Jensen Huang', role: 'CEO' };
  (byName.get('Clippy') as BrainNode).props = { name: 'Clippy', role: 'Office assistant' };
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
