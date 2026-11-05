"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dropdown from "@/components/shared/Dropdown";
import Checkbox from "@/components/shared/Checkbox";
import Loader from "@/components/shared/Loader";
import useFormErrors from "@/components/shared/useFormErrors";
import AuthImage from "@/components/shared/AuthImage";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatCount } from "@/lib/aiFeature.mjs";
import { aiFaceThumbnailPath, getAiPerson, hideAiPerson, linkAiPersonToGuest, listAiGuests, listAiPeople, mergeAiPeople, renameAiPerson, splitAiPerson } from "@/services/ai-feature/ai-feature.service";
import MediaLightbox from "./MediaLightbox";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

/**
 * One person: every photo they were found in, and - with Write on AI Face Management - the ways
 * to correct the engine: a name, a guest, hiding, merging another cluster into this one, or
 * separating the faces that are somebody else. `canWrite` arrives as a prop because the panel
 * opens from a card that is drawn for readers too.
 */
export default function PersonPanel({ eventId, person: initial, fallbackLabel, canWrite, onClose, onChanged, showSuccess, showError }) {
  const [person, setPerson] = useState(initial);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [label, setLabel] = useState(initial.label || "");
  const [guests, setGuests] = useState(null);
  const [busy, setBusy] = useState("");
  const [lightbox, setLightbox] = useState(-1);
  const [mode, setMode] = useState("view");
  const [selectedFaces, setSelectedFaces] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null);
  const fields = useFormErrors();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAiPerson(eventId, initial.id, { pageSize: 200 });
      setPerson(response.data.person);
      setMedia(response.data.media || []);
      setLabel(response.data.person?.label || "");
      setError("");
    } catch (cause) {
      setError(cause.message || "Unable to load this person.");
    } finally {
      setLoading(false);
    }
  }, [eventId, initial.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!canWrite) return undefined;
    let cancelled = false;
    listAiGuests(eventId, { pageSize: 200 }).then((response) => { if (!cancelled) setGuests(response.data?.items || []); }).catch(() => { if (!cancelled) setGuests([]); });
    return () => { cancelled = true; };
  }, [canWrite, eventId]);

  async function run(name, action, message) {
    setBusy(name);
    try {
      const response = await action();
      if (response?.data?.id) { setPerson(response.data); onChanged?.(response.data); }
      if (message) showSuccess(message);
      return response;
    } catch (cause) {
      showError(cause.message || "That did not work.");
      return null;
    } finally {
      setBusy("");
    }
  }

  const rename = () => run("rename", () => renameAiPerson(eventId, person.id, label.trim() || null), "Person renamed.");
  const toggleHidden = () => run("hide", () => hideAiPerson(eventId, person.id, !person.hidden), person.hidden ? "Person shown again." : "Person hidden from the gallery.");
  const link = (guestId) => run("link", () => linkAiPersonToGuest(eventId, person.id, guestId || null), guestId ? "Linked to the guest." : "Guest link removed.");
  async function split() {
    const faceIds = Array.from(selectedFaces);
    const response = await run("split", () => splitAiPerson(eventId, person.id, faceIds), `${formatCount(faceIds.length)} ${faceIds.length === 1 ? "face" : "faces"} moved to a new person.`);
    if (response) { setMode("view"); setSelectedFaces(new Set()); load(); onChanged?.(null); }
  }
  async function merge(sourceIds) {
    const response = await run("merge", () => mergeAiPeople(eventId, person.id, sourceIds), `${formatCount(sourceIds.length)} ${sourceIds.length === 1 ? "person" : "people"} merged into ${label || fallbackLabel}.`);
    if (response) { setMode("view"); load(); onChanged?.(null); }
  }

  const toggleFace = (faceId) => { fields.clear("faces"); setSelectedFaces((current) => { const next = new Set(current); if (next.has(faceId)) next.delete(faceId); else next.add(faceId); return next; }); };
  const stopSplitting = () => { fields.clear("faces"); setMode("view"); setSelectedFaces(new Set()); };
  const title = person.label || fallbackLabel;

  return <>
    <Dialog
      title={title}
      description={`${formatCount(person.mediaCount)} ${person.mediaCount === 1 ? "photo" : "photos"} • ${formatCount(person.faceCount)} ${person.faceCount === 1 ? "face" : "faces"}${person.guest?.name ? ` • ${person.guest.name}` : ""}${person.hidden ? " • hidden from the gallery" : ""}`}
      size="xl"
      height="tall"
      onClose={onClose}
      busy={Boolean(busy)}
      toolbar={canWrite && <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <TextField label="Name" helperText="The name this person is shown under on the People tab." value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} placeholder={fallbackLabel} className="min-w-0 flex-1" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); rename(); } }} />
            <Button type="button" size="sm" className="min-h-9" disabled={busy === "rename" || (label.trim() || "") === (person.label || "")} onClick={rename}>{busy === "rename" ? "Saving..." : "Rename"}</Button>
          </div>
          <Dropdown label="Linked guest" helperText="The guest this face belongs to; changes save at once." searchable clearable clearLabel="No guest" placeholder={guests === null ? "Loading guests..." : "Not linked to a guest"} disabled={guests === null || busy === "link"} options={(guests || []).map((guest) => ({ label: guest.phone ? `${guest.name} (${guest.phone})` : guest.name, value: guest.id }))} value={person.guestId || ""} onChange={(value) => link(value || null)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={Boolean(busy)} onClick={toggleHidden}>{person.hidden ? "Show in gallery" : "Hide from gallery"}</Button>
          <Button type="button" size="sm" disabled={Boolean(busy) || mode === "merge"} onClick={() => setMode("merge")}>Merge another person into this</Button>
          {mode === "split"
            ? <>
              <Button type="button" size="sm" variant="primary" disabled={busy === "split"} onClick={() => { if (fields.check({ faces: selectedFaces.size ? "" : "Tick the photos to separate." })) setConfirm("split"); }}>Separate {selectedFaces.size ? `${formatCount(selectedFaces.size)} ${selectedFaces.size === 1 ? "face" : "faces"}` : "selected"}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={stopSplitting}>Cancel</Button>
            </>
            : <Button type="button" size="sm" disabled={Boolean(busy) || !media.length} onClick={() => setMode("split")}>Separate faces</Button>}
        </div>
        {mode === "split" && (fields.errors.faces
          ? <p role="alert" className="text-xs text-red-600">{fields.errors.faces}</p>
          : <p className="text-xs text-slate-500">Tick the photos where the face is somebody else. They become a new person.</p>)}
      </div>}
    >
      {loading
        ? <Loader label="Loading photos..." />
        : error
          ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          : media.length === 0
            ? <EmptyState title="No photos for this person." />
            : <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {media.map((item, index) => <li key={`${item.id}-${item.faceId}`} className="relative">
                <LazyImage src={item.thumbnailUrl} alt={item.fileName} onClick={mode === "split" ? () => toggleFace(item.faceId) : () => setLightbox(index)} className={`aspect-square w-full rounded-md ${mode === "split" && selectedFaces.has(item.faceId) ? "ring-2 ring-blue-600 ring-offset-1" : ""}`} />
                {mode === "split" && <span className="absolute left-1 top-1 rounded bg-white/90 p-0.5 shadow-sm"><Checkbox ariaLabel={`Select face in ${item.fileName}`} checked={selectedFaces.has(item.faceId)} invalid={Boolean(fields.errors.faces)} onChange={() => toggleFace(item.faceId)} /></span>}
              </li>)}
            </ul>}
    </Dialog>

    {lightbox >= 0 && <MediaLightbox items={media} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(-1)} />}
    {mode === "merge" && canWrite && <MergeDialog eventId={eventId} target={person} targetLabel={title} busy={busy === "merge"} onClose={() => setMode("view")} onMerge={merge} />}
    <ConfirmDialog
      open={confirm === "split"}
      layer="confirmOverDialog"
      tone="primary"
      title="Separate these faces?"
      message={`${formatCount(selectedFaces.size)} ${selectedFaces.size === 1 ? "face moves" : "faces move"} out of ${title} into a new person. Merge them back if that was wrong.`}
      confirmLabel="Separate"
      loading={busy === "split"}
      onCancel={() => setConfirm(null)}
      onConfirm={async () => { await split(); setConfirm(null); }}
    />
  </>;
}

