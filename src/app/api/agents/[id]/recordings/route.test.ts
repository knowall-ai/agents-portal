import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/admin-route', () => ({ adminAgentGate: vi.fn() }));
vi.mock('@/lib/agents/service', () => ({
  getRecordings: vi.fn(),
  getRecordingsStatus: vi.fn(),
  getRecording: vi.fn(),
  getRecordingVideo: vi.fn(),
  getRecordingTranscript: vi.fn(),
}));

import { adminAgentGate } from '@/lib/admin-route';
import {
  getRecording,
  getRecordingTranscript,
  getRecordingVideo,
  getRecordings,
  getRecordingsStatus,
} from '@/lib/agents/service';
import { GET as list } from './route';
import { GET as status } from './status/route';
import { GET as detail } from './[rid]/route';
import { GET as video } from './[rid]/video/route';
import { GET as transcript } from './[rid]/transcript/route';

const agent = { id: 'sallie', name: 'Sallie' };
const route = { params: Promise.resolve({ id: 'sallie' }) };
const withRid = (rid: string) => ({ params: Promise.resolve({ id: 'sallie', rid }) });
const request = (path: string) => new NextRequest(`http://localhost/api/agents/sallie${path}`);
const forbidden = new Response(null, { status: 403 });

describe('recordings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminAgentGate).mockResolvedValue({
      ok: true,
      ctx: {} as never,
      agent: agent as never,
    });
  });

  it('lists recordings for an admin with the page size, the cursor and the demo flag', async () => {
    vi.mocked(getRecordings).mockResolvedValue({ available: true, items: [] });
    const response = await list(request('/recordings?before=rec_0&demo=1'), route);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(getRecordings).toHaveBeenCalledWith(agent, { limit: 50, before: 'rec_0' }, true);
    expect(await response.json()).toEqual({ recordings: { available: true, items: [] } });
  });

  it('refuses a cursor that is not a recording id before touching the gate', async () => {
    const response = await list(request('/recordings?before=../x'), route);
    expect(response.status).toBe(400);
    expect(adminAgentGate).not.toHaveBeenCalled();
  });

  it('returns the gate response (viewer, unknown agent, no session) untouched', async () => {
    vi.mocked(adminAgentGate).mockResolvedValue({ ok: false, response: forbidden as never });
    for (const call of [
      () => list(request('/recordings'), route),
      () => status(request('/recordings/status'), route),
      () => detail(request('/recordings/rec_1'), withRid('rec_1')),
      () => video(request('/recordings/rec_1/video'), withRid('rec_1')),
      () => transcript(request('/recordings/rec_1/transcript'), withRid('rec_1')),
    ]) {
      expect((await call()).status).toBe(403);
    }
    expect(getRecordings).not.toHaveBeenCalled();
    expect(getRecording).not.toHaveBeenCalled();
    expect(getRecordingVideo).not.toHaveBeenCalled();
  });

  it('answers 502 when the bridge fails', async () => {
    vi.mocked(getRecordings).mockRejectedValue(new Error('Recordings 503 /recordings'));
    const response = await list(request('/recordings'), route);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ details: 'Recordings 503 /recordings' });
  });

  it('reports the recording status', async () => {
    vi.mocked(getRecordingsStatus).mockResolvedValue({ active: true, checkedAt: 'now' });
    const response = await status(request('/recordings/status'), route);
    expect(await response.json()).toEqual({ status: { active: true, checkedAt: 'now' } });
  });

  it('serves one recording, 404 for an unknown one and 400 for a bad id', async () => {
    vi.mocked(getRecording).mockResolvedValueOnce({ id: 'rec_1', turns: [] } as never);
    expect((await detail(request('/recordings/rec_1'), withRid('rec_1'))).status).toBe(200);
    vi.mocked(getRecording).mockResolvedValueOnce(null);
    expect((await detail(request('/recordings/rec_2'), withRid('rec_2'))).status).toBe(404);
    expect((await detail(request('/recordings/x'), withRid('a/b'))).status).toBe(400);
    expect(getRecording).toHaveBeenCalledTimes(2);
  });

  it('redirects to the video, 409 while processing, 404 when missing', async () => {
    vi.mocked(getRecordingVideo).mockResolvedValueOnce({
      kind: 'redirect',
      url: 'https://cdn.example/v.mp4',
    });
    const redirect = await video(request('/recordings/rec_1/video'), withRid('rec_1'));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('https://cdn.example/v.mp4');
    expect(redirect.headers.get('cache-control')).toContain('no-store');

    vi.mocked(getRecordingVideo).mockResolvedValueOnce({ kind: 'not-ready', status: 'processing' });
    const busy = await video(request('/recordings/rec_1/video'), withRid('rec_1'));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ status: 'processing' });

    vi.mocked(getRecordingVideo).mockResolvedValueOnce({ kind: 'missing' });
    expect((await video(request('/recordings/rec_1/video'), withRid('rec_1'))).status).toBe(404);
  });

  it('serves the VTT as a download, or 404 without one', async () => {
    vi.mocked(getRecordingTranscript).mockResolvedValueOnce('WEBVTT\n');
    const response = await transcript(request('/recordings/rec_1/transcript'), withRid('rec_1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/vtt');
    expect(response.headers.get('content-disposition')).toContain('rec_1.vtt');
    expect(await response.text()).toBe('WEBVTT\n');
    vi.mocked(getRecordingTranscript).mockResolvedValueOnce(null);
    expect(
      (await transcript(request('/recordings/rec_1/transcript'), withRid('rec_1'))).status
    ).toBe(404);
  });
});
