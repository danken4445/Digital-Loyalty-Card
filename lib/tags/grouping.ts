import type { TagRow } from '@/lib/contracts';

export interface LocationSummary {
  id: string;
  name: string;
}

export function groupTagsByBranch<T extends TagRow & { location_id?: string | null }>(
  tags: T[],
  locations: LocationSummary[],
): Record<string, T[]> {
  const locationMap = new Map<string, string>();
  for (const loc of locations) {
    locationMap.set(loc.id, loc.name);
  }

  const grouped: Record<string, T[]> = {};

  for (const tag of tags) {
    const branchName = (tag.location_id && locationMap.get(tag.location_id)) || 'Unassigned / Brand';
    if (!grouped[branchName]) {
      grouped[branchName] = [];
    }
    grouped[branchName].push(tag);
  }

  return grouped;
}
