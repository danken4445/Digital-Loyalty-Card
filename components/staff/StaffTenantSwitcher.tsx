'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type StaffMembership,
  type StaffSwitchTenantRequest,
  type StaffSwitchTenantResponse,
} from '@/lib/contracts';

export interface StaffTenantSwitcherProps {
  memberships: StaffMembership[];
  activeTenantId: string;
}

/**
 * Lets a staff member who works at several shops pick the active one. The server re-verifies the
 * choice against their memberships and stores it in an HttpOnly cookie; the page then refreshes.
 */
export function StaffTenantSwitcher({ memberships, activeTenantId }: StaffTenantSwitcherProps) {
  const router = useRouter();
  const selectId = useId();
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(tenantId: string) {
    if (tenantId === activeTenantId) return;
    setIsSwitching(true);
    setError(null);
    try {
      const body: StaffSwitchTenantRequest = { tenantId };
      const res = await fetch(ROUTES.api.staff.tenant, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ApiResponse<StaffSwitchTenantResponse>;
      if (!res.ok || !json.ok) {
        setError('Could not switch shop.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not switch shop.');
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={selectId} className="text-plug-muted">
        Shop
      </label>
      <select
        id={selectId}
        value={activeTenantId}
        disabled={isSwitching}
        aria-busy={isSwitching}
        onChange={(event) => void handleChange(event.target.value)}
        className="min-h-11 max-w-40 rounded-xl border border-plug-border bg-plug-black px-2 text-sm text-white disabled:opacity-50"
      >
        {memberships.map((membership) => (
          <option key={membership.tenantId} value={membership.tenantId}>
            {membership.tenantName}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}
