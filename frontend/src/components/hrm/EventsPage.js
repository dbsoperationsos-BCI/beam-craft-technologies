"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import MultiImageField from "@/components/shared/MultiImageField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { saveBlob } from "@/lib/downloadImage";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { createEvent, deleteEvent, downloadEvent, listEvents } from "@/services/hrm/events.service";
import DateRangeSwitch from "@/components/shared/DateRangeSwitch";
import { ALL_TIME, resolveDateRange } from "@/lib/crmDateRange.mjs";
import { isBlankText } from "@/lib/formErrors.mjs";
import { useImageViewer } from "@/components/shared/ImageViewer";

/**
 * HRM → Events: the studio's events, each a photograph and what happened, for everybody to see.
 *
 * Anybody holding `HRM / Events` - Read is enough - reads the page and posts to it with Upload
 * Event: it is the studio's shared wall, not an HR noticeboard. Remove shows only on the events this
 * login may take down - the ones they posted, or every one for an administrator. The server says so
 * per event (`canRemove`) and checks it again on the delete. Download - the photos saved as a file -
 * is `HRM / Event Download`, granted apart from seeing them; without it the button is absent, and
 * the server refuses the file as well.
 */

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

// A written day, read as that day wherever the reader is.
const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const displayDay = (iso) => (iso ? dayFormat.format(new Date(`${iso}T00:00:00Z`)) : "");
const postedFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const displayPosted = (value) => (value ? postedFormat.format(new Date(value)) : "");

/**
 * `title` and `leadingAccessory` let Employee Attendance show this screen under its own heading, with
 * its section switch beside it - it is one of that page's sections; its own route still opens it
 * alone.
 */
