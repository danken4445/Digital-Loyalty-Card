'use client';

import { useState } from 'react';
import type { ApiResponse, StaffRole } from '@/lib/contracts';
import { Notice, Panel, inputClass, primaryButtonClass } from './ui';

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
  /** Called after an invite is sent (the setup wizard uses it to move on). */
  onInvited?: () => void;
}

export function StaffManagementClient({
  slug,
  isOwner,
  currentUserId,
  initialMembers,
  initialInvites,
  onInvited,
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
          message: body.ok ? "The invite wasn't sent. Please try again." : body.message || "The invite wasn't sent.",
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Invite sent to ${inviteEmail.trim()}. They can sign in on the staff login page with that email.`,
        });
        setInviteEmail('');
        onInvited?.();
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
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
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
          message: body.ok ? "That change wasn't saved." : body.message || "That change wasn't saved.",
        });
      } else {
        setFeedback({ type: 'success', message: 'Saved.' });
        setMembers((prev) =>
          prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)),
        );
      }
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
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
    if (currentActive && !window.confirm('Remove this person from your shop? They will no longer be able to sign in here. You can add them back later.')) {
      return;
    }

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
          message: body.ok ? "That change wasn't saved." : body.message || "That change wasn't saved.",
        });
      } else {
        setFeedback({
          type: 'success',
          message: nextActive ? 'They can sign in again.' : 'Removed. They can no longer sign in to this shop.',
        });
        setMembers((prev) =>
          prev.map((m) => (m.user_id === userId ? { ...m, active: nextActive } : m)),
        );
      }
    } catch {
      setFeedback({ type: 'error', message: 'No connection. Check your internet and try again.' });
    } finally {
      setBusyUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }


  const pendingInvites = invites.filter((inv) => inv.accepted_at === null);

  return (
    <div className="space-y-6">
      {feedback && <Notice tone={feedback.type}>{feedback.message}</Notice>}

      {isOwner ? (
        <Panel
          title="Invite someone"
          description="They'll get an email. They sign in on the staff login page with that email address."
        >
          <form onSubmit={handleSendInvite} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="block text-sm text-neutral-300">
                Their email
              </label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className={`${inputClass} mt-1.5`}
              />
            </div>

            <fieldset>
              <legend className="text-sm text-neutral-300">What can they do?</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ROLE_CHOICES.map((choice) => (
                  <label
                    key={choice.role}
                    className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                      inviteRole === choice.role ? 'border-white bg-white/10' : 'border-plug-border hover:border-neutral-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="invite-role"
                      value={choice.role}
                      checked={inviteRole === choice.role}
                      onChange={() => setInviteRole(choice.role)}
                      className="sr-only"
                    />
                    <span className="block font-semibold text-white">{choice.title}</span>
                    <span className="mt-0.5 block text-sm text-plug-muted">{choice.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex justify-end">
              <button type="submit" disabled={isInviting || !inviteEmail.trim()} className={primaryButtonClass}>
                {isInviting ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </form>
        </Panel>
      ) : (
        <Notice tone="info">Only the shop owner can invite people or change what they can do.</Notice>
      )}

      <Panel title={`Your team (${members.length})`}>
        {members.length <= 1 && (
          <p className="mb-3 text-sm text-plug-muted">
            It&apos;s just you for now. Invite your staff so they can redeem rewards with their own login.
          </p>
        )}
        <ul className="divide-y divide-plug-border">
          {members.map((member) => {
            const isBusy = busyUserIds.has(member.user_id);
            const isSelf = member.user_id === currentUserId;
            return (
              <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className={member.active ? '' : 'opacity-60'}>
                  <p className="font-medium text-white">
                    {member.display_name}
                    {isSelf && <span className="ml-2 text-sm font-normal text-plug-muted">(you)</span>}
                  </p>
                  <p className="text-sm text-plug-muted">
                    {ROLE_TITLES[member.role] ?? member.role}
                    {!member.active && ' · Removed'}
                  </p>
                </div>
                {isOwner && !isSelf && (
                  <div className="flex items-center gap-2">
                    <select
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member.user_id, e.target.value as StaffRole)}
                      disabled={isBusy || !member.active}
                      aria-label={`Change what ${member.display_name} can do`}
                      className="min-h-10 rounded-full border border-neutral-700 bg-neutral-950 px-3 text-sm text-white disabled:opacity-50"
                    >
                      {ROLE_CHOICES.map((c) => (
                        <option key={c.role} value={c.role}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(member.user_id, member.active)}
                      disabled={isBusy}
                      className={`inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium disabled:opacity-50 ${
                        member.active ? 'text-rose-300 hover:text-rose-200' : 'text-emerald-300 hover:text-emerald-200'
                      }`}
                    >
                      {member.active ? 'Remove' : 'Add back'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      {pendingInvites.length > 0 && (
        <Panel title="Waiting to join" description="People you invited who haven't signed in yet.">
          <ul className="divide-y divide-plug-border">
            {pendingInvites.map((inv) => {
              const isExpired = new Date(inv.expires_at) < new Date();
              return (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span className="text-white">{inv.email}</span>
                  <span className="text-plug-muted">
                    {ROLE_TITLES[inv.role] ?? inv.role} ·{' '}
                    {isExpired ? (
                      <span className="text-rose-300">Invite expired, send it again</span>
                    ) : (
                      `Invite works until ${new Date(inv.expires_at).toLocaleDateString()}`
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

const ROLE_CHOICES: ReadonlyArray<{ role: StaffRole; title: string; description: string }> = [
  { role: 'staff', title: 'Staff', description: 'Gives rewards and stamps at the counter.' },
  { role: 'manager', title: 'Manager', description: 'Also manages the card look, tap cards and reports.' },
  { role: 'owner', title: 'Owner', description: 'Full control, including the reward, team and billing.' },
];

const ROLE_TITLES: Record<string, string> = Object.fromEntries(ROLE_CHOICES.map((c) => [c.role, c.title]));