/** Pick the other people whose faces are really this one. */
function MergeDialog({ eventId, target, targetLabel, busy, onClose, onMerge }) {
  const [people, setPeople] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const fields = useFormErrors();
  useEffect(() => {
    let cancelled = false;
    listAiPeople(eventId, { pageSize: 200, includeHidden: "true" }).then((response) => { if (!cancelled) setPeople((response.data?.items || []).filter((row) => row.id !== target.id)); }).catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, [eventId, target.id]);
  const toggle = (id) => { fields.clear("people"); setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const shown = (people || []).map((row, index) => ({ row, name: row.label || `Person ${String(index + 1).padStart(3, "0")}` })).filter(({ name, row }) => matchesWordChunks(`${name} ${row.guest?.name || ""}`, search));

  return <Dialog
    title={`Merge into ${targetLabel}`}
    description="Every photo of the people you tick moves to this person; the ticked people are removed."
    size="md"
    height="mid"
    layer="dialogOverPanel"
    onClose={onClose}
    busy={busy}
    toolbar={<TextField label="Find a person" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or guest" />}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="primary" className="max-sm:flex-1" disabled={busy} onClick={() => { if (fields.check({ people: selected.size ? "" : "Tick at least one person to merge." })) onMerge(Array.from(selected)); }}>{busy ? "Merging..." : `Merge ${selected.size || ""}`.trim()}</Button>
    </>}
  >
    {people === null
      ? <Loader label="Loading people..." />
      : shown.length === 0
        ? <EmptyState title="Nobody else to merge." />
        : <>{fields.errors.people && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{fields.errors.people}</p>}<ul className="divide-y divide-slate-100">
          {shown.map(({ row, name }) => <li key={row.id}>
            <label className="flex cursor-pointer items-center gap-3 py-2">
              <Checkbox checked={selected.has(row.id)} invalid={Boolean(fields.errors.people)} onChange={() => toggle(row.id)} ariaLabel={`Merge ${name}`} />
              {row.coverFaceId ? <AuthImage path={aiFaceThumbnailPath(eventId, row.coverFaceId)} alt="" className="h-10 w-10 shrink-0 rounded-md" /> : <span className="h-10 w-10 shrink-0 rounded-md bg-slate-100" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-800">{name}{row.hidden ? " (hidden)" : ""}</span>
                <span className="block truncate text-[11px] text-slate-500">{formatCount(row.mediaCount)} photos{row.guest?.name ? ` • ${row.guest.name}` : ""}</span>
              </span>
            </label>
          </li>)}
        </ul></>}
  </Dialog>;
}
