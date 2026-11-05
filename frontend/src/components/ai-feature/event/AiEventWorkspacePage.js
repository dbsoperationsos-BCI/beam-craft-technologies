"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { PageLoader } from "@/components/shared/Loader";
import useStickyTab from "@/components/shared/useStickyTab";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatEventRange } from "@/lib/aiFeature.mjs";
import { archiveAiEvent, deleteAiEvent, duplicateAiEvent, getAiEvent, restoreAiEvent } from "@/services/ai-feature/ai-feature.service";
import OverviewTab from "./tabs/OverviewTab";
import MediaTab from "./tabs/MediaTab";
import PeopleTab from "./tabs/PeopleTab";
import GuestsTab from "./tabs/GuestsTab";
import FaceRecognitionTab from "./tabs/FaceRecognitionTab";
import ActivityTab from "./tabs/ActivityTab";
import { useAiMediaLanded } from "../media-upload/hooks/useAiMediaUpload";
import ShareDialog from "./ShareDialog";
import EditEventDialog from "./EditEventDialog";
import EventSettingsDialog from "./EventSettingsDialog";

const EVENTS_LIST = "/visual-curation/ai/events";

/**
 * One event's workspace: the header names it, the tabs are where the studio works on it.
 *
 * Two permissions shape the page. The route's own (IMAGE_SELECTION / AI Feature) decides whether
 * the event, its media and guests may be changed. AI Face Management decides whether
 * the People and Face Recognition tabs exist at all - they are not mounted without READ on it -
 * and whether matches may be decided, failed photos retried, people merged or split.
 */
