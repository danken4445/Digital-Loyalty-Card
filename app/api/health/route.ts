import { NextResponse } from 'next/server';
import { SHOP_CONFIG } from '@/lib/config';
import type { ApiResponse, HealthCheckResponse } from '@/lib/contracts';

export async function GET(): Promise<NextResponse<ApiResponse<HealthCheckResponse>>> {
  return NextResponse.json<ApiResponse<HealthCheckResponse>>(
    {
      ok: true,
      data: {
        status: 'ok',
        service: SHOP_CONFIG.name,
        timestampIso: new Date().toISOString(),
        timezone: SHOP_CONFIG.timezone,
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
