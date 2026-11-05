"use client";
/* eslint-disable @next/next/no-img-element -- the studio's own uploads, shown as they are */

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { TableCellValue } from "@/components/data-table/tableCells";
import useTableSelection from "@/components/data-table/useTableSelection";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { getInvitationCards, listClientInvitations, markInvitationPaid, markInvitationsPaid, deleteClientInvitations, removeInvitationDesign, saveInvitationTerms, removeInvitationSong, saveInvitationDesign, saveInvitationSong } from "@/services/client-management/invitation-cards.service";

/*
 * Client Management -> Invitation Cards: what clients make their invitations from in their app.
 *
 * - **Designs**: the studio's artwork, the shoots it is for (Settings -> Fields -> Shoot Types) and
 *   the animated theme it plays in. A client sees a shoot in their app once it has a design.
 * - **Songs**: the music a client may set; the invitation plays ten seconds of it, from the second
 *   the client picks, on a loop. Tied to some shoots, or to every shoot when none is chosen.
 *
 * Removing either withdraws it from the clients' lists; an invitation already shared keeps playing.
 * Behind `CLIENT / Invitation Cards`: Read to see them, Read / Write to change them.
 */

// The design team's artwork goes up exactly as made - a GIF or animated WebP keeps moving, a PNG keeps
// its see-through parts, a video keeps playing - and the server makes it phone sized without losing
// either. The main artwork may also be a video; the top and bottom pieces are pictures.
const PICTURE_TYPES = { "image/gif": "GIF", "image/webp": "WebP", "image/png": "PNG", "image/jpeg": "JPG" };
const VIDEO_TYPES = { "video/mp4": "MP4", "video/quicktime": "MOV", "video/webm": "WebM" };
const PICTURE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 30 * 1024 * 1024;
const EXTENSION_TYPES = { gif: "image/gif", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const typeOfFile = (file) => file.type || EXTENSION_TYPES[String(file.name).split(".").pop().toLowerCase()] || "";
// What is in the box now: a new file (a data URI says), or the one the design has (its own type).
const isVideo = (value, savedType) => (String(value || "").startsWith("data:") ? String(value).startsWith("data:video/") : savedType === "video");

/**
 * Upload file: drop a file on the box or click it to choose one. The file goes up as it is - no
 * squeezing in the browser - and shows here as it will play: a GIF moving, a video looping.
 */
function ArtworkUpload({ label, required = false, value, savedType = "image", video = false, hint, onChange }) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState("");
  const [name, setName] = useState("");
  const types = video ? { ...PICTURE_TYPES, ...VIDEO_TYPES } : PICTURE_TYPES;
  const accepted = Object.values(types).join(", ");

  async function take(file) {
    if (!file) return;
    setProblem("");
    const type = typeOfFile(file);
    if (!types[type]) { setProblem(`${file.name} is not a file this takes. Upload ${accepted}.`); return; }
    const max = VIDEO_TYPES[type] ? VIDEO_MAX : PICTURE_MAX;
    if (file.size > max) { setProblem(`${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Upload one of ${Math.round(max / (1024 * 1024))} MB or less.`); return; }
    try {
      const data = await readFile(file);
      // Some browsers name a video's type only by its extension; the data URI carries the real one.
      onChange(data.replace(/^data:[^;,]*;/, `data:${type};`));
      setName(file.name);
    } catch (error) {
      setProblem(error.message);
    }
  }

  return <div>
    <p className="mb-1.5 text-xs font-semibold text-slate-600">{label}{required ? <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span> : null}</p>
    <label
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); void take(event.dataTransfer.files?.[0]); }}
      className={`relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors ${over ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-400"}`}
    >
      {value ? (isVideo(value, savedType)
        ? <video src={value} className="max-h-48 w-auto rounded-lg" autoPlay muted loop playsInline />
         
        : <img src={value} alt="" className="max-h-48 w-auto rounded-lg" />) : (
        <>
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="text-sm font-semibold text-slate-700">Upload file</span>
          <span className="text-xs text-slate-500">Drop it here or click to choose</span>
        </>
      )}
      <input type="file" accept={Object.keys(types).join(",")} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void take(file); }} />
    </label>
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <p className="text-xs text-slate-500">{name || `${accepted} - up to ${video ? "15 MB (video 30 MB)" : "15 MB"}`}</p>
      {value ? <button type="button" onClick={() => { onChange(null); setName(""); }} className="shrink-0 text-xs font-medium text-red-600 hover:underline">Remove</button> : null}
    </div>
    {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    {problem ? <p className="mt-1 text-xs text-red-600" role="alert">{problem}</p> : null}
  </div>;
}

