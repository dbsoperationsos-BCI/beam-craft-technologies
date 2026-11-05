"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import SearchRounded from "@mui/icons-material/SearchRounded";
import AiFeatureNavigation from "@/components/ai-feature/AiFeatureNavigation";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Tabs from "@/components/ui/Tabs";
import { EVENT_FILTERS, EVENT_SORTS } from "@/lib/aiFeature.mjs";
import { archiveAiEvent, deleteAiEvent, duplicateAiEvent, listAiEvents, restoreAiEvent } from "@/services/ai-feature/ai-feature.service";
import CreateEventWizard from "./CreateEventWizard";
import EventActionDialog from "./EventActionDialog";
import EventCard, { eventHref } from "./EventCard";

/**
 * AI Feature → Events: every event gallery as a card, with the search, the status filter and the
 * sort that narrow them.
 *
 * `?create=1` opens the wizard on arrival - the Overview's Create Event lands here with it - and
 * is then taken off the address, so a refresh does not open it again.
 *
 * IMAGE_SELECTION / AI Feature governs the route: READ browses and opens events; creating,
 * editing, duplicating, archiving and deleting are READ_WRITE, and a reader is not offered them.
 */
const PAGE_SIZE = 30;
const LIST_HREF = "/visual-curation/ai/events";
const FILTER_TABS = EVENT_FILTERS.map(([id, label]) => ({ id, label }));
const SORT_OPTIONS = EVENT_SORTS.map(([value, label]) => ({ value, label }));

/** A grey card standing in for one still on its way. */
function CardSkeleton() {
  return <div aria-hidden="true" className="animate-pulse overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="aspect-video bg-slate-100" />
    <div className="space-y-2 p-3"><div className="h-4 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/2 rounded bg-slate-100" /><div className="h-3 w-3/4 rounded bg-slate-100" /></div>
  </div>;
}

