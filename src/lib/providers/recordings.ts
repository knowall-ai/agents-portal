// Recordings: Teams-native call recordings the agent started, indexed and
// served by the Presence bridge on its VM (agent-presence docs/RECORDINGS.md).
// The bridge holds the agent's identity and resolves the Teams media; the
// portal only relays, with a server-held bearer token for the bridge.
import { isValidBrainUrl } from '@/lib/providers/reverie';
import {
  isValidRecordingId,
  parseRecordingDetail,
  parseRecordingList,
  parseRecordingsStatus,
} from '@/lib/recordings';
import type { Recording, RecordingDetail, RecordingsStatus } from '@/types';

/** Same rule as the brain URL: https, host and path only, since the token is sent there. */
export const isValidRecordingsUrl = isValidBrainUrl;

const TIMEOUT_MS = 20_000;
/** The list endpoint's cap, and what one page of the tab shows. */
export const RECORDINGS_PAGE = 50;

function headers(token: string, accept = 'application/json'): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: accept };
}

/**
 * `baseUrl` is the recordings endpoint itself (`https://<agent>/recordings`),
 * so every path here is relative to it: `` (the list), `/status`, `/{id}`…
 */
function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function getJson(baseUrl: string, token: string, path: string): Promise<unknown> {
  const response = await bridgeFetch(endpoint(baseUrl, path), {
    headers: headers(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // the token goes to the validated URL only: never follow it somewhere else
    redirect: 'error',
  });
  if (response.status === 404 && !path.startsWith('/'))
    throw new Error(
      'The bridge answered 404 for /recordings: it is not running a version with call recording yet'
    );
  if (!response.ok) throw new Error(`Recordings ${response.status} ${path.split('?')[0] || '/'}`);
  return response.json();
}

/**
 * `fetch` reports every network-level failure as "fetch failed" with the real
 * reason in `cause`. Surface that reason, since the tab shows it: a refused
 * redirect means the reverse proxy is not routing to the bridge yet, which is
 * a different fix from a VM that is down.
 */
async function bridgeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
    const reason = cause?.message ?? (error instanceof Error ? error.message : String(error));
    if (/redirect/i.test(reason))
      throw new Error(
        'Recordings endpoint redirected instead of answering (the reverse proxy is not routing /recordings to the bridge yet)'
      );
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new Error('Recordings endpoint did not answer within 20 s');
    throw new Error(`Recordings endpoint unreachable: ${reason}`);
  }
}

export interface ListOptions {
  limit?: number;
  /** Page cursor: list recordings older than this id */
  before?: string;
}

/** `GET /recordings`: newest first. */
export async function listRecordings(
  baseUrl: string,
  token: string,
  agentId: string,
  options: ListOptions = {}
): Promise<Recording[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? RECORDINGS_PAGE) });
  if (options.before) {
    if (!isValidRecordingId(options.before)) throw new Error('Invalid recording id');
    query.set('before', options.before);
  }
  return parseRecordingList(await getJson(baseUrl, token, `?${query}`), agentId);
}

/** `GET /recordings/status`: is the agent recording right now. */
export async function getRecordingsStatus(
  baseUrl: string,
  token: string
): Promise<RecordingsStatus> {
  const body = await getJson(baseUrl, token, '/status');
  return parseRecordingsStatus(body, new Date().toISOString());
}

/** `GET /recordings/{id}`: the recording with its per-turn transcript, or null for an unknown id. */
export async function getRecording(
  baseUrl: string,
  token: string,
  agentId: string,
  id: string
): Promise<RecordingDetail | null> {
  if (!isValidRecordingId(id)) throw new Error('Invalid recording id');
  try {
    return parseRecordingDetail(await getJson(baseUrl, token, `/${id}`), agentId);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Recordings 404 ')) return null;
    throw error;
  }
}

export type VideoLocation =
  | { kind: 'redirect'; url: string }
  | { kind: 'not-ready'; status: string }
  | { kind: 'missing' };

/**
 * `GET /recordings/{id}/video`: the bridge answers 302 to Teams' short-lived,
 * pre-authenticated download URL (the bytes never pass through it or us), or
 * 409 while the recording is still being produced. Only an https location is
 * handed on to the browser.
 */
export async function resolveVideo(
  baseUrl: string,
  token: string,
  id: string
): Promise<VideoLocation> {
  if (!isValidRecordingId(id)) throw new Error('Invalid recording id');
  const response = await bridgeFetch(endpoint(baseUrl, `/${id}/video`), {
    headers: headers(token, '*/*'),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'manual',
  });
  if (response.status === 404) return { kind: 'missing' };
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as { status?: unknown };
    return {
      kind: 'not-ready',
      status: typeof body.status === 'string' ? body.status : 'processing',
    };
  }
  const location = response.headers.get('location');
  if (
    (response.status === 302 || response.status === 307) &&
    location &&
    /^https:\/\//i.test(location)
  ) {
    return { kind: 'redirect', url: location };
  }
  throw new Error(`Recordings ${response.status} /{id}/video`);
}

/** `GET /recordings/{id}/transcript.vtt`: Teams' own transcript, or null when there is none. */
export async function getTranscriptVtt(
  baseUrl: string,
  token: string,
  id: string
): Promise<string | null> {
  if (!isValidRecordingId(id)) throw new Error('Invalid recording id');
  const response = await bridgeFetch(endpoint(baseUrl, `/${id}/transcript.vtt`), {
    headers: headers(token, 'text/vtt'),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Recordings ${response.status} /{id}/transcript.vtt`);
  return response.text();
}
