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
    // the token goes to the validated URL only: never follow it somewhere else
    redirect: 'error',
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
  // Bound the connection phase only: once headers arrive the stream may live
  // for hours, so the timeout is cleared rather than applied to the whole fetch
  const connect = new AbortController();
  const timer = setTimeout(
    () => connect.abort(new Error('Reverie connect timeout')),
    CONNECT_TIMEOUT_MS
  );
  const onAbort = () => connect.abort(signal?.reason);
  // An already-aborted signal never fires the event, so honour it up front
  // rather than letting the fetch run on until the connect timeout
  if (signal?.aborted) connect.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  let streaming = false;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/brain/events?limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: connect.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`Reverie ${response.status} /brain/events`);
    streaming = true;
    return response;
  } finally {
    clearTimeout(timer);
    // Nothing was handed back, so there is nothing left for the caller's signal
    // to abort: drop the listener. On the streaming path it stays wired, since
    // that is what tears the upstream down when the browser goes away.
    if (!streaming) signal?.removeEventListener('abort', onAbort);
  }
}

/** How long Reverie gets to answer with headers before the stream request is dropped. */
export const CONNECT_TIMEOUT_MS = 15_000;
