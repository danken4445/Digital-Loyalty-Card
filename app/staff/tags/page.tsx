import { redirect } from 'next/navigation';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES, TAG_MANAGER_ROLES } from '@/lib/contracts';

/**
 * Old address of the tag manager. Tap cards now live in one place (Tap Cards), so old bookmarks
 * land there; staff without tag access go Home instead of to a page they can't use.
 */
export default async function StaffTagsPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.tags);
  if ((TAG_MANAGER_ROLES as readonly string[]).includes(staff.role)) {
    redirect(ROUTES.staff.tapCards(staff.tenantSlug));
  }
  redirect(ROUTES.staff.root);
}
