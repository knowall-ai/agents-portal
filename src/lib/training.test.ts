import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumScenario, TrainingRun } from '@/types';
import {
  outstandingFor,
  parseCurriculum,
  parseTrainingRun,
  scenarioAppliesTo,
  sortRuns,
  summariseRun,
} from './training';

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, '__fixtures__', 'training', name), 'utf8');

const PASS_JSON = fixture('callquality-pass.json');
const FAIL_JSON = fixture('callquality-fail.json');
const CURRICULUM_YAML = fixture('curriculum.yaml');

/** A minimal run, so each test states only the fields it cares about. */
const run = (over: Partial<TrainingRun> = {}): TrainingRun => ({
  path: over.path ?? 'runs/sallie/run.json',
  breaches: [],
  limitations: [],
  changeRequests: [],
  questions: [],
  ...over,
});

const scenario = (over: Partial<CurriculumScenario> = {}): CurriculumScenario => ({
  id: 'smoke',
  agents: ['sallie'],
  cadence: 'weekly',
  ...over,
});

describe('parseTrainingRun', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('reads a published callquality run, snake_case and all', () => {
    const parsed = parseTrainingRun(PASS_JSON, 'runs/sallie/2026-09-01T09-15-00-smoke.json');
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      path: 'runs/sallie/2026-09-01T09-15-00-smoke.json',
      result: 'pass',
      agent: 'sallie',
      scenario: 'smoke',
      startedAt: '2026-09-01T09:15:00Z',
      mode: 'live',
      source: 'callquality',
      runId: '20260901-091500-smoke',
      operator: 'Ben (KnowAll)',
      job: 'callquality',
    });
    expect(parsed?.totals).toEqual({ checks_run: 4, actions_verified: 2 });
    expect(parsed?.git).toEqual({
      agentTraining: 'a1b2c3d',
      agentPresence: 'e4f5a6b',
      agentRepo: '9c8d7e6',
    });
    expect(parsed?.artefacts).toEqual({
      reportMd: 'reports/sallie/2026-09-01-smoke.md',
      recording: 'https://example.invalid/recordings/2026-09-01-smoke.mp4',
      transcript: 'transcripts/sallie/2026-09-01-smoke.txt',
    });
    expect(parsed?.limitations).toEqual(['Voiceprint check skipped: no enrolled sample']);
    expect(parsed?.questions).toHaveLength(4);
    expect(parsed?.questions[0]).toEqual({
      id: 'greeting',
      prompt: 'Does she greet by name?',
      status: 'pass',
      lag: 1.2,
    });
    expect(parsed?.questions[3].status).toBe('skipped');
    expect(parsed?.questions[3].lag).toBeUndefined();
  });

  it('summarises breaches and change requests published as objects', () => {
    const parsed = parseTrainingRun(FAIL_JSON, 'runs/sallie/lag.json');
    expect(parsed?.result).toBe('fail');
    expect(parsed?.breaches).toEqual([
      'Answer lag 11.7s exceeds the 4.0s threshold',
      'Agent talked over the caller twice',
    ]);
    expect(parsed?.changeRequests).toEqual(['Shorten the barge-in window']);
    expect(parsed?.artefacts).toEqual({ reportMd: 'reports/sallie/2026-08-24-lag-repro.md' });
    expect(parsed?.git).toEqual({
      agentTraining: 'f0e1d2c',
      agentPresence: undefined,
      agentRepo: undefined,
    });
  });

  it('takes an already-parsed object as well as text', () => {
    const parsed = parseTrainingRun(JSON.parse(PASS_JSON), 'runs/sallie/x.json');
    expect(parsed?.scenario).toBe('smoke');
  });

  it('skips a file that is not valid JSON, with a warning', () => {
    expect(parseTrainingRun('{ not json', 'runs/sallie/bad.json')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('runs/sallie/bad.json'));
  });

  it('skips JSON that is not an object', () => {
    expect(parseTrainingRun('[]', 'runs/sallie/array.json')).toBeNull();
    expect(parseTrainingRun(42, 'runs/sallie/num.json')).toBeNull();
    expect(parseTrainingRun(null, 'runs/sallie/null.json')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('tolerates an empty object, unknown fields and wrong types', () => {
    const parsed = parseTrainingRun(
      {
        result: 'PASS',
        started_at: '   ',
        totals: 'nope',
        breaches: 'nope',
        questions: { a: 1 },
        git: [],
        artefacts: 7,
        somethingNew: { deep: true },
      },
      'runs/sallie/odd.json'
    );
    expect(parsed).toEqual({
      path: 'runs/sallie/odd.json',
      result: 'pass',
      agent: undefined,
      scenario: undefined,
      startedAt: undefined,
      mode: undefined,
      source: undefined,
      runId: undefined,
      operator: undefined,
      job: undefined,
      totals: undefined,
      breaches: [],
      limitations: [],
      changeRequests: [],
      questions: [],
      git: undefined,
      artefacts: undefined,
    });
  });

  it('accepts camelCase aliases and drops an unusable result', () => {
    const parsed = parseTrainingRun(
      {
        result: 'inconclusive',
        startedAt: '2026-09-01T00:00:00Z',
        runId: 'r1',
        changeRequests: ['Tune the prompt'],
        git: { agentTraining: 'abc1234' },
        artefacts: { reportMd: 'reports/x.md' },
        totals: { checks_run: 2, bogus: 'x' },
      },
      'runs/sallie/camel.json'
    );
    expect(parsed?.result).toBeUndefined();
    expect(parsed?.startedAt).toBe('2026-09-01T00:00:00Z');
    expect(parsed?.runId).toBe('r1');
    expect(parsed?.changeRequests).toEqual(['Tune the prompt']);
    expect(parsed?.git?.agentTraining).toBe('abc1234');
    expect(parsed?.artefacts?.reportMd).toBe('reports/x.md');
    expect(parsed?.totals).toEqual({ checks_run: 2 });
  });

  it('reads a question status and lag from the top level when there is no check', () => {
    const parsed = parseTrainingRun(
      {
        questions: [
          { id: 'q1', question: 'Asked?', status: 'fail', lag: 5 },
          { id: 'q2', text: 'Answered?', status: 'weird' },
          'not an object',
          { check: { status: 'pass', lag: 0.5 } },
        ],
      },
      'runs/sallie/q.json'
    );
    expect(parsed?.questions).toEqual([
      { id: 'q1', prompt: 'Asked?', status: 'fail', lag: 5 },
      { id: 'q2', prompt: 'Answered?', status: undefined, lag: undefined },
      { id: undefined, prompt: undefined, status: 'pass', lag: 0.5 },
    ]);
  });

  it('drops totals, git and artefacts that are present but empty', () => {
    const parsed = parseTrainingRun(
      { totals: {}, git: {}, artefacts: {} },
      'runs/sallie/empty.json'
    );
    expect(parsed?.totals).toBeUndefined();
    expect(parsed?.git).toBeUndefined();
    expect(parsed?.artefacts).toBeUndefined();
  });

  it('renders an object breach from whichever text field it carries', () => {
    const parsed = parseTrainingRun(
      {
        breaches: [
          { detail: 'detail wins when there is no message' },
          { description: 'description' },
          { title: 'title' },
          { text: 'text' },
          { id: 'B-7' },
          { nothing: 'usable' },
          123,
        ],
      },
      'runs/sallie/b.json'
    );
    expect(parsed?.breaches).toEqual([
      'detail wins when there is no message',
      'description',
      'title',
      'text',
      'B-7',
    ]);
  });
});

describe('parseCurriculum', () => {
  it('reads the published curriculum.yaml, comments and quotes included', () => {
    expect(parseCurriculum(CURRICULUM_YAML)).toEqual([
      { id: 'smoke', title: 'Smoke test', agents: ['sallie', 'poppie'], cadence: 'weekly' },
      { id: 'lag-repro', title: 'Lag reproduction', agents: ['sallie'], cadence: 'monthly' },
      { id: 'induction-quiz', title: 'Induction quiz', agents: ['sallie'], cadence: 'once' },
      { id: 'meeting-prep', title: 'Meeting prep', agents: ['poppie'], cadence: 'on-change' },
    ]);
  });

  it('returns nothing for empty text or a file with no scenarios key', () => {
    expect(parseCurriculum('')).toEqual([]);
    expect(parseCurriculum('version: 1\nowner: KnowAll AI\n')).toEqual([]);
  });

  it('accepts sequence items at the same indent as the key', () => {
    expect(
      parseCurriculum(['scenarios:', '- id: smoke', '  cadence: weekly', ''].join('\n'))
    ).toEqual([{ id: 'smoke', title: undefined, agents: [], cadence: 'weekly' }]);
  });

  it('skips an item with no id and defaults an absent or unknown cadence to once', () => {
    const yaml = [
      'scenarios:',
      '  - title: No id here',
      '    cadence: weekly',
      '  - id: no-cadence',
      '  - id: odd-cadence',
      '    cadence: fortnightly',
    ].join('\n');
    expect(parseCurriculum(yaml)).toEqual([
      { id: 'no-cadence', title: undefined, agents: [], cadence: 'once' },
      { id: 'odd-cadence', title: undefined, agents: [], cadence: 'once' },
    ]);
  });

  it('handles an empty flow list, a bare item and keys on the following lines', () => {
    const yaml = ['scenarios:', '  -', '    id: smoke', '    agents: []'].join('\n');
    expect(parseCurriculum(yaml)).toEqual([
      { id: 'smoke', title: undefined, agents: [], cadence: 'once' },
    ]);
  });

  it('stops at the next top-level key and ignores lines it does not understand', () => {
    const yaml = [
      'scenarios:',
      '  - id: smoke',
      '    agents: [sallie]',
      '    a line with no colon',
      'defaults:',
      '  - id: ignored',
    ].join('\n');
    expect(parseCurriculum(yaml)).toEqual([
      { id: 'smoke', title: undefined, agents: ['sallie'], cadence: 'once' },
    ]);
  });

  it('leaves a # inside a quoted scalar alone', () => {
    const yaml = ['scenarios:', '  - id: smoke', '    title: "Sprint #4 smoke" # trailing'].join(
      '\n'
    );
    expect(parseCurriculum(yaml)[0].title).toBe('Sprint #4 smoke');
  });

  it('opens a block sequence declared on the item line itself', () => {
    const yaml = ['scenarios:', '  - agents:', '      - sallie', '    id: smoke'].join('\n');
    expect(parseCurriculum(yaml)).toEqual([
      { id: 'smoke', title: undefined, agents: ['sallie'], cadence: 'once' },
    ]);
  });

  it('ignores empty values, an unknown key and an agents value that is not a list', () => {
    const yaml = [
      'scenarios:',
      '  - id:',
      '    title:',
      '    cadence:',
      '    agents: sallie',
      '    owner: KnowAll AI',
      '  - id: real',
    ].join('\n');
    // the first item has no usable id, so only the second survives
    expect(parseCurriculum(yaml)).toEqual([
      { id: 'real', title: undefined, agents: [], cadence: 'once' },
    ]);
  });

  it('drops empty entries from a block sequence', () => {
    const yaml = ['scenarios:', '  - id: smoke', '    agents:', '      - sallie', '      -'].join(
      '\n'
    );
    expect(parseCurriculum(yaml)[0].agents).toEqual(['sallie']);
  });
});

describe('summariseRun', () => {
  it('counts checks, passes, failures and breaches from the questions', () => {
    const parsed = parseTrainingRun(FAIL_JSON, 'runs/sallie/lag.json') as TrainingRun;
    expect(summariseRun(parsed)).toEqual({ checksRun: 3, passed: 1, failed: 2, breaches: 2 });
  });

  it("prefers the harness's own checks_run total", () => {
    expect(
      summariseRun(run({ totals: { checks_run: 9 }, questions: [{ status: 'pass' }] }))
    ).toEqual({ checksRun: 9, passed: 1, failed: 0, breaches: 0 });
  });

  it('falls back to the number of questions, and copes with none', () => {
    expect(summariseRun(run())).toEqual({ checksRun: 0, passed: 0, failed: 0, breaches: 0 });
    expect(summariseRun(run({ questions: [{ status: 'skipped' }, { status: 'pass' }] }))).toEqual({
      checksRun: 2,
      passed: 1,
      failed: 0,
      breaches: 0,
    });
  });
});

describe('scenarioAppliesTo', () => {
  it('matches the agent id case-insensitively', () => {
    expect(scenarioAppliesTo(scenario({ agents: ['Sallie'] }), 'sallie')).toBe(true);
    expect(scenarioAppliesTo(scenario({ agents: ['poppie'] }), 'sallie')).toBe(false);
  });

  it('treats a scenario with no agents as required for every agent', () => {
    expect(scenarioAppliesTo(scenario({ agents: [] }), 'anyone')).toBe(true);
  });
});

describe('outstandingFor', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const at = (iso: string, over: Partial<TrainingRun> = {}): TrainingRun =>
    run({ path: `runs/sallie/${iso}.json`, scenario: 'smoke', startedAt: iso, ...over });

  it('reports a scenario that has never been run', () => {
    expect(outstandingFor('sallie', [], [scenario()], now)).toEqual([
      { scenario: scenario(), reason: 'never-run' },
    ]);
  });

  it('reports the most recent run failing, whatever came before it', () => {
    const runs = [
      at('2026-09-01T09:00:00Z', { result: 'pass' }),
      at('2026-09-03T09:00:00Z', { result: 'fail' }),
    ];
    expect(outstandingFor('sallie', runs, [scenario()], now)).toEqual([
      {
        scenario: scenario(),
        reason: 'last-failed',
        lastRunAt: '2026-09-03T09:00:00Z',
        lastPassAt: '2026-09-01T09:00:00Z',
      },
    ]);
  });

  it('is satisfied by a pass inside the weekly window', () => {
    const runs = [at('2026-08-30T09:00:00Z', { result: 'pass' })];
    expect(outstandingFor('sallie', runs, [scenario()], now)).toEqual([]);
  });

  it('reports a weekly pass that has aged out', () => {
    const runs = [at('2026-08-20T09:00:00Z', { result: 'pass' })];
    expect(outstandingFor('sallie', runs, [scenario()], now)).toEqual([
      {
        scenario: scenario(),
        reason: 'overdue',
        lastRunAt: '2026-08-20T09:00:00Z',
        lastPassAt: '2026-08-20T09:00:00Z',
      },
    ]);
  });

  it('gives a monthly scenario thirty days', () => {
    const monthly = scenario({ cadence: 'monthly' });
    expect(
      outstandingFor('sallie', [at('2026-08-20T09:00:00Z', { result: 'pass' })], [monthly], now)
    ).toEqual([]);
    expect(
      outstandingFor('sallie', [at('2026-07-20T09:00:00Z', { result: 'pass' })], [monthly], now)
    ).toHaveLength(1);
  });

  it('treats once and on-change as satisfied by any pass, however old', () => {
    const runs = [at('2024-01-01T09:00:00Z', { result: 'pass' })];
    expect(outstandingFor('sallie', runs, [scenario({ cadence: 'once' })], now)).toEqual([]);
    expect(outstandingFor('sallie', runs, [scenario({ cadence: 'on-change' })], now)).toEqual([]);
  });

  it('skips scenarios that are not required for this agent', () => {
    const others = [scenario({ id: 'meeting-prep', agents: ['poppie'] })];
    expect(outstandingFor('sallie', [], others, now)).toEqual([]);
  });

  it('matches runs to scenarios case-insensitively and ignores other scenarios', () => {
    const runs = [
      at('2026-09-03T09:00:00Z', { result: 'pass', scenario: 'SMOKE' }),
      at('2026-09-03T10:00:00Z', { result: 'fail', scenario: 'lag-repro' }),
    ];
    expect(outstandingFor('sallie', runs, [scenario()], now)).toEqual([]);
  });

  it('treats a run with no readable start time as the oldest', () => {
    const runs = [
      at('2026-09-03T09:00:00Z', { result: 'pass' }),
      run({ path: 'runs/sallie/undated.json', scenario: 'smoke', result: 'fail' }),
    ];
    expect(outstandingFor('sallie', runs, [scenario()], now)).toEqual([]);
  });

  it('defaults `now` to the current time', () => {
    const runs = [at(new Date().toISOString(), { result: 'pass' })];
    expect(outstandingFor('sallie', runs, [scenario()])).toEqual([]);
  });

  it('keeps curriculum order across several outstanding scenarios', () => {
    const curriculum = parseCurriculum(CURRICULUM_YAML);
    const outstanding = outstandingFor('sallie', [], curriculum, now);
    expect(outstanding.map((o) => o.scenario.id)).toEqual(['smoke', 'lag-repro', 'induction-quiz']);
  });
});

describe('sortRuns', () => {
  it('puts the newest run first and undated runs last, without mutating the input', () => {
    const runs = [
      run({ path: 'a', startedAt: '2026-08-01T00:00:00Z' }),
      run({ path: 'b' }),
      run({ path: 'c', startedAt: '2026-09-01T00:00:00Z' }),
      run({ path: 'd', startedAt: 'not a date' }),
    ];
    expect(sortRuns(runs).map((r) => r.path)).toEqual(['c', 'a', 'b', 'd']);
    expect(runs.map((r) => r.path)).toEqual(['a', 'b', 'c', 'd']);
  });
});
