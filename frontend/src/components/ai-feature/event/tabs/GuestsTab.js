"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import SimpleTable from "@/components/data-table/SimpleTable";
import { formatCount } from "@/lib/aiFeature.mjs";
import { deleteAiGuest, listAiGuestGroups, listAiGuests } from "@/services/ai-feature/ai-feature.service";
import usePagedList from "../usePagedList";
import { GuestFormDialog, GuestGroupsDialog, ImportGuestsDialog, RSVP_OPTIONS } from "../GuestDialogs";

const ALL = "all";
const RSVP_FILTER = [{ label: "Any RSVP", value: ALL }, ...RSVP_OPTIONS];
const SELFIE_FILTER = [{ label: "Any selfie", value: ALL }, { label: "No selfie", value: "NONE" }, { label: "Selfie uploaded", value: "UPLOADED" }, { label: "Selfie failed", value: "FAILED" }];
const RSVP_TONES = { PENDING: "bg-slate-100 text-slate-600", ACCEPTED: "bg-green-50 text-green-700", DECLINED: "bg-red-50 text-red-700" };
const SELFIE_LABELS = { NONE: "None", UPLOADED: "Uploaded", FAILED: "Failed" };
const SELFIE_TONES = { NONE: "text-slate-400", UPLOADED: "text-green-700", FAILED: "text-red-700" };

