import 'server-only';

import { NextResponse } from 'next/server';
import type { ApiErrorCode, ApiResponse, ChoosePlanResponse } from '@/lib/contracts';

export const BILLING_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const FAILURES: Record<string, { status: number; error: ApiErrorCode; message: string }> = {
  unauthorized: {
    status: 403,
    error: 'forbidden',
    message: 'Only the shop owner can change the plan.',
  },
  'invalid-plan': { status: 400, error: 'invalid_input', message: 'That plan is not available.' },
  'not-found': { status: 404, error: 'invalid_input', message: 'Shop not found.' },
  'tenant-unavailable': { status: 409, error: 'forbidden', message: 'This shop is closed.' },
};

/** Maps the choose_billing_plan SQL result to the API response shared by the owner and platform routes. */
export function choosePlanResponse(
  rpcResult: unknown,
  rpcError: { message: string } | null,
): NextResponse<ApiResponse<ChoosePlanResponse>> {
  if (rpcResult === 'updated' || rpcResult === 'unchanged') {
    return NextResponse.json<ApiResponse<ChoosePlanResponse>>(
      { ok: true, data: { result: rpcResult } },
      { status: 200, headers: BILLING_NO_STORE_HEADERS },
    );
  }

  const failure = typeof rpcResult === 'string' ? FAILURES[rpcResult] : undefined;
  if (rpcError || !failure) {
    return NextResponse.json<ApiResponse<ChoosePlanResponse>>(
      { ok: false, error: 'internal_error', message: 'Could not change the plan.' },
      { status: 500, headers: BILLING_NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<ChoosePlanResponse>>(
    { ok: false, error: failure.error, message: failure.message },
    { status: failure.status, headers: BILLING_NO_STORE_HEADERS },
  );
}