const MAX_SONG_BYTES = 8 * 1024 * 1024;
const SONG_ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a";
const DEFAULT_ACCENT = "#B08D57";
// The studio's price range for a design, in rupees (the server holds it too).
const PRICE_MIN = 100;
const PRICE_MAX = 200;

const shootsLabel = (names) => (names.length ? names.join(", ") : "Every shoot");

function StatusPill({ active }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
    {active ? "Showing to clients" : "Switched off"}
  </span>;
}

/** The studio's shoot names, kind by kind, to tick. */
function ShootPicker({ groups, value, onChange, emptyLabel }) {
  const toggle = (name) => onChange(value.includes(name) ? value.filter((entry) => entry !== name) : [...value, name]);
  return <div className="space-y-3 rounded-lg border border-slate-200 p-3">
    {groups.map((group) => group.shoots.length ? <div key={group.key}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
      <div className="flex flex-wrap gap-1.5">
        {group.shoots.map((name) => {
          const on = value.includes(name);
          return <button
            key={name}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(name)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}
          >{name}</button>;
        })}
      </div>
    </div> : null)}
    {!groups.some((group) => group.shoots.length) ? <p className="text-sm text-slate-500">No shoot types yet. Add them in Settings → Fields → Shoot Types.</p> : null}
    <p className="text-xs text-slate-500">{value.length ? `${value.length} chosen` : emptyLabel}</p>
  </div>;
}

function ActiveToggle({ value, onChange }) {
  return <label className="flex items-center gap-2 text-sm text-slate-700">
    <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
    Show to clients
  </label>;
}