export default function EventsPage({ title = "Events", leadingAccessory = null }) {
  const { hasPermission } = usePermissions();
  // Everybody who can open the page may post; the route guard already asked for Read to get here.
  const canPost = hasPermission("HRM", "Events", "READ");
  const canDownload = hasPermission("HRM", "Event Download", "READ");
  const { notice, showError, showSuccess, clearNotice } = useNotice();
  const [events, setEvents] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  // One download at a time: the guard is set before the first await, so a double press fetches
  // once, and the id says which event's Download is the busy one.
  const { busy: downloadBusy, run: runDownload } = useSubmitOnce();
  const [downloadingId, setDownloadingId] = useState(null);
  /*
   * Which posts to show, by the day they were posted - the shared date-range switch the CRM board
   * uses: All Time, Today, Yesterday, This Week, This Month, or Custom Date with From and To. An
   * event has no day of its own any more, so the posting day is the one there is. The server
   * filters, so an older post beyond the latest two hundred is still found.
   */
  const [dateRange, setDateRange] = useState(ALL_TIME);
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const range = useMemo(() => resolveDateRange(dateRange, { custom: customRange }), [dateRange, customRange]);
  const rangeFrom = range?.from || "";
  const rangeTo = range?.to || "";

  // Only the latest ask lands: switching ranges quickly must not leave an older answer on screen.
  const latest = useRef(0);
  const load = useCallback(() => {
    const ticket = ++latest.current;
    listEvents({ from: rangeFrom, to: rangeTo })
      .then((response) => { if (ticket === latest.current) setEvents(response?.data || []); })
      .catch((error) => { if (ticket !== latest.current) return; setEvents([]); showError(errorMessage(error, "Unable to load the events.")); });
  }, [rangeFrom, rangeTo, showError]);

  // Deferred a tick, this codebase's convention for a first load.
  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const filtered = Boolean(rangeFrom || rangeTo);

  async function remove() {
    setBusy(true);
    try {
      await deleteEvent(removing.id);
      setEvents((current) => (current || []).filter((event) => event.id !== removing.id));
      if (viewing?.id === removing.id) setViewing(null);
      setRemoving(null);
      showSuccess("Event removed.");
    } catch (error) {
      showError(errorMessage(error, "Unable to remove the event."));
    } finally {
      setBusy(false);
    }
  }

  function download(event) {
    return runDownload(async () => {
      setDownloadingId(event.id);
      try {
        const { blob, fileName } = await downloadEvent(event.id);
        saveBlob(blob, fileName);
        showSuccess(event.images?.length > 1 ? `${event.images.length} photos of ${event.title} downloaded.` : `${event.title} downloaded.`);
      } catch (error) {
        // A dropped connection throws the browser's own words ("Failed to fetch"), not the server's.
        showError(error instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : errorMessage(error, "Unable to download the event."));
      } finally {
        setDownloadingId(null);
      }
    });
  }

  // Download, where this login holds it: busy on the event being saved, waiting on every other.
  const downloadButton = (event, props = {}) => canDownload && <Button
    type="button"
    busy={downloadingId === event.id}
    busyLabel="Downloading..."
    disabled={downloadBusy}
    onClick={() => void download(event)}
    {...props}
  >Download</Button>;

  return <>
    <ModulePageHeader
      title={title}
      // Only when shown inside another screen, which puts its own switch here.
      titleAccessory={leadingAccessory ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:border-l sm:border-slate-200 sm:pl-3">
        {leadingAccessory}
      </div> : null}
      leadingActions={<DateRangeSwitch
        ariaLabel="Posted"
        value={dateRange}
        onChange={setDateRange}
        custom={customRange}
        onCustomChange={setCustomRange}
      />}
      actions={canPost ? <Button type="button" variant="primary" onClick={() => setUploading(true)}>Upload Event</Button> : null}
    />

    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 lg:p-5">
      {events === null
        ? <p className="text-sm text-slate-500">Loading the events...</p>
        : !events.length
          ? <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-sm font-semibold text-slate-800">{filtered ? "No events posted in this range" : "No events yet"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {filtered
                ? "Choose another range, or All Time to see every event."
                : canPost ? "Upload a photo and a few words about an event, and everybody will see it here." : "When an event is posted, it will appear here."}
            </p>
          </div>
          // One column on a phone, two on a tablet, three on a laptop and four on a wide monitor, so a
          // card is never stretched into a letterbox nor squeezed until its footer cannot fit.
          : <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
            {events.map((event) => <article key={event.id} className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button type="button" onClick={() => setViewing(event)} className="relative block aspect-video w-full overflow-hidden bg-slate-100" aria-label={`Open ${event.title}`}>
                {/* A plain img: the picture is a bucket link or, locally, an inline data URI. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.imageUrl} alt={event.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition hover:scale-[1.02]" />
                {/* The cover is one of several: say how many are behind it. */}
                {event.images?.length > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-slate-900/75 px-2 py-0.5 text-xs font-semibold text-white">{event.images.length} photos</span>}
              </button>
              <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
                <div className="min-w-0">
                  {/* `break-words`: a title or a pasted link with no spaces must wrap, not widen the card. */}
                  <h2 className="break-words text-base font-semibold text-slate-950">{event.title}</h2>
                </div>
                {event.description && <p className="line-clamp-3 whitespace-pre-line break-words text-sm text-slate-600">{event.description}</p>}
                {/*
                  * Who posted it, then View, Download and Remove. They share a line where the card is wide enough
                  * and the buttons drop beneath it where it is not, rather than the name being cut to
                  * "Posted by A..." on a phone. The buttons keep the 40px a finger needs.
                  */}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2 text-xs text-slate-500">
                  <span className="min-w-0 flex-1 basis-40 break-words">Posted{event.postedBy ? ` by ${event.postedBy}` : ""} on {displayPosted(event.createdAt)}</span>
                  <span className="flex shrink-0 flex-wrap gap-1">
                    <Button type="button" variant="ghost" onClick={() => setViewing(event)}>View</Button>
                    {downloadButton(event, { variant: "ghost" })}
                    {event.canRemove && <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setRemoving(event)}>Remove</Button>}
                  </span>
                </div>
              </div>
            </article>)}
          </div>}
    </div>

    {uploading && <UploadEventDialog
      onClose={() => setUploading(false)}
      onPosted={(event) => {
        setUploading(false);
        // Where the server's order puts it: newest post first, so the one just posted leads - read
        // again under a date range, which may or may not take in today.
        if (filtered) load();
        else setEvents((current) => [event, ...(current || []).filter((row) => row.id !== event.id)]);
        showSuccess("Event posted. Everybody with access to Events can see it now.");
      }}
    />}

    {viewing && <Dialog
      title={viewing.title}
      description={[displayDay(viewing.eventDate), viewing.postedBy && `Posted by ${viewing.postedBy}`].filter(Boolean).join(" · ") || undefined}
      size="xl"
      onClose={() => setViewing(null)}
      footer={<>
        {viewing.canRemove && <Button type="button" variant="danger" onClick={() => setRemoving(viewing)}>Remove</Button>}
        {downloadButton(viewing)}
        <Button type="button" onClick={() => setViewing(null)}>Close</Button>
      </>}
    >
      <div className="space-y-4 pb-2">
        <EventGallery key={viewing.id} title={viewing.title} images={viewing.images?.length ? viewing.images : [viewing.imageUrl]} />
        {viewing.description && <p className="whitespace-pre-line break-words text-sm text-slate-700">{viewing.description}</p>}
      </div>
    </Dialog>}

    {removing && <ConfirmDialog
      title={`Remove ${removing.title}?`}
      message="The event and its photos are taken off the Events page for everybody. This cannot be undone."
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={busy}
      // Removing can be asked from inside the view dialog, so it sits above one.
      layer="confirmOverDialog"
      onCancel={() => setRemoving(null)}
      onConfirm={remove}
    />}

    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}