/** The guest list with its filters; a table from `md` up, cards below it. */
export default function GuestsTab({ eventId, event, canWrite, reloadEvent, showSuccess, showError }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [groupId, setGroupId] = useState(ALL);
  const [rsvp, setRsvp] = useState(ALL);
  const [selfie, setSelfie] = useState(ALL);
  const [groups, setGroups] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadGroups = useCallback(async () => {
    try { setGroups((await listAiGuestGroups(eventId)).data || []); }
    catch (cause) { showError(cause.message || "Unable to load the guest groups."); }
  }, [eventId, showError]);
  useEffect(() => {
    const timer = window.setTimeout(() => { loadGroups(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGroups]);

  const fetchPage = useCallback((page) => listAiGuests(eventId, { search: term, groupId: groupId === ALL ? undefined : groupId, rsvp, selfie, page, pageSize: 50 }), [eventId, groupId, rsvp, selfie, term]);
  const list = usePagedList(fetchPage, { resetKey: `${revision}` });
  const sentinelRef = useInfiniteScroll({ onLoadMore: list.loadMore, hasMore: list.hasMore, loading: list.loading, count: list.items.length, resetKey: `${term}|${groupId}|${rsvp}|${selfie}|${revision}` });

  const refresh = () => { setRevision((value) => value + 1); reloadEvent?.(); };

  async function remove(guest) {
    setBusy(true);
    try {
      await deleteAiGuest(eventId, guest.id);
      list.remove(guest.id);
      setDialog(null);
      showSuccess("Guest removed.");
      reloadEvent?.();
    } catch (cause) {
      showError(cause.message || "Unable to remove the guest.");
    } finally {
      setBusy(false);
    }
  }

  const rowMenu = (guest) => canWrite && <OptionsMenu ariaLabel={`Options for ${guest.name}`} items={[
    { label: "Edit", onSelect: () => setDialog({ kind: "edit", guest }) },
    { label: "Delete", tone: "danger", onSelect: () => setDialog({ kind: "delete", guest }) },
  ]} />;
  const rsvpChip = (value) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${RSVP_TONES[value] || RSVP_TONES.PENDING}`}>{RSVP_OPTIONS.find((option) => option.value === value)?.label || value}</span>;

  return <div>
    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <TextField label="Search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone or email" />
        <Dropdown label="Group" helperText="Lists only the guests in this group." options={[{ label: "Any group", value: ALL }, { label: "No group", value: "none" }, ...groups.map((group) => ({ label: group.name, value: group.id }))]} value={groupId} onChange={setGroupId} sorted={false} />
        <Dropdown label="RSVP" helperText="Lists only the guests with this RSVP answer." options={RSVP_FILTER} value={rsvp} onChange={setRsvp} sorted={false} />
        <Dropdown label="Selfie" helperText="Lists only the guests whose selfie is in this state." options={SELFIE_FILTER} value={selfie} onChange={setSelfie} sorted={false} />
      </div>
      {canWrite && <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setDialog({ kind: "groups" })}>Groups</Button>
        <Button type="button" size="sm" onClick={() => setDialog({ kind: "import" })}>Import</Button>
        <Button type="button" size="sm" variant="primary" onClick={() => setDialog({ kind: "add" })}>+ Add Guest</Button>
      </div>}
    </div>
    <p className="mb-2 text-xs text-slate-500">{formatCount(list.total)} {list.total === 1 ? "guest" : "guests"}</p>
    {list.error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{list.error}</p>}

    {!list.loading && list.items.length === 0
      ? <EmptyState title="No guests match." message={canWrite && !term && groupId === ALL && rsvp === ALL && selfie === ALL ? "Add guests one at a time or import a list; guests can also join from the event link." : "Try a different search or filter."} />
      : <>
        {/* The desktop list. Narrower than `md` the same guests are read as the cards below,
            because seven columns in 360px is a table nobody can read. */}
        <SimpleTable
          variant="form"
          classNames={{
            wrapper: "hidden !overflow-hidden md:block",
            table: "text-sm",
            head: "!text-[11px] uppercase",
            body: "divide-y divide-slate-100",
            row: "!border-t-0 hover:bg-slate-50/60",
          }}
          columns={[
            { key: "name", label: "Name", render: (guest) => <><p className="font-medium text-slate-800">{guest.name}</p>{guest.email && <p className="text-[11px] text-slate-500">{guest.email}</p>}</> },
            { key: "phone", label: "Phone", cellClassName: "text-slate-600", render: (guest) => guest.phone || "—" },
            { key: "group", label: "Group", cellClassName: "text-slate-600", render: (guest) => guest.group?.name || "—" },
            { key: "rsvp", label: "RSVP", render: (guest) => rsvpChip(guest.rsvp) },
            { key: "selfie", label: "Selfie", cellClassName: "text-xs", render: (guest) => <span className={SELFIE_TONES[guest.selfieStatus] || ""}>{SELFIE_LABELS[guest.selfieStatus] || guest.selfieStatus}</span> },
            { key: "matches", label: "Matches", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-slate-700", render: (guest) => formatCount(guest.matchedCount) },
            // Named for a screen reader, blank on screen: the column is the row's own menu.
            ...(canWrite ? [{ key: "actions", label: "Actions", srOnly: true, headerClassName: "w-10 !px-1", cellClassName: "!px-1 !py-1", render: (guest) => rowMenu(guest) }] : []),
          ]}
          rows={list.items}
        />
        <ul className="space-y-2 md:hidden">
          {list.items.map((guest) => <li key={guest.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{guest.name}</p>
              <p className="truncate text-xs text-slate-500">{[guest.phone, guest.email].filter(Boolean).join(" • ") || "No contact"}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {rsvpChip(guest.rsvp)}
                {guest.group?.name && <span>{guest.group.name}</span>}
                <span className={SELFIE_TONES[guest.selfieStatus]}>Selfie: {SELFIE_LABELS[guest.selfieStatus] || guest.selfieStatus}</span>
                <span>{formatCount(guest.matchedCount)} matches</span>
              </div>
            </div>
            {rowMenu(guest)}
          </li>)}
        </ul>
      </>}
    <div ref={sentinelRef} aria-hidden="true" className="h-px" />
    {list.loading && <Loader label="Loading guests..." size="sm" className="py-6" />}

    {canWrite && (dialog?.kind === "add" || dialog?.kind === "edit") && <GuestFormDialog eventId={eventId} guest={dialog.guest || null} groups={groups} onClose={() => setDialog(null)} onSaved={(saved) => { setDialog(null); showSuccess(dialog.kind === "edit" ? "Guest updated." : "Guest added."); if (dialog.kind === "edit") list.patch(saved.id, saved); else refresh(); }} />}
    {canWrite && dialog?.kind === "import" && <ImportGuestsDialog eventId={eventId} groups={groups} onClose={() => setDialog(null)} onImported={(result) => { setDialog(null); showSuccess(`${formatCount(result.created || 0)} added, ${formatCount(result.updated || 0)} updated.`); refresh(); }} />}
    {canWrite && dialog?.kind === "groups" && <GuestGroupsDialog eventId={eventId} groups={groups} onClose={() => setDialog(null)} onChanged={() => { loadGroups(); refresh(); }} />}
    <ConfirmDialog
      open={canWrite && dialog?.kind === "delete"}
      title="Remove this guest?"
      message={`"${dialog?.guest?.name}" is taken off the list along with their matches and selfie.`}
      confirmLabel="Remove guest"
      loading={busy}
      onCancel={() => setDialog(null)}
      onConfirm={() => remove(dialog.guest)}
    />
  </div>;
}
