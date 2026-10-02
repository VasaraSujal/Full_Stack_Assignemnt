import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HealthResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  services: {
    app: 'healthy';
    database: 'connected' | 'disconnected';
  };
  error?: string;
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const timestamp = new Date().toISOString();

  try {
    // Perform lightweight database connectivity check
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: 'healthy',
        timestamp,
        services: {
          app: 'healthy',
          database: 'connected',
        },
      },
      { status: 200 }
    );
  } catch {
    // Return non-200 status without exposing internal error or credentials
    return NextResponse.json(
      {
        status: 'degraded',
        timestamp,
        services: {
          app: 'healthy',
          database: 'disconnected',
        },
        error: 'Database connectivity check failed',
      },
      { status: 503 }
    );
  }
}