/**
 * An event's photos in the full view: the one being looked at, large, with Previous and Next and a
 * strip of thumbnails to jump between them. One photo is simply shown.
 */
function EventGallery({ title, images }) {
  const [index, setIndex] = useState(0);
  // The photo shown opens full screen in the application's image viewer, among the event's photos.
  const openImages = useImageViewer();
  const count = images.length;
  const step = (by) => setIndex((current) => (current + by + count) % count);
  return <div>
    <div className="relative">
      {/* `dvh`, not `vh`: on a phone the browser's own bars come and go, and `vh` counts the space
          behind them, pushing the description under the fold. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[index]}
        alt={`${title}, photo ${index + 1} of ${count}`}
        onClick={openImages ? () => openImages(images.map((src, position) => ({ src, name: `${title} · photo ${position + 1}` })), index) : undefined}
        className={`max-h-[50dvh] w-full rounded-md bg-slate-100 object-contain sm:max-h-[60dvh] ${openImages ? "cursor-zoom-in" : ""}`}
      />
      {count > 1 && <>
        <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/60 text-lg text-white hover:bg-slate-900/80">‹</button>
        <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/60 text-lg text-white hover:bg-slate-900/80">›</button>
        <span className="absolute bottom-2 right-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-xs font-semibold text-white">{index + 1} / {count}</span>
      </>}
    </div>
    {count > 1 && <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {images.map((source, position) => <button
        key={`${position}-${source.slice(-24)}`}
        type="button"
        onClick={() => setIndex(position)}
        aria-label={`Show photo ${position + 1}`}
        aria-current={position === index ? "true" : undefined}
        className={`h-14 w-20 shrink-0 overflow-hidden rounded border-2 ${position === index ? "border-blue-600" : "border-transparent opacity-70 hover:opacity-100"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} alt="" loading="lazy" className="h-full w-full object-cover" />
      </button>)}
    </div>}
  </div>;
}

/** The most photos one event may carry - the server's own limit. */
const MAX_EVENT_PHOTOS = 10;

/**
 * Posting one event: its photos and a title, and - if the poster wants - a few words about it. No
 * event date: the day it was posted is what the page sorts and shows by.
 */
function UploadEventDialog({ onClose, onPosted }) {
  const [form, setForm] = useState({ images: [], title: "", description: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = useFormErrors();

  const update = (key, value) => { fields.clear(key); setForm((current) => ({ ...current, [key]: value })); setError(""); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    // Photos and a title are what an event needs; the description is optional.
    if (!fields.check({
      images: form.images.length ? "" : "Add at least one photo.",
      title: isBlankText(form.title) ? "Enter the event's title." : "",
    })) return;
    setBusy(true);
    try {
      const response = await createEvent({
        images: form.images,
        title: form.title.trim(),
        description: form.description.trim(),
      });
      onPosted(response?.data);
    } catch (requestError) {
      if (!fields.fromServer(requestError)) setError(errorMessage(requestError, "Unable to post the event."));
      setBusy(false);
    }
  }

  return <Dialog
    title="Upload Event"
    description="Everybody with access to Events will see the photos and the description."
    size="lg"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant="primary" size="lg" disabled={busy} className="font-semibold">{busy ? "Posting..." : "Post Event"}</Button>
    </>}
  >
    <div className="space-y-4 pb-2">
      <MultiImageField
        label="Event Photos"
        helperText="Photos from the event, shown to everyone who can open Events."
        required
        value={form.images}
        max={MAX_EVENT_PHOTOS}
        disabled={busy}
        // Kept large enough to be worth looking at full size; the server re-compresses to its own ceiling.
        compress={{ maxBytes: 600 * 1024, maxDimension: 2000 }}
        // The camera opens over this dialog.
        cameraLayer="confirmOverDialog"
        onChange={(next) => update("images", next)}
        error={fields.errors.images}
      />
      <TextField label="Title" required helperText="The event's name, shown above its photos." value={form.title} maxLength={150} onChange={(event) => update("title", event.target.value)} placeholder="Annual Day 2026" error={fields.errors.title} />
      <TextAreaField label="Description" helperText="A few lines about the event for everyone browsing Events." rows={5} maxLength={5000} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="What happened, who was there, anything worth remembering." />
      {(error || fields.summary) && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error || fields.summary}</p>}
    </div>
  </Dialog>;
}
