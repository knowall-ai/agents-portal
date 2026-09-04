// Reverie: the agent's graph memory, served read-only from its VM (`reverie serve`).
import type { BrainSnapshot } from '@/types';

const BRAIN_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/;

/** Only https, only a host and path: the server token is sent to this URL. */
export function isValidBrainUrl(url: string): boolean {
  return BRAIN_URL.test(url) && !url.includes('..');
}

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

/** Snapshot of the graph: nodes, relationships among them, totals and agent state. */
export async function fetchBrainSnapshot(
  baseUrl: string,
  token: string,
  limit = 400
): Promise<BrainSnapshot> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/brain/graph?limit=${limit}`, {
    headers: headers(token),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Reverie ${response.status} /brain/graph`);
  return response.json() as Promise<BrainSnapshot>;
}

/** Open the upstream Server-Sent Events stream; the caller pipes `body` to the browser. */
export async function openBrainEvents(
  baseUrl: string,
  token: string,
  limit = 400,
  signal?: AbortSignal
): Promise<Response> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/brain/events?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Reverie ${response.status} /brain/events`);
  return response;
}
