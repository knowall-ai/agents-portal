import { NextResponse } from 'next/server';

/** Liveness endpoint for App Service health checks and uptime monitors. */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
    timestamp: new Date().toISOString(),
  });
}