function DesignForm({ design, styles, groups, onClose, onSaved }) {
  const [title, setTitle] = useState(design?.title || "");
  const [shootTypes, setShootTypes] = useState(design?.shootTypes || []);
  const [style, setStyle] = useState(design?.style || styles[0]?.key || "royal");
  const [accent, setAccent] = useState(design?.accent || DEFAULT_ACCENT);
  const [cover, setCover] = useState(design?.coverUrl || null);
  const [top, setTop] = useState(design?.topUrl || null);
  const [bottom, setBottom] = useState(design?.bottomUrl || null);
  const [sortOrder, setSortOrder] = useState(design?.sortOrder ?? 0);
  // Free only when ticked. Otherwise a client's invitation gets 2 free edits, then waits on payment -
  // at this price, or (left empty) at the price the studio tells them.
  const [price, setPrice] = useState(design?.price ? String(design.price) : "");
  const [free, setFree] = useState(Boolean(design?.isFree));
  const [isActive, setIsActive] = useState(design?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    if (!title.trim()) { setProblem("Give the design a name."); return; }
    if (!shootTypes.length) { setProblem("Choose at least one shoot this design is for."); return; }
    if (!cover) { setProblem("Upload the design's artwork."); return; }
    const amount = Math.round(Number(price));
    if (!free && !(amount >= PRICE_MIN && amount <= PRICE_MAX)) { setProblem(`Enter the design's price - between Rs ${PRICE_MIN} and Rs ${PRICE_MAX} - or tick Free design.`); return; }
    setSaving(true);
    setProblem("");
    try {
      const result = await saveInvitationDesign(design?.id, { title: title.trim(), shootTypes, style, accent, price: free ? 0 : amount, isFree: free, cover, top: top || "", bottom: bottom || "", sortOrder: Number(sortOrder) || 0, isActive });
      onSaved(result?.message || "Design saved.");
    } catch (error) {
      setProblem(error.message || "Unable to save the design.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={design ? "Change design" : "Add design"}
    description="Clients choose it in their app for the shoots you tick, and it plays with the theme you pick."
    size="lg"
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : design ? "Save design" : "Add design"}</Button>
    </>}
  >
    <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-4">
        <ArtworkUpload label="Artwork - picture, GIF or video" required video value={cover} savedType={design?.coverType} onChange={setCover} hint="Your design team's illustration or animation. Shown whole beside the client's names - never behind them. Tall works best (e.g. 1080 x 1350)." />
        <ArtworkUpload label="Top decoration" value={top} onChange={setTop} hint="Optional. A see-through PNG or animated GIF along the top - clouds, a garland. It drifts in on its own." />
        <ArtworkUpload label="Bottom decoration" value={bottom} onChange={setBottom} hint="Optional. A see-through PNG or animated GIF along the bottom - palms, flowers. It rises in on its own." />
      </div>
      <div className="min-w-0 space-y-4">
        <TextField label="Name" required value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Royal Gold" />
        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-600">Shoots it is for <span aria-hidden="true" className="text-rose-500">*</span></p>
          <ShootPicker groups={groups} value={shootTypes} onChange={setShootTypes} emptyLabel="Tick one or more." />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-600">How it moves</p>
          <div role="radiogroup" aria-label="How it moves" className="grid gap-2 sm:grid-cols-2">
            {styles.map((option) => <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={style === option.key}
              onClick={() => setStyle(option.key)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${style === option.key ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-300"}`}
            >
              <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
              <span className="block text-xs text-slate-500">{option.about}</span>
            </button>)}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-xs font-semibold text-slate-600">
            Accent colour
            <span className="mt-1 flex items-center gap-2">
              <input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-200" aria-label="Accent colour" />
              <span className="font-mono text-xs font-normal text-slate-500">{accent.toUpperCase()}</span>
            </span>
          </label>
          <div className="flex items-end gap-3">
            <TextField label={`Price (Rs ${PRICE_MIN}-${PRICE_MAX})`} required={!free} type="number" min={PRICE_MIN} max={PRICE_MAX} value={free ? "" : price} disabled={free} placeholder={free ? "Free" : `e.g. ${Math.round((PRICE_MIN + PRICE_MAX) / 2)}`} onChange={(event) => setPrice(event.target.value)} className="w-36" helperText="What the client pays to share the invitation and keep editing after their 2 free edits." />
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={free} onChange={(event) => setFree(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Free design (no payment)
            </label>
          </div>
          <TextField label="Order" type="number" min={0} max={9999} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="w-24" helperText="Lower shows first." />
          <ActiveToggle value={isActive} onChange={setIsActive} />
        </div>
        {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
      </div>
    </div>
  </Dialog>;
}

/** Reads a picked file as a data URI. */
const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(new Error("The file could not be read."));
  reader.readAsDataURL(file);
});

function SongForm({ song, groups, seconds, onClose, onSaved }) {
  const [title, setTitle] = useState(song?.title || "");
  const [artist, setArtist] = useState(song?.artist || "");
  const [shootTypes, setShootTypes] = useState(song?.shootTypes || []);
  const [audio, setAudio] = useState(song?.audioUrl || null);
  const [fileName, setFileName] = useState("");
  const [sortOrder, setSortOrder] = useState(song?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(song?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProblem("");
    if (!/\.(mp3|m4a)$/i.test(file.name) && !/^audio\/(mpeg|mp4|x-m4a)$/.test(file.type)) { setProblem("Choose an MP3 or M4A file."); return; }
    if (file.size > MAX_SONG_BYTES) { setProblem("The song must be 8 MB or smaller."); return; }
    try {
      setAudio(await readFile(file));
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
    } catch (error) {
      setProblem(error.message);
    }
  }

  async function save() {
    if (!title.trim()) { setProblem("Give the song a name."); return; }
    if (!audio) { setProblem("Upload the song."); return; }
    setSaving(true);
    setProblem("");
    try {
      const result = await saveInvitationSong(song?.id, { title: title.trim(), artist: artist.trim(), shootTypes, audio, sortOrder: Number(sortOrder) || 0, isActive });
      onSaved(result?.message || "Song saved.");
    } catch (error) {
      setProblem(error.message || "Unable to save the song.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={song ? "Change song" : "Add song"}
    description={`Clients pick a song and the second it starts from; the invitation plays ${seconds} seconds of it on a loop. Upload only music the studio has the right to share.`}
    size="md"
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : song ? "Save song" : "Add song"}</Button>
    </>}
  >
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Song file <span aria-hidden="true" className="text-rose-500">*</span></p>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm hover:border-blue-400">
          <span className="truncate text-slate-600">{fileName || (audio ? "Song uploaded" : "Choose an MP3 or M4A (up to 8 MB)")}</span>
          <span className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{audio ? "Replace" : "Choose file"}</span>
          <input type="file" accept={SONG_ACCEPT} onChange={(event) => { void pick(event); }} className="sr-only" />
        </label>
        {audio ? <audio controls src={audio} className="mt-2 w-full" preload="none" /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" required value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Wedding instrumental" />
        <TextField label="Artist" value={artist} maxLength={120} onChange={(event) => setArtist(event.target.value)} placeholder="Optional" />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Shoots it is for</p>
        <ShootPicker groups={groups} value={shootTypes} onChange={setShootTypes} emptyLabel="None ticked - offered for every shoot." />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <TextField label="Order" type="number" min={0} max={9999} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="w-24" helperText="Lower shows first." />
        <ActiveToggle value={isActive} onChange={setIsActive} />
      </div>
      {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
    </div>
  </Dialog>;
}

const rupees = (amount) => `Rs ${Number(amount || 0).toLocaleString("en-IN")}`;
const PAYMENT_STATUS = {
  requested: { label: "Asked to unlock", tone: "bg-amber-50 text-amber-700" },
  unpaid: { label: "Not paid", tone: "bg-slate-100 text-slate-600" },
  paid: { label: "Paid", tone: "bg-emerald-50 text-emerald-700" },
};
const shortWhen = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

/** One client's own price and free edits for their invitation. */
function TermsForm({ row, onClose, onSaved }) {
  const [price, setPrice] = useState(row.ownPrice ? String(row.ownPrice) : "");
  const [limit, setLimit] = useState(row.ownEditLimit !== null && row.ownEditLimit !== undefined ? String(row.ownEditLimit) : "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    const amount = price === "" ? null : Math.round(Number(price));
    const edits = limit === "" ? null : Math.round(Number(limit));
    if (amount !== null && !(amount >= PRICE_MIN && amount <= PRICE_MAX)) { setProblem(`The price is between Rs ${PRICE_MIN} and Rs ${PRICE_MAX} - or leave it empty for the design's.`); return; }
    if (edits !== null && !(edits >= 0 && edits <= 20)) { setProblem("Free edits are between 0 and 20 - or leave it empty for the usual 2."); return; }
    setSaving(true);
    setProblem("");
    try {
      const result = await saveInvitationTerms(row.id, { price: amount, editLimit: edits });
      onSaved(result?.message || "Saved.");
    } catch (error) {
      setProblem(error.message || "Unable to save.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={`${row.names || "Client"} - ${row.shootName}`}
    description={`${row.eventId} · ${row.design.title}. What this client pays and how many free edits they get - the client sees it at once.`}
    size="sm"
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
    </>}
  >
    <div className="space-y-4">
      <TextField label={`Price for this client (Rs ${PRICE_MIN}-${PRICE_MAX})`} type="number" min={PRICE_MIN} max={PRICE_MAX} value={price} onChange={(event) => setPrice(event.target.value)} placeholder={row.design.price ? `Design's price: ${row.design.price}` : "Design has no price yet"} helperText="Leave empty to use the design's price." />
      <TextField label="Free edits for this client" type="number" min={0} max={20} value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="Usual: 2" helperText={`They have used ${row.editCount}. Leave empty for the usual 2.`} />
      {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
    </div>
  </Dialog>;
}

export default function InvitationCardsPage() {
  const { canWrite } = useModuleAccess("CLIENT", "Invitation Cards");
  const { density } = useCompactView();
  const [data, setData] = useState(null);
  // The clients' invitations from designs not marked free, for Payments.
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("designs");
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [editingTerms, setEditingTerms] = useState(null);
  // Mark as paid / not paid, for one row or every ticked one: `{ rows, paid }`.
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const styleLabel = useCallback((key) => data?.styles.find((style) => style.key === key)?.label || key, [data]);

  const load = useCallback(async () => {
    try {
      const [cards, invitations] = await Promise.all([getInvitationCards(), listClientInvitations()]);
      setData(cards?.data || null);
      setPayments(invitations?.data || []);
      setLastUpdated(new Date());
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load the invitation cards.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Opened from the bell's "Invitation to unlock": straight to Payments.
      if (new URLSearchParams(window.location.search).get("tab") === "payments") setTab("payments");
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Ticking payments rows: the table's own Delete, and Mark as paid / not paid above it.
  const bulk = useTableSelection({
    rows: payments || [],
    noun: "invitation",
    onDelete: (ids) => deleteClientInvitations(ids).then(() => ({ deletedIds: ids })),
    onDeleted: () => load(),
    showSuccess,
    showError,
  });

  async function remove() {
    setBusy(true);
    try {
      if (removing.kind === "designs") await removeInvitationDesign(removing.row.id);
      else await removeInvitationSong(removing.row.id);
      showSuccess(removing.kind === "designs" ? "Design removed." : "Song removed.");
      setRemoving(null);
      await load();
    } catch (removeError) {
      showError(removeError.message || "Unable to remove it.");
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    setBusy(true);
    try {
      const result = confirming.rows.length === 1
        ? await markInvitationPaid(confirming.rows[0].id, confirming.paid)
        : await markInvitationsPaid(confirming.rows.map((row) => row.id), confirming.paid);
      showSuccess(result?.message || "Saved.");
      setConfirming(null);
      bulk.clear();
      await load();
    } catch (recordError) {
      showError(recordError.message || "Unable to record the payment.");
    } finally {
      setBusy(false);
    }
  }

  const saved = (message) => { setEditing(null); showSuccess(message); void load(); };
  const text = (id, header, value, width = 160) => ({ id, header, accessorFn: value, cell: ({ row }) => value(row.original) || "—", exportValue: value, width, minWidth: Math.min(width, 110) });
  const actionsColumn = (items) => ({ id: "actions", header: "", accessorFn: () => "", enableColumnFilter: false, enableSorting: false, width: 56, minWidth: 56, cell: ({ row }) => (canWrite ? <OptionsMenu ariaLabel="Actions" items={items(row.original)} /> : null) });

  // One column a fact, as every table in the OS reads: each can be filtered, sorted, hidden and exported.
  const designColumns = useMemo(() => [
    { id: "artwork", header: "Artwork", accessorFn: (row) => row.coverUrl || "", enableColumnFilter: false, width: 90, minWidth: 80, cell: ({ row }) => <button type="button" onClick={(event) => { event.stopPropagation(); setPreviewing(row.original); }} className="block h-12 w-9 overflow-hidden rounded bg-slate-100" aria-label={`View ${row.original.title}`}>
      {row.original.coverType === "video" ? <video src={row.original.coverUrl} poster={row.original.posterUrl || undefined} className="h-full w-full object-cover" muted /> : row.original.coverUrl ? <img src={row.original.coverUrl} alt="" className="h-full w-full object-cover" /> : null}
    </button> },
    text("title", "Name", (row) => row.title, 180),
    text("shoots", "Shoots", (row) => shootsLabel(row.shootTypes), 260),
    text("theme", "Theme", (row) => styleLabel(row.style), 110),
    text("price", "Price", (row) => (row.isFree ? "Free" : row.price ? rupees(row.price) : "No price set"), 120),
    text("uses", "Used by", (row) => `${row.uses || 0} client${row.uses === 1 ? "" : "s"}`, 110),
    { ...text("status", "Status", (row) => (row.isActive ? "Showing to clients" : "Switched off"), 160), cell: ({ row }) => <TableCellValue value={row.original.isActive ? "Showing to clients" : "Switched off"} type="status" statusStyles={{ "Showing to clients": "bg-emerald-500", "Switched off": "bg-slate-400" }} /> },
    actionsColumn((row) => [
      { label: "View", onSelect: () => setPreviewing(row) },
      { label: "Edit", onSelect: () => setEditing({ kind: "designs", row }) },
      { label: "Remove", onSelect: () => setRemoving({ kind: "designs", row }) },
    ]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite, styleLabel]);

  const songColumns = useMemo(() => [
    text("title", "Name", (row) => row.title, 200),
    text("artist", "Artist", (row) => row.artist, 160),
    text("shoots", "Shoots", (row) => shootsLabel(row.shootTypes), 240),
    { id: "preview", header: "Listen", accessorFn: () => "", enableColumnFilter: false, enableSorting: false, width: 280, minWidth: 240, cell: ({ row }) => <audio controls src={row.original.audioUrl} preload="none" className="h-8 w-full" onClick={(event) => event.stopPropagation()} /> },
    { ...text("status", "Status", (row) => (row.isActive ? "Showing to clients" : "Switched off"), 160), cell: ({ row }) => <TableCellValue value={row.original.isActive ? "Showing to clients" : "Switched off"} type="status" statusStyles={{ "Showing to clients": "bg-emerald-500", "Switched off": "bg-slate-400" }} /> },
    actionsColumn((row) => [
      { label: "Edit", onSelect: () => setEditing({ kind: "songs", row }) },
      { label: "Remove", onSelect: () => setRemoving({ kind: "songs", row }) },
    ]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite]);

  const paymentColumns = useMemo(() => [
    text("names", "Client", (row) => row.names || "Client", 200),
    text("shoot", "Shoot", (row) => row.shootName, 150),
    text("eventId", "Event ID", (row) => row.eventId, 200),
    { id: "card", header: "Card", accessorFn: (row) => row.design.picture || "", enableColumnFilter: false, width: 70, minWidth: 64, cell: ({ row }) => <div className="h-12 w-9 overflow-hidden rounded bg-slate-100">{row.original.design.picture ? <img src={row.original.design.picture} alt="" className="h-full w-full object-cover" /> : null}</div> },
    text("design", "Design", (row) => row.design.title, 150),
    text("price", "Price", (row) => (row.price ? `${rupees(row.price)}${row.ownPrice ? " (this client)" : ""}` : "To confirm"), 150),
    text("edits", "Edits", (row) => `${row.editCount} / ${row.editLimit}${row.status === "paid" ? " · unlimited now" : ""}`, 150),
    { ...text("status", "Status", (row) => PAYMENT_STATUS[row.status].label, 150), cell: ({ row }) => <TableCellValue value={PAYMENT_STATUS[row.original.status].label} type="status" statusStyles={{ "Asked to unlock": "bg-amber-500", "Not paid": "bg-slate-400", Paid: "bg-emerald-500" }} /> },
    text("when", "Updated", (row) => shortWhen(row.paidAt || row.requestedAt || row.updatedAt), 150),
    actionsColumn((row) => [
      ...(row.status === "paid" ? [{ label: "Mark as not paid", onSelect: () => setConfirming({ rows: [row], paid: false }) }] : [{ label: "Mark as paid", onSelect: () => setConfirming({ rows: [row], paid: true }) }, { label: "Edit price and edits", onSelect: () => setEditingTerms(row) }]),
    ]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite]);

  const tables = {
    designs: { columns: designColumns, rows: data?.templates || [], empty: canWrite ? "No designs yet. Add the first - its artwork, the shoots it is for and how it moves." : "No designs yet.", label: "Invitation designs" },
    songs: { columns: songColumns, rows: data?.songs || [], empty: canWrite ? "No songs yet. Add a song clients can set on their invitation." : "No songs yet.", label: "Invitation songs" },
    payments: { columns: paymentColumns, rows: payments || [], empty: "Nothing yet. A client's request to unlock an invitation shows here.", label: "Invitation payments" },
  };
  const current = tables[tab];
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "-";
  const ticked = bulk.selectedRows;

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Invitation Cards"
      actions={canWrite ? (tab === "payments"
        ? (ticked.length ? <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">{ticked.length} selected</span>
          <Button type="button" variant="primary" onClick={() => setConfirming({ rows: ticked, paid: true })}>Mark as paid</Button>
          <Button type="button" onClick={() => setConfirming({ rows: ticked, paid: false })}>Mark as not paid</Button>
        </div> : null)
        : <Button type="button" variant="primary" onClick={() => setEditing({ kind: tab, row: null })} disabled={!data}>{tab === "designs" ? "Add design" : "Add song"}</Button>) : null}
      tabs={[
        { id: "designs", label: "Designs", count: data ? data.templates.length : undefined },
        { id: "songs", label: "Songs", count: data ? data.songs.length : undefined },
        { id: "payments", label: "Payments", count: payments ? payments.filter((row) => row.status === "requested").length : undefined },
      ]}
      tabValue={tab}
      onTabChange={(next) => { setTab(next); bulk.clear(); }}
      tabsAriaLabel="Designs, songs or payments"
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {error ? <p className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        <div className="flex min-h-0 min-w-0 flex-1">
          <DataTable
            key={tab}
            columns={current.columns}
            data={current.rows}
            density={density}
            loading={!data && !error}
            loadingMessage="Loading invitation cards..."
            emptyMessage={current.empty}
            noMatchMessage="Nothing matches."
            onVisibleRowsChange={setTableStats}
            onRowDoubleClick={(row) => { if (!canWrite) return; if (tab === "payments") { if (row.status !== "paid") setEditingTerms(row); } else setEditing({ kind: tab, row }); }}
            ariaLabel={current.label}
            features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: `invitation-${tab}` }, ...(tab === "payments" ? { selection: bulk.selection } : {}) }}
          />
        </div>
      </DataTableShell>
    </div>

    {editing?.kind === "designs" && data ? <DesignForm design={editing.row} styles={data.styles} groups={data.shootGroups} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    {editing?.kind === "songs" && data ? <SongForm song={editing.row} groups={data.shootGroups} seconds={data.songSeconds} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    {editingTerms ? <TermsForm row={editingTerms} onClose={() => setEditingTerms(null)} onSaved={(message) => { setEditingTerms(null); showSuccess(message); void load(); }} /> : null}
    {previewing ? <Dialog
      title={previewing.title}
      description={`${styleLabel(previewing.style)} · ${shootsLabel(previewing.shootTypes)}`}
      size="md"
      onClose={() => setPreviewing(null)}
      footer={<Button type="button" onClick={() => setPreviewing(null)}>Close</Button>}
    >
      {previewing.coverType === "video"
        ? <video src={previewing.coverUrl} poster={previewing.posterUrl || undefined} className="mx-auto max-h-[70vh] w-auto rounded-lg" autoPlay muted loop playsInline />
         
        : previewing.coverUrl ? <img src={previewing.coverUrl} alt={previewing.title} className="mx-auto max-h-[70vh] w-auto rounded-lg" /> : null}
    </Dialog> : null}
    {removing ? <ConfirmDialog
      title={`Remove "${removing.row.title}"?`}
      message={removing.kind === "designs"
        ? "Clients stop seeing it at once. Invitations already made from it keep playing as they were shared."
        : "Clients stop seeing it at once. Invitations already using it keep playing it."}
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={busy}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void remove()}
    /> : null}
    {confirming ? <ConfirmDialog
      title={confirming.paid
        ? (confirming.rows.length > 1 ? `Mark ${confirming.rows.length} invitations as paid?` : confirming.rows[0].price ? `Mark ${rupees(confirming.rows[0].price)} as paid?` : "Mark as paid?")
        : (confirming.rows.length > 1 ? `Mark ${confirming.rows.length} invitations as not paid?` : "Take this payment back?")}
      message={confirming.paid
        ? `${confirming.rows.length > 1 ? "These clients" : `${confirming.rows[0].names || "The client"} (${confirming.rows[0].eventId})`} can share and edit freely at once. Record this only once the payment has reached the studio.`
        : "Locked again: the link stops opening for guests until it is paid."}
      confirmLabel={confirming.paid ? "Mark as paid" : "Mark as not paid"}
      busyLabel="Saving..."
      loading={busy}
      onCancel={() => setConfirming(null)}
      onConfirm={() => void record()}
    /> : null}
  </section>;
}
