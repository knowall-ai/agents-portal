import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRepoCommits, parseSkillFrontmatter } from './github';

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
