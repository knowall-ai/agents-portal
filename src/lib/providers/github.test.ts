import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCurriculum,
  listRepoCommits,
  listTrainingRuns,
  parseSkillFrontmatter,
  selectRunFiles,
} from './github';

function rawCommit(sha: string) {
  return {
    sha,
    html_url: `https://github.com/o/r/commit/${sha}`,
    commit: { message: 'msg', author: { name: 'A', date: '2026-01-01T00:00:00Z' } },
  };
}

describe('parseSkillFrontmatter', () => {
  it('reads plain and quoted values', () => {
    expect(parseSkillFrontmatter('---\nname: bug\ndescription: "Create bugs"\n---\n# x')).toEqual({
      name: 'bug',
      description: 'Create bugs',
    });
  });

  it('joins folded and literal block scalars', () => {
    const folded = parseSkillFrontmatter(
      '---\nname: app-video-capture\ndescription: >\n  Capture video of a mobile app\n  and extract frames.\n---\n'
    );
    expect(folded.description).toBe('Capture video of a mobile app and extract frames.');
    const literal = parseSkillFrontmatter(
      '---\ndescription: |\n  line one\n  line two\nname: x\n---\n'
    );
    expect(literal).toEqual({ description: 'line one\nline two', name: 'x' });
  });

  it('returns nothing without frontmatter', () => {
    expect(parseSkillFrontmatter('# just markdown')).toEqual({});
  });
});

describe('listRepoCommits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('warns and returns [] when the first page fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const events = await listRepoCommits('o/r', { id: 'a', name: 'A' });
    expect(events).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps commits from pages already fetched when a later page fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // per_page is capped at 100, so a limit above that forces a second page.
    const firstPage = Array.from({ length: 100 }, (_, i) => rawCommit(`c${i}`));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);
    const events = await listRepoCommits('o/r', { id: 'a', name: 'A' }, 150);
    expect(events).toHaveLength(100);
    expect(events.map((e) => e.id)).toEqual(firstPage.map((c) => `github:a:${c.sha}`));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/** A GitHub contents response for one file, base64 as the API returns it. */
function contentsFile(path: string, body: string) {
  return {
    name: path.split('/').pop(),
    path,
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(body, 'utf8').toString('base64'),
    html_url: `https://github.com/knowall-ai/agent-training/blob/main/${path}`,
  };
}

function listingEntry(path: string) {
  return { name: path.split('/').pop(), path, type: 'file' };
}

const runBody = (scenario: string, result: 'pass' | 'fail') =>
  JSON.stringify({ result, scenario, started_at: '2026-09-01T09:00:00Z' });

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const notFound = (path: string) => ({ ok: false, status: 404, url: path });

describe('listTrainingRuns', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists the directory newest first and reads each run', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/contents/runs/sallie?ref=runs%2Fsallie'))
        return ok([
          listingEntry('runs/sallie/2026-08-24T16-40-00-lag-repro.json'),
          listingEntry('runs/sallie/2026-09-01T09-15-00-smoke.json'),
          { name: 'README.md', path: 'runs/sallie/README.md', type: 'file' },
          { name: 'old', path: 'runs/sallie/old', type: 'dir' },
        ]);
      if (url.includes('2026-09-01'))
        return ok(
          contentsFile('runs/sallie/2026-09-01T09-15-00-smoke.json', runBody('smoke', 'pass'))
        );
      return ok(
        contentsFile('runs/sallie/2026-08-24T16-40-00-lag-repro.json', runBody('lag-repro', 'fail'))
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const runs = await listTrainingRuns('knowall-ai/agent-training', 'sallie');
    expect(runs.map((r) => r.scenario)).toEqual(['smoke', 'lag-repro']);
    expect(runs[0].url).toContain('2026-09-01');
    // the listing plus one fetch per JSON file — README.md and the directory are skipped
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // every read names the agent's runs branch
    for (const [url] of fetchMock.mock.calls) expect(url).toContain('?ref=runs%2Fsallie');
  });

  it('falls back to the default branch when the agent has no runs branch', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('?ref=')) return notFound(url);
      if (url.endsWith('/contents/runs/sallie'))
        return ok([listingEntry('runs/sallie/2026-09-01T09-15-00-smoke.json')]);
      return ok(
        contentsFile('runs/sallie/2026-09-01T09-15-00-smoke.json', runBody('smoke', 'pass'))
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const runs = await listTrainingRuns('knowall-ai/agent-training', 'sallie');
    expect(runs.map((r) => r.scenario)).toEqual(['smoke']);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/contents/runs/sallie?ref=runs%2Fsallie'),
      expect.stringMatching(/\/contents\/runs\/sallie$/),
      expect.stringMatching(/smoke\.json$/),
    ]);
  });

  it('treats a missing runs directory in a readable repo as no runs', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/repos/knowall-ai/agent-training')
        ? ok({ full_name: 'knowall-ai/agent-training' })
        : notFound(url)
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(listTrainingRuns('knowall-ai/agent-training', 'sallie')).resolves.toEqual([]);
    // the runs branch, then the default branch, then the repo itself
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a repo the token cannot read instead of pretending it is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound('/repos/knowall-ai/agent-training')));
    await expect(listTrainingRuns('knowall-ai/agent-training', 'sallie')).rejects.toThrow(
      'not found or not readable'
    );
  });

  it('keeps the latest file of each curriculum scenario past the newest-50 cap', async () => {
    const day = (n: number) => `2026-08-${String(n).padStart(2, '0')}T09-00-00`;
    const listing = [
      listingEntry(`runs/sallie/${day(1)}-induction-quiz.json`),
      ...Array.from({ length: 55 }, (_, i) =>
        listingEntry(`runs/sallie/${day(2)}-smoke-r${i}.json`)
      ),
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/contents/runs/sallie?ref=')) return ok(listing);
      const path = url.slice(url.indexOf('runs/'), url.indexOf('?'));
      const scenario = path.includes('induction') ? 'induction-quiz' : 'smoke';
      return ok(contentsFile(path, runBody(scenario, 'pass')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const runs = await listTrainingRuns('knowall-ai/agent-training', 'sallie', ['induction-quiz']);
    expect(runs).toHaveLength(51);
    expect(runs.filter((r) => r.scenario === 'induction-quiz')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(52);
  });

  it('propagates a failure that is not a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(listTrainingRuns('knowall-ai/agent-training', 'sallie')).rejects.toThrow(
      'GitHub 403'
    );
  });

  it('returns nothing when the path is a file rather than a directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ name: 'sallie', type: 'file' })));
    await expect(listTrainingRuns('knowall-ai/agent-training', 'sallie')).resolves.toEqual([]);
  });

  it('warns past a run that cannot be read, and skips one that is not a plain file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/contents/runs/sallie?ref=runs%2Fsallie'))
        return ok([
          listingEntry('runs/sallie/c.json'),
          listingEntry('runs/sallie/b.json'),
          listingEntry('runs/sallie/a.json'),
        ]);
      if (url.includes('c.json')) return { ok: false, status: 500 };
      if (url.includes('b.json'))
        return ok({ name: 'b.json', path: 'runs/sallie/b.json', type: 'submodule' });
      return ok(contentsFile('runs/sallie/a.json', runBody('smoke', 'pass')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const runs = await listTrainingRuns('knowall-ai/agent-training', 'sallie');
    expect(runs.map((r) => r.path)).toEqual(['runs/sallie/a.json']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses a bad repo slug or an agent id with path tricks', async () => {
    await expect(listTrainingRuns('not-a-slug', 'sallie')).rejects.toThrow('Invalid repo slug');
    await expect(listTrainingRuns('knowall-ai/agent-training', '../secrets')).rejects.toThrow(
      'Invalid agent id'
    );
  });
});

