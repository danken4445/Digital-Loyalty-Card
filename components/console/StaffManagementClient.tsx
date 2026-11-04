'use client';

import { useState } from 'react';
import type { ApiResponse, StaffRole } from '@/lib/contracts';

export interface MemberItem {
  user_id: string;
  role: string;
  display_name: string;
  active: boolean;
  created_at: string;
}

export interface InviteItem {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface StaffManagementClientProps {
  slug: string;
  isOwner: boolean;
  currentUserId: string;
  initialMembers: MemberItem[];
  initialInvites: InviteItem[];
}

export function StaffManagementClient({
  slug,
  isOwner,
  currentUserId,
  initialMembers,
  initialInvites,
}: StaffManagementClientProps) {
  const [members, setMembers] = useState<MemberItem[]>(initialMembers);
  const [invites, setInvites] = useState<InviteItem[]>(initialInvites);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<StaffRole>('staff');
  const [isInviting, setIsInviting] = useState(false);

  const [busyUserIds, setBusyUserIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner || !inviteEmail.trim()) return;

    setIsInviting(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      const body: ApiResponse<{ result: string }> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? 'Failed to send invite' : body.message || 'Error sending invite',
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Invite sent to ${inviteEmail.trim()} as ${inviteRole}.`,
        });
        setInviteEmail('');
        // Add pending invite to local list
        setInvites((prev) => [
          {
            id: `temp-${Date.now()}`,
            email: inviteEmail.trim(),
            role: inviteRole,
            expires_at: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
            accepted_at: null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error sending invite.' });
    } finally {
      setIsInviting(false);
    }
  }

  async function handleUpdateRole(userId: string, newRole: StaffRole) {
    if (!isOwner) return;

    setBusyUserIds((prev) => new Set(prev).add(userId));
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          role: newRole,
        }),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? 'Failed to update role' : body.message || 'Error updating member role',
        });
      } else {
        setFeedback({ type: 'success', message: 'Member role updated.' });
        setMembers((prev) =>
          prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)),
        );
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error updating member role.' });
    } finally {
      setBusyUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    if (!isOwner) return;

    setBusyUserIds((prev) => new Set(prev).add(userId));
    setFeedback(null);

    const nextActive = !currentActive;

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          active: nextActive,
        }),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: body.ok ? 'Failed to update status' : body.message || 'Error updating member status',
        });
      } else {
        setFeedback({
          type: 'success',
          message: nextActive ? 'Member reactivated.' : 'Member deactivated.',
        });
        setMembers((prev) =>
          prev.map((m) => (m.user_id === userId ? { ...m, active: nextActive } : m)),
        );
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error updating member status.' });
    } finally {
      setBusyUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          role="alert"
          className={`border p-4 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
              : 'border-rose-800 bg-rose-950/40 text-rose-200'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Invite Form */}
      {isOwner ? (
        <div className="border border-plug-border bg-plug-surface p-5">
          <h2 className="font-display text-base font-bold uppercase tracking-wider text-white">
            Invite New Team Member
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Send an email invitation. The invitee can sign in on the staff login page with their invited email to join.
          </p>

          <form onSubmit={handleSendInvite} className="mt-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[240px]">
              <label
                htmlFor="invite-email"
                className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
              >
                Email Address
              </label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@example.com"
                required
                className="mt-1 block w-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none"
              />
            </div>

            <div className="w-36">
              <label
                htmlFor="invite-role"
                className="block text-xs font-semibold uppercase tracking-wider text-neutral-300"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as StaffRole)}
                className="mt-1 block w-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white focus:outline-none"
              >
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isInviting || !inviteEmail.trim()}
              className="border border-white bg-white px-5 py-2 text-sm font-semibold uppercase tracking-wider text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {isInviting ? 'Sending...' : 'Send Invite'}
            </button>
          </form>
        </div>
      ) : (
        <div
          role="status"
          className="border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200"
        >
          <strong>View Only:</strong> Only an owner can invite new staff members or modify roles.
        </div>
      )}

      {/* Active & Inactive Members */}
      <div className="border border-plug-border bg-plug-surface p-5">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-white">
          Team Members ({members.length})
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          Current team members with access to this shop.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-400">
              <tr>
                <th className="pb-3 font-semibold">Name</th>
                <th className="pb-3 font-semibold">Role</th>
                <th className="pb-3 font-semibold">Status</th>
                {isOwner && <th className="pb-3 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 text-neutral-300">
              {members.map((member) => {
                const isBusy = busyUserIds.has(member.user_id);
                const isSelf = member.user_id === currentUserId;

                return (
                  <tr key={member.user_id} className="hover:bg-neutral-900/40">
                    <td className="py-3 font-medium text-white">
                      {member.display_name}
                      {isSelf && (
                        <span className="ml-2 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-2xs text-neutral-300">
                          You
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      {isOwner ? (
                        <select
                          value={member.role}
                          onChange={(e) =>
                            handleUpdateRole(member.user_id, e.target.value as StaffRole)
                          }
                          disabled={isBusy}
                          aria-label={`Change role for ${member.display_name}`}
                          className="border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-white focus:outline-none disabled:opacity-50"
                        >
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                          <option value="owner">Owner</option>
                        </select>
                      ) : (
                        <span className="capitalize">{member.role}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-semibold ${
                          member.active
                            ? 'border border-emerald-800 bg-emerald-950/60 text-emerald-300'
                            : 'border border-neutral-700 bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {member.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(member.user_id, member.active)}
                          disabled={isBusy}
                          className={`border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            member.active
                              ? 'border-rose-800 text-rose-300 hover:bg-rose-950/50'
                              : 'border-emerald-800 text-emerald-300 hover:bg-emerald-950/50'
                          }`}
                        >
                          {member.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invites */}
      <div className="border border-plug-border bg-plug-surface p-5">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-white">
          Invitations ({invites.length})
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          History of invitations sent to this workspace.
        </p>

        {invites.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-500">No invitations found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="pb-3 font-semibold">Email</th>
                  <th className="pb-3 font-semibold">Role</th>
                  <th className="pb-3 font-semibold">Status</th>
                  <th className="pb-3 font-semibold text-right">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 text-neutral-300">
                {invites.map((inv) => {
                  const isAccepted = inv.accepted_at !== null;
                  const isExpired = !isAccepted && new Date(inv.expires_at) < new Date();

                  return (
                    <tr key={inv.id} className="hover:bg-neutral-900/40">
                      <td className="py-3 font-mono text-xs text-white">{inv.email}</td>
                      <td className="py-3 capitalize">{inv.role}</td>
                      <td className="py-3">
                        {isAccepted ? (
                          <span className="border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">
                            Accepted
                          </span>
                        ) : isExpired ? (
                          <span className="border border-rose-800 bg-rose-950/60 px-2 py-0.5 text-xs text-rose-300">
                            Expired
                          </span>
                        ) : (
                          <span className="border border-blue-800 bg-blue-950/60 px-2 py-0.5 text-xs text-blue-300">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right text-xs text-neutral-400">
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
