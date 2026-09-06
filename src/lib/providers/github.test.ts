import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurriculum, listRepoCommits, listTrainingRuns, parseSkillFrontmatter } from './github';

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

describe('listTrainingRuns', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  const notFound = (path: string) => ({ ok: false, status: 404, url: path });

  it('lists the directory newest first and reads each run', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/contents/runs/sallie'))
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
  });

  it('treats a missing runs directory as no runs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound('/contents/runs/sallie')));
    await expect(listTrainingRuns('knowall-ai/agent-training', 'sallie')).resolves.toEqual([]);
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
      if (url.endsWith('/contents/runs/sallie'))
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

  it('treats a repo with no curriculum as having none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
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
