import { NextResponse } from 'next/server';
import { SHOP_CONFIG } from '@/lib/config';
import type { ApiResponse, HealthCheckResponse } from '@/lib/contracts';

export async function GET(): Promise<NextResponse<ApiResponse<HealthCheckResponse>>> {
  let cleanup = {
    lastRunAt: null as string | null,
    stale: true,
  };

  try {
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('ops_cleanup_status');
    if (!error && data && typeof data === 'object') {
      const payload = data as { lastRunAt?: string | null; stale?: boolean };
      cleanup = {
        lastRunAt: payload.lastRunAt ?? null,
        stale: Boolean(payload.stale),
      };
    } else {
      cleanup = {
        lastRunAt: null,
        stale: true,
      };
    }
  } catch {
    cleanup = {
      lastRunAt: null,
      stale: true,
    };
  }

  const status: 'ok' | 'degraded' = cleanup.stale ? 'degraded' : 'ok';

  return NextResponse.json<ApiResponse<HealthCheckResponse>>(
    {
      ok: true,
      data: {
        status,
        service: SHOP_CONFIG.name,
        timestampIso: new Date().toISOString(),
        timezone: SHOP_CONFIG.timezone,
        cleanup,
      },
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  );
}
