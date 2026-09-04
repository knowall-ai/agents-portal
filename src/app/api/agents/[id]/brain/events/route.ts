import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { brainSource, getAgent } from '@/lib/agents/service';
import { openBrainEvents } from '@/lib/providers/reverie';
import { fixtureHostStats, fixtureTick } from '@/lib/brain-fixture';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
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
  const source = brainSource(agent);
  if (!source) return NextResponse.json({ error: 'No brain configured' }, { status: 404 });

  if (source.kind === 'fixture') {
    const encoder = new TextEncoder();
    let closed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const stop = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        const send = (event: string, data: unknown) => {
          if (!closed) controller.enqueue(encoder.encode(line(event, data)));
        };
        send('state', {
          dreaming: false,
          lastActivityAt: Date.now() / 1000,
          ...fixtureHostStats(),
        });
        let n = 0;
        timer = setInterval(() => {
          n += 1;
          if (n % 2 === 0) {
            const { activation, diff } = fixtureTick();
            if (activation) send('activation', activation);
            if (diff) send('graph', diff);
          }
          send('state', { lastActivityAt: Date.now() / 1000, ...fixtureHostStats() });
        }, 1250);
        req.signal.addEventListener('abort', stop);
      },
      cancel() {
        // the consumer went away without the request aborting
        closed = true;
        clearInterval(timer);
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
