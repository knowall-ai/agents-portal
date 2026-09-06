import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRecording,
  getRecordingsStatus,
  getTranscriptVtt,
  isValidRecordingsUrl,
  listRecordings,
  resolveVideo,
} from './recordings';

const BASE = 'https://sallie.example/recordings';
const item = { id: 'rec_1', started_at: '2026-09-04T09:30:12Z', status: 'ready' };

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number, body: unknown = {}) => ({
  ok: code < 300,
  status: code,
  json: async () => body,
  headers: new Headers(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isValidRecordingsUrl', () => {
  it('is the brain URL rule', () => {
    expect(isValidRecordingsUrl('https://sallie.knowall.ai/recordings')).toBe(true);
    expect(isValidRecordingsUrl('http://sallie.knowall.ai/recordings')).toBe(false);
    expect(isValidRecordingsUrl('https://sallie.knowall.ai/../x')).toBe(false);
  });
});

describe('listRecordings', () => {
  it('sends the token to the base URL with the page size and cursor, never following redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ items: [item] }));
    vi.stubGlobal('fetch', fetchMock);
    const runs = await listRecordings(BASE, 'tok', 'sallie', { limit: 10, before: 'rec_0' });
    expect(runs.map((r) => r.id)).toEqual(['rec_1']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sallie.example/recordings?limit=10&before=rec_0');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.redirect).toBe('error');
  });

  it('refuses a cursor that is not a recording id', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(listRecordings(BASE, 'tok', 'sallie', { before: '../x' })).rejects.toThrow(
      'Invalid recording id'
    );
  });

  it('explains a refused redirect, a timeout and a connection failure', async () => {
    const failure = (cause: Error) => Object.assign(new TypeError('fetch failed'), { cause });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(failure(new Error('unexpected redirect')))
        .mockRejectedValueOnce(
          Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
        )
        .mockRejectedValueOnce(failure(new Error('getaddrinfo ENOTFOUND sallie.example')))
    );
    await expect(listRecordings(BASE, 'tok', 'sallie')).rejects.toThrow(
      'redirected instead of answering'
    );
    await expect(listRecordings(BASE, 'tok', 'sallie')).rejects.toThrow(
      'did not answer within 20 s'
    );
    await expect(listRecordings(BASE, 'tok', 'sallie')).rejects.toThrow(
      'unreachable: getaddrinfo ENOTFOUND sallie.example'
    );
  });

  it('reports a failing bridge by status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(503)));
    await expect(listRecordings(BASE, 'tok', 'sallie')).rejects.toThrow('Recordings 503 /');
  });
});

describe('getRecordingsStatus', () => {
  it('reads the status endpoint relative to the configured URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ active: true, id: 'rec_9' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getRecordingsStatus(`${BASE}/`, 'tok');
    expect(result.active).toBe(true);
    expect(result.id).toBe('rec_9');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sallie.example/recordings/status');
  });
});

describe('getRecording', () => {
  it('returns the detail with turns, or null for an unknown id', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ ...item, turns: [{ t: 1, text: 'hi' }] }))
        .mockResolvedValueOnce(status(404))
    );
    const detail = await getRecording(BASE, 'tok', 'sallie', 'rec_1');
    expect(detail?.turns).toEqual([{ t: 1, speaker: null, text: 'hi' }]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://sallie.example/recordings/rec_1');
    expect(await getRecording(BASE, 'tok', 'sallie', 'rec_2')).toBeNull();
  });

  it('refuses a bad id before calling out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRecording(BASE, 'tok', 'sallie', 'a/b')).rejects.toThrow(
      'Invalid recording id'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveVideo', () => {
  it('hands on an https redirect without following it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'https://cdn.example/video.mp4?sig=1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveVideo(BASE, 'tok', 'rec_1')).toEqual({
      kind: 'redirect',
      url: 'https://cdn.example/video.mp4?sig=1',
    });
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sallie.example/recordings/rec_1/video');
  });

  it('reports not-ready with the bridge status, missing for 404, and refuses non-https locations', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(status(409, { status: 'processing' }))
        .mockResolvedValueOnce(status(404))
        .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: 'http://x/y' }) })
    );
    expect(await resolveVideo(BASE, 'tok', 'rec_1')).toEqual({
      kind: 'not-ready',
      status: 'processing',
    });
    expect(await resolveVideo(BASE, 'tok', 'rec_1')).toEqual({ kind: 'missing' });
    await expect(resolveVideo(BASE, 'tok', 'rec_1')).rejects.toThrow('Recordings 302');
  });
});

describe('getTranscriptVtt', () => {
  it('returns the text, or null when there is none', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'WEBVTT\n' })
        .mockResolvedValueOnce(status(404))
    );
    expect(await getTranscriptVtt(BASE, 'tok', 'rec_1')).toBe('WEBVTT\n');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://sallie.example/recordings/rec_1/transcript.vtt'
    );
    expect(await getTranscriptVtt(BASE, 'tok', 'rec_1')).toBeNull();
  });
});