describe('getCurriculum', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses curriculum.yaml from the repo root', async () => {
    const yaml = 'scenarios:\n  - id: smoke\n    agents: [sallie]\n    cadence: weekly\n';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => contentsFile('curriculum.yaml', yaml) })
    );
    await expect(getCurriculum('knowall-ai/agent-training')).resolves.toEqual([
      { id: 'smoke', title: undefined, agents: ['sallie'], cadence: 'weekly' },
    ]);
  });

  it('reports a repo the token cannot read instead of an empty curriculum', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound('/repos/knowall-ai/agent-training')));
    await expect(getCurriculum('knowall-ai/agent-training')).rejects.toThrow(
      'not found or not readable'
    );
  });

  it('treats a readable repo with no curriculum as having none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/repos/knowall-ai/agent-training')
          ? ok({ full_name: 'knowall-ai/agent-training' })
          : notFound(url)
      )
    );
    await expect(getCurriculum('knowall-ai/agent-training')).resolves.toEqual([]);
  });

  it('returns nothing when the entry is a directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    await expect(getCurriculum('knowall-ai/agent-training')).resolves.toEqual([]);
  });

  it('propagates a failure that is not a 404, and refuses a bad slug', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getCurriculum('knowall-ai/agent-training')).rejects.toThrow('GitHub 500');
    await expect(getCurriculum('../../etc')).rejects.toThrow('Invalid repo slug');
  });
});

describe('selectRunFiles', () => {
  const f = (name: string) => ({ name });
  const files = [
    f('2026-09-03T10-00-00-smoke.json'),
    f('2026-09-02T10-00-00-smoke-abc123.json'),
    f('2026-09-01T10-00-00-lag-repro.json'),
    f('2026-08-01T10-00-00-lag.json'),
    f('2026-07-01T10-00-00-induction-quiz.json'),
    f('2026-06-01T10-00-00-induction-quiz.json'),
  ];

  it('takes the newest files then the latest of each kept scenario that was cut', () => {
    expect(
      selectRunFiles(files, 2, ['induction-quiz', 'lag', 'lag-repro', 'smoke']).map((x) => x.name)
    ).toEqual([
      '2026-09-03T10-00-00-smoke.json',
      '2026-09-02T10-00-00-smoke-abc123.json',
      '2026-09-01T10-00-00-lag-repro.json',
      '2026-08-01T10-00-00-lag.json',
      '2026-07-01T10-00-00-induction-quiz.json',
    ]);
  });

  it('attributes a file to the longest scenario id it matches', () => {
    // With both ids known, lag-repro's file is not a `lag` run with a run id
    expect(selectRunFiles(files, 1, ['lag', 'lag-repro']).map((x) => x.name)).toEqual([
      '2026-09-03T10-00-00-smoke.json',
      '2026-09-01T10-00-00-lag-repro.json',
      '2026-08-01T10-00-00-lag.json',
    ]);
    // With only `lag` known, the dash-suffixed name reads as a run id of it
    expect(selectRunFiles(files, 1, ['lag']).map((x) => x.name)).toEqual([
      '2026-09-03T10-00-00-smoke.json',
      '2026-09-01T10-00-00-lag-repro.json',
    ]);
  });

  it('ignores scenarios with no file and is case-insensitive', () => {
    expect(selectRunFiles(files, 1, ['nothing', 'SMOKE']).map((x) => x.name)).toEqual([
      '2026-09-03T10-00-00-smoke.json',
    ]);
  });
});
