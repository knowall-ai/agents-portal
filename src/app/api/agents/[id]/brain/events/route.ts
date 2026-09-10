import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { brainSource, getAgent } from '@/lib/agents/service';
import { openBrainEvents } from '@/lib/providers/reverie';
import { fixtureHostStats, subscribeFixture } from '@/lib/brain-fixture';
import { parseDemoQuery } from '@/lib/brain-query';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  // authenticated, per-user data: never stored by a shared cache
  'Cache-Control': 'no-store, private, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function line(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Server-Sent Events: activations, graph diffs and state, proxied from the agent's Reverie. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await getAgent(ctx, id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  const demo = parseDemoQuery(req.nextUrl.searchParams);
  if (demo === null) {
    return NextResponse.json(
      { error: 'Only demo=1 is accepted as a query parameter' },
      { status: 400 }
    );
  }
  const source = brainSource(agent, demo);
  if (!source) return NextResponse.json({ error: 'No brain configured' }, { status: 404 });

  if (source.kind === 'fixture') {
    const encoder = new TextEncoder();
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const stop = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(line(event, data)));
          } catch {
            // the consumer went away mid-write
            stop();
          }
        };
        send('state', {
          dreaming: false,
          lastActivityAt: Date.now() / 1000,
          ...fixtureHostStats(),
        });
        // every open stream shares one ticker over the one demo graph, so two
        // tabs see the same events instead of drifting apart. Skip it if that
        // first write already found the consumer gone: subscribing a dead
        // listener would keep the shared ticker running with nothing to feed.
        if (!closed) {
          unsubscribe = subscribeFixture(({ event, data }) => send(event, data));
        }
        req.signal.addEventListener('abort', stop);
      },
      cancel() {
        // the consumer went away without the request aborting
        closed = true;
        unsubscribe?.();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  try {
    const upstream = await openBrainEvents(source.url, source.token, 400, req.signal);
    return new Response(upstream.body, { headers: SSE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Brain stream unavailable', details: message },
      { status: 502 }
    );
  }
}