export default function AiEventWorkspacePage({ eventId }) {
  const router = useRouter();
  const { canWrite, loading: accessLoading } = useRouteAccess();
  const faceAccess = useModuleAccess("IMAGE_SELECTION", "AI Face Management");
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const [event, setEvent] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  // Bumped whenever media changes under the tabs - an upload batch, a delete, a retry - so the
  // Overview counts and the Media grid re-read without the tabs having to know about each other.
  const [mediaRevision, setMediaRevision] = useState(0);

  const tabs = useMemo(() => [
    // Labelled for what it is; the id stays "overview" so a remembered tab still opens it.
    { id: "overview", label: "Project Dashboard" },
    { id: "media", label: "Media" },
    ...(faceAccess.canRead ? [{ id: "people", label: "People" }] : []),
    { id: "guests", label: "Guests" },
    ...(faceAccess.canRead ? [{ id: "faces", label: "Face Recognition" }] : []),
    { id: "activity", label: "Activity" },
  ], [faceAccess.canRead]);
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const [tab, setTab] = useStickyTab(`ai-event:${eventId}`, "overview", tabIds);

  const loadEvent = useCallback(async () => {
    try {
      const response = await getAiEvent(eventId);
      setEvent(response.data);
      setLoadError("");
    } catch (cause) {
      setLoadError(cause.message || "Unable to load this event.");
    }
  }, [eventId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadEvent(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEvent]);

  const bumpMedia = useCallback(() => { setMediaRevision((value) => value + 1); loadEvent(); }, [loadEvent]);
  // Uploads live in the app-level store (the Media tab's workspace starts them): the grid refreshes
  // as photos land (throttled) and once more when the batch ends, whichever tab is open. No page
  // reload, ever.
  useAiMediaLanded(eventId, bumpMedia);

  async function runAction(action, done) {
    setBusy(true);
    try {
      const result = await action();
      await done?.(result);
    } catch (cause) {
      showError(cause.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const archived = event?.status === "ARCHIVED" || Boolean(event?.archivedAt);
  const menuItems = canWrite ? [
    { label: "Edit Event", onSelect: () => setDialog("edit") },
    { label: "Event Settings", onSelect: () => setDialog("settings") },
    { separator: true },
    { label: "Duplicate Event", onSelect: () => runAction(() => duplicateAiEvent(eventId), (response) => { showSuccess("Event duplicated."); if (response?.data?.id) router.push(`${EVENTS_LIST}/${response.data.id}`); }) },
    archived
      ? { label: "Restore Event", onSelect: () => runAction(() => restoreAiEvent(eventId), () => { showSuccess("Event restored."); loadEvent(); }) }
      : { label: "Archive Event", onSelect: () => runAction(() => archiveAiEvent(eventId), () => { showSuccess("Event archived."); loadEvent(); }) },
    { separator: true },
    { label: "Delete Event", tone: "danger", onSelect: () => setDialog("delete") },
  ] : [];

  const subtitle = event ? [formatEventRange(event.startDate, event.endDate), event.location].filter(Boolean).join(" • ") : "";
  const tabProps = { eventId, event, canWrite, faceAccess, showSuccess, showError, mediaRevision, bumpMedia, reloadEvent: loadEvent };

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <ModulePageHeader
      onBack={() => router.push(EVENTS_LIST)}
      title={event?.name || "Event"}
      titleAccessory={event && <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
        {subtitle && <span className="truncate">{subtitle}</span>}
        <StatusChip status={event.status} kind="event" />
      </span>}
      tabs={tabs}
      tabValue={tab}
      onTabChange={setTab}
      tabsAriaLabel="Event sections"
      actions={canWrite && event && !archived ? <Button type="button" variant="primary" size="sm" onClick={() => setDialog("share")}>Share</Button> : null}
      // The ⋮ in the header's own slot, so the row ends Nebula, then ⋮.
      menu={canWrite && event ? <OptionsMenu ariaLabel="Event options" triggerVariant="button" items={menuItems} /> : undefined}
    />
    {/* Media owns its own scrolling - the folder panel and the gallery each scroll alone inside
        the height this box hands down (md and up; below that the page scrolls, as everywhere).
        Every other tab keeps the one scrolling pane it always had. */}
    <div className={`min-h-0 flex-1 ${tab === "media" && event && !loadError && !accessLoading ? "flex flex-col overflow-y-auto md:overflow-hidden" : "overflow-y-auto"}`}>
      {(!event && !loadError) || accessLoading
        ? <PageLoader label="Loading event..." />
        : loadError
          ? <EmptyState title="This event could not be opened." message={loadError} action={<Button type="button" size="sm" onClick={loadEvent}>Try again</Button>} />
          : tab === "media"
            ? <MediaTab {...tabProps} />
            : <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 lg:px-5">
            {tab === "overview" && <OverviewTab {...tabProps} />}
            {tab === "people" && faceAccess.canRead && <PeopleTab {...tabProps} />}
            {tab === "guests" && <GuestsTab {...tabProps} />}
            {tab === "faces" && faceAccess.canRead && <FaceRecognitionTab {...tabProps} />}
            {tab === "activity" && <ActivityTab {...tabProps} />}
          </div>}
    </div>

    {dialog === "share" && canWrite && <ShareDialog eventId={eventId} eventName={event?.name} onClose={() => setDialog(null)} onNotify={showSuccess} />}
    {dialog === "edit" && canWrite && event && <EditEventDialog eventId={eventId} event={event} onClose={() => setDialog(null)} onSaved={(updated) => { setEvent(updated); setDialog(null); showSuccess("Event updated."); }} />}
    {dialog === "settings" && canWrite && <EventSettingsDialog eventId={eventId} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); showSuccess("Event settings saved."); loadEvent(); }} />}
    <ConfirmDialog
      open={dialog === "delete" && canWrite}
      title="Delete this event?"
      message={`"${event?.name || "This event"}" and everything in it - its photos, guests, faces and links - will be removed. This cannot be undone.`}
      confirmLabel="Delete event"
      busyLabel="Deleting..."
      loading={busy}
      onCancel={() => setDialog(null)}
      onConfirm={() => runAction(() => deleteAiEvent(eventId), () => router.push(EVENTS_LIST))}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
}