export default function AiEventsPage() {
  const { canWrite } = useRouteAccess();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [query, setQuery] = useState("");
  // The search, filter, sort and page as one value, so a new filter and the return to page one
  // are one change and one request rather than two racing each other.
  const [list, setList] = useState({ search: "", status: "all", sort: "newest", page: 1 });
  const { search, status, sort, page } = list;
  const narrow = (patch) => setList((current) => ({ ...current, ...patch, page: 1 }));
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The wizard: `null` closed, `{ event: null }` creating, `{ event }` editing that event's details.
  const [wizard, setWizard] = useState(null);
  // The confirmation: `{ mode, event }` or null.
  const [action, setAction] = useState(null);

  // `?create=1` is read once and taken off the address - the wizard is state from here on.
  // Applied during render rather than in an effect, the way the Image Selection list applies its
  // own URL filters, so the wizard is open on the first paint rather than a frame later.
  const wantsCreate = searchParams.get("create") === "1";
  const [openedFromUrl, setOpenedFromUrl] = useState(false);
  if (wantsCreate && !openedFromUrl) {
    setOpenedFromUrl(true);
    setWizard({ event: null });
  }
  useEffect(() => {
    if (wantsCreate) router.replace(LIST_HREF);
  }, [router, wantsCreate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setList((current) => (current.search === query.trim() ? current : { ...current, search: query.trim(), page: 1 })), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listAiEvents({ search, status, sort, page, pageSize: PAGE_SIZE });
      const data = response?.data || {};
      const rows = data.items || [];
      setItems((current) => (page > 1 ? [...current, ...rows] : rows));
      setTotal(Number(data.total) || rows.length);
      setError("");
    } catch (caught) {
      setError(caught?.message || "Unable to load events.");
    } finally {
      setLoading(false);
    }
  }, [page, search, sort, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const reload = () => { if (page === 1) void load(); else narrow({}); };

  function menuFor(event) {
    const open = { label: "Open Event", onSelect: () => router.push(eventHref(event.id)) };
    if (!canWrite) return [open];
    const archived = event.status === "ARCHIVED";
    return [
      open,
      { label: "Edit", onSelect: () => setWizard({ event }) },
      { label: "Duplicate", onSelect: () => setAction({ mode: "duplicate", event }) },
      archived
        ? { label: "Restore", onSelect: () => setAction({ mode: "restore", event }) }
        : { label: "Archive", onSelect: () => setAction({ mode: "archive", event }) },
      { separator: true },
      { label: "Delete", tone: "danger", onSelect: () => setAction({ mode: "delete", event }) },
    ];
  }

  async function runAction(payload) {
    const { mode, event } = action;
    if (mode === "delete") { await deleteAiEvent(event.id); showSuccess(`${event.name} deleted.`); }
    else if (mode === "archive") { await archiveAiEvent(event.id); showSuccess(`${event.name} archived.`); }
    else if (mode === "restore") { await restoreAiEvent(event.id); showSuccess(`${event.name} restored.`); }
    else if (mode === "duplicate") {
      const response = await duplicateAiEvent(event.id, payload);
      showSuccess(`${response?.data?.name || "The copy"} created.`);
    }
    reload();
  }

  function onWizardDone(saved, { created }) {
    setWizard(null);
    if (created && saved?.id) { router.push(eventHref(saved.id)); return; }
    showSuccess(`${saved?.name || "Event"} updated.`);
    reload();
  }

  const showSkeleton = loading && items.length === 0;
  const hasMore = items.length < total;
  const emptyMessage = search || status !== "all" ? "No events match this search or filter." : canWrite ? "Create an event to start its gallery." : "Events appear here once they are created.";

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <AiFeatureNavigation onCreateEvent={() => setWizard({ event: null })} />
    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/* The toolbar: search, the status tabs and the sort. Stacked on a phone, one row from md. */}
    <div className="shrink-0 border-b border-slate-200 px-3 py-2 sm:px-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <label className="relative block min-w-0 md:w-72">
          <span className="sr-only">Search events</span>
          <SearchRounded aria-hidden="true" fontSize="small" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={(changeEvent) => setQuery(changeEvent.target.value)} placeholder="Search by name, type or location" className="min-h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </label>
        <div className="flex min-w-0 items-center justify-between gap-2 md:justify-end">
          <Tabs tabs={FILTER_TABS} value={status} onChange={(value) => narrow({ status: value })} ariaLabel="Event status" size="sm" className="min-w-0" />
          <div className="w-32 shrink-0">
            <Dropdown ariaLabel="Sort events" className="dashboard-range-picker" options={SORT_OPTIONS} value={sort} onChange={(value) => narrow({ sort: value })} sorted={false} />
          </div>
        </div>
      </div>
    </div>

    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && items.length === 0
        ? <CardState error={error} onRetry={reload} />
        : showSkeleton
          ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} />)}</div>
          : items.length === 0
            ? <EmptyState title="No events" message={emptyMessage} action={canWrite && !search && status === "all" ? <Button type="button" variant="primary" size="sm" onClick={() => setWizard({ event: null })}>+ Create Event</Button> : null} />
            : <>
              <p className="mb-2 text-[11px] text-slate-500">{total} {total === 1 ? "event" : "events"}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((event) => <EventCard key={event.id} event={event} menuItems={menuFor(event)} />)}
              </div>
              {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
              {hasMore && <div className="mt-4 flex justify-center">
                <Button type="button" size="sm" disabled={loading} onClick={() => setList((current) => ({ ...current, page: current.page + 1 }))}>{loading ? "Loading..." : "Load more"}</Button>
              </div>}
            </>}
    </div>

    {wizard && canWrite && <CreateEventWizard event={wizard.event} onClose={() => setWizard(null)} onCreated={onWizardDone} />}
    {action && canWrite && <EventActionDialog mode={action.mode} event={action.event} onClose={() => setAction(null)} onConfirm={runAction} />}
  </section>;
}
