'use client';

import React, { useId, useState } from 'react';
import type { ApiResponse } from '@/lib/contracts';
import { SeparationModal } from '@/components/console/SeparationModal';

export interface LocationItem {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  card_mode: 'shared' | 'separate';
  child_tenant_id: string | null;
  created_at: string;
}

export interface BranchLocationsClientProps {
  slug: string;
  initialLocations: LocationItem[];
}

export function BranchLocationsClient({
  slug,
  initialLocations,
}: BranchLocationsClientProps) {
  const [locations, setLocations] = useState<LocationItem[]>(initialLocations);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const [separatingLoc, setSeparatingLoc] = useState<LocationItem | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const newBranchNameId = useId();
  const newBranchAddressId = useId();
  const editBranchNameId = useId();
  const editBranchAddressId = useId();
  const editBranchActiveId = useId();

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmittingNew(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          address: newAddress.trim() || undefined,
        }),
      });

      const body: ApiResponse<{ locationId: string }> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to create branch location.',
        });
        return;
      }

      const newLoc: LocationItem = {
        id: body.data.locationId,
        name: newName.trim(),
        address: newAddress.trim() || null,
        active: true,
        card_mode: 'shared',
        child_tenant_id: null,
        created_at: new Date().toISOString(),
      };

      setLocations((prev) => [...prev, newLoc]);
      setNewName('');
      setNewAddress('');
      setIsAdding(false);
      setFeedback({ type: 'success', message: `Branch "${newLoc.name}" created successfully.` });
    } catch {
      setFeedback({ type: 'error', message: 'Network error creating branch.' });
    } finally {
      setIsSubmittingNew(false);
    }
  }

  function startEdit(loc: LocationItem) {
    setEditingLocId(loc.id);
    setEditName(loc.name);
    setEditAddress(loc.address || '');
    setEditActive(loc.active);
  }

  async function handleUpdateBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLocId) return;

    setIsSubmittingEdit(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(slug)}/locations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: editingLocId,
          name: editName.trim(),
          address: editAddress.trim() || undefined,
          active: editActive,
        }),
      });

      const body: ApiResponse<string> = await res.json();
      if (!res.ok || !body.ok) {
        setFeedback({
          type: 'error',
          message: !body.ok ? body.message : 'Failed to update branch.',
        });
        return;
      }

      setLocations((prev) =>
        prev.map((l) =>
          l.id === editingLocId
            ? { ...l, name: editName.trim(), address: editAddress.trim() || null, active: editActive }
            : l,
        ),
      );

      setEditingLocId(null);
      setFeedback({ type: 'success', message: 'Branch location updated successfully.' });
    } catch {
      setFeedback({ type: 'error', message: 'Network error updating branch.' });
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
            Branch Locations
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Manage your stores, physical locations, and card sharing settings.
          </p>
        </div>

        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="border border-amber-500 bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-400 self-start"
          >
            + Add New Branch
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`border p-4 text-xs ${
            feedback.type === 'success'
              ? 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300'
              : 'border-rose-800/80 bg-rose-950/40 text-rose-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Add new branch form */}
      {isAdding && (
        <div className="border border-neutral-800 bg-neutral-900/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Add New Branch Location
            </h3>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-xs text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleCreateBranch} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={newBranchNameId} className="block text-xs font-medium text-neutral-300 mb-1">
                  Branch Name *
                </label>
                <input
                  id={newBranchNameId}
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Ayala Malls Manila Bay"
                  className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white placeholder-neutral-600 focus:border-amber-500 focus:outline-none"
                  maxLength={80}
                />
              </div>

              <div>
                <label htmlFor={newBranchAddressId} className="block text-xs font-medium text-neutral-300 mb-1">
                  Address (Optional)
                </label>
                <input
                  id={newBranchAddressId}
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="e.g. Ground Floor, Cinema Wing"
                  className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white placeholder-neutral-600 focus:border-amber-500 focus:outline-none"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingNew}
                className="border border-amber-500 bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {isSubmittingNew ? 'Creating...' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Locations List */}
      <div className="divide-y divide-neutral-800 border border-neutral-800 bg-neutral-900/40">
        {locations.map((loc) => {
          const isEditing = editingLocId === loc.id;
          return (
            <div key={loc.id} className="p-5">
              {isEditing ? (
                <form onSubmit={handleUpdateBranch} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={editBranchNameId} className="block text-xs font-medium text-neutral-300 mb-1">
                        Branch Name
                      </label>
                      <input
                        id={editBranchNameId}
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        maxLength={80}
                      />
                    </div>

                    <div>
                      <label htmlFor={editBranchAddressId} className="block text-xs font-medium text-neutral-300 mb-1">
                        Address
                      </label>
                      <input
                        id={editBranchAddressId}
                        type="text"
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full border border-neutral-700 bg-black px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        maxLength={200}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id={editBranchActiveId}
                      type="checkbox"
                      checked={editActive}
                      onChange={(e) => setEditActive(e.target.checked)}
                      className="h-4 w-4 rounded border-neutral-700 bg-black text-amber-500 focus:ring-0"
                    />
                    <label htmlFor={editBranchActiveId} className="text-xs text-neutral-300">
                      Active (available for stamping)
                    </label>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingLocId(null)}
                      className="border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingEdit}
                      className="border border-amber-500 bg-amber-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-amber-400"
                    >
                      {isSubmittingEdit ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-display text-base font-bold uppercase tracking-wider text-white">
                        {loc.name}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-mono uppercase ${
                          loc.active
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                            : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                        }`}
                      >
                        {loc.active ? 'Active' : 'Inactive'}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-mono uppercase ${
                          loc.card_mode === 'separate'
                            ? 'bg-purple-950/60 text-purple-400 border border-purple-800/60'
                            : 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                        }`}
                      >
                        {loc.card_mode === 'separate' ? 'Separate Card' : 'Shared Card'}
                      </span>
                    </div>

                    {loc.address && <p className="text-xs text-neutral-400">{loc.address}</p>}

                    {/* Explainer for shared branch */}
                    {loc.card_mode === 'shared' ? (
                      <p className="text-[11px] text-neutral-500 italic">
                        Shares the brand&apos;s card, rules and cooldown
                      </p>
                    ) : (
                      <p className="text-[11px] text-purple-300/80">
                        Promoted to child shop with independent card, rules, and privacy notice.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => startEdit(loc)}
                      className="border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:bg-neutral-700 hover:text-white"
                    >
                      Edit Details
                    </button>

                    {loc.card_mode === 'shared' ? (
                      <button
                        type="button"
                        onClick={() => setSeparatingLoc(loc)}
                        className="border border-amber-600/70 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400 hover:bg-amber-900/50"
                      >
                        Give this branch its own card
                      </button>
                    ) : (
                      loc.child_tenant_id && (
                        <span className="text-xs font-mono text-purple-400">
                          Separate Card Active
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {locations.length === 0 && (
          <div className="p-8 text-center text-xs text-neutral-500">
            No branch locations configured. Add your first branch location above.
          </div>
        )}
      </div>

      {/* Separation Modal Flow */}
      {separatingLoc && (
        <SeparationModal
          slug={slug}
          locationId={separatingLoc.id}
          locationName={separatingLoc.name}
          onClose={() => setSeparatingLoc(null)}
          onSuccess={() => {
            setLocations((prev) =>
              prev.map((l) => (l.id === separatingLoc.id ? { ...l, card_mode: 'separate' } : l)),
            );
          }}
        />
      )}
    </div>
  );
}
