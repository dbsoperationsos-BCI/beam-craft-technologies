"use client";

import { useCallback, useEffect, useState } from "react";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditCalendarIcon from "@mui/icons-material/EditCalendar";
import EventIcon from "@mui/icons-material/Event";
import LinkIcon from "@mui/icons-material/Link";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { earliestExpiryKey, expiryDateKey, expiryInstant } from "@/lib/proofExpiry";
import {
  getAlbumPublication, grantAlbumRevision, resetAlbumPublicationPin, revealAlbumPublication,
  revokeAlbumPublication, updateAlbumPublicationExpiry,
} from "@/services/image-selection/album-proofs.service";

const absoluteUrl = (clientPath) => (typeof window === "undefined" || !clientPath ? clientPath : `${window.location.origin}${clientPath}`);

// Dates as a person reads them: "19 Oct 2026", not 19/10/2026 — which half the world reads as the
// 10th of the 19th month. The picker keeps its own value; this is only what is shown.
const friendlyDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
const friendlyDateTime = (value) => (value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null);

/**
 * The live client proof, as staff see it: the short client URL with Copy and Open, the 4-digit
 * PIN with Copy and Reset, an editable expiry date, Revoke, and the audited Grant +1 Revision
 * when the client has hit the limit.
 *
 * Nothing here is generated in the browser and nothing is held only in the browser. The URL, the
 * PIN and the expiry are read from the server, and every change is saved before it is shown — so
 * a reload, another tab or another admin sees exactly what this card shows.
 */
export default function PublicationCard({ album, canWrite, freshCredentials, onChanged }) {
  const [publication, setPublication] = useState(null);
  const [credentials, setCredentials] = useState(freshCredentials || null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(null);
  const [confirming, setConfirming] = useState(null);
  // The expiry reads as a date and becomes a picker when asked, so the card is not three input
  // fields deep at rest. Purely presentational — `changeExpiry` below is untouched.
  const [editingExpiry, setEditingExpiry] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await getAlbumPublication(album.id);
      setPublication(response.data);
      return response.data;
    } catch { return null; /* the card simply stays empty */ }
  }, [album.id]);

  /*
   * Reading the card reads: it never publishes, never draws a PIN and never moves an expiry. The
   * credentials come from the reveal endpoint, which decrypts what was stored when the link was
   * published — which is why refreshing this page shows the same PIN it showed before, and why
   * logging out and back in, or restarting the server, shows it too.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await load();
      if (cancelled || !current || !current.active || !canWrite) return;
      try {
        const response = await revealAlbumPublication(album.id);
        if (!cancelled) setCredentials(response.data);
      } catch { /* the Show Link & PIN button stays as the way to try again */ }
    })();
    return () => { cancelled = true; };
  }, [album.id, canWrite, load]);

  useEffect(() => { if (freshCredentials) setCredentials(freshCredentials); }, [freshCredentials]);

  if (!publication) return null;

  async function copy(kind, value) {
    try { await navigator.clipboard.writeText(value); setCopied(kind); window.setTimeout(() => setCopied(null), 1500); }
    catch { setNotice("Unable to copy — copy it manually."); }
  }
  async function reveal() {
    setBusy(true);
    try { const response = await revealAlbumPublication(album.id); setCredentials(response.data); setNotice(""); }
    catch (error) { setNotice(error.message || "Unable to reveal the credentials."); }
    finally { setBusy(false); }
  }
  // The new PIN is saved before it is shown, and the old one is only left on screen when the save
  // failed — so what this card displays is never a PIN the client cannot use.
  async function resetPin() {
    setBusy(true);
    try {
      const response = await resetAlbumPublicationPin(album.id);
      setCredentials((current) => ({ ...(current || {}), pin: response.data.pin }));
      setConfirming(null);
      setNotice("");
    } catch (error) { setNotice(error.message || "Unable to reset the PIN."); setConfirming(null); }
    finally { setBusy(false); }
  }
  async function changeExpiry(dateKey) {
    if (!dateKey || dateKey === expiryDateKey(publication.expiresAt)) return;
    setBusy(true);
    try {
      const response = await updateAlbumPublicationExpiry(album.id, expiryInstant(dateKey));
      setPublication(response.data);
      setCredentials((current) => (current ? { ...current, expiresAt: response.data.expiresAt } : current));
      setNotice("");
      setEditingExpiry(false);
    } catch (error) { setNotice(error.message || "Unable to update the expiry date."); await load(); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true);
    try { await revokeAlbumPublication(album.id); setConfirming(null); setCredentials(null); await load(); onChanged?.(); }
    catch (error) { setNotice(error.message || "Unable to revoke the link."); setConfirming(null); }
    finally { setBusy(false); }
  }
  async function grant() {
    setBusy(true);
    try { await grantAlbumRevision(album.id); setNotice(""); onChanged?.(); }
    catch (error) { setNotice(error.message || "Unable to grant the revision."); }
    finally { setBusy(false); }
  }

  const atLimit = album.revisionLimit != null && album.revisionsUsed >= album.revisionLimit;
  const url = credentials ? absoluteUrl(credentials.clientPath) : null;
  const expiry = friendlyDate(publication.expiresAt);

  // One height and one weight for every control on the card, so a row of them reads as a row.
  const chip = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium";
  const label = "text-xs font-semibold text-slate-800";
  const hint = "text-[11px] text-slate-500";
  const panel = "rounded-xl border border-slate-200 bg-slate-50/70 p-3";
  const readOnly = "flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3";
  const act = "min-h-9 gap-1.5 rounded-lg px-3 text-xs";
  const icon = { fontSize: "small", "aria-hidden": "true" };

  return <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><LinkIcon {...icon} /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">Client Proof</h2>
            <span className={`${chip} bg-slate-100 text-slate-600`}>Revision {publication.revisionNumber}{album.revisionLimit != null ? ` of ${album.revisionLimit}` : ""}</span>
          </div>
          <p className={hint}>Share this proof securely with the client</p>
        </div>
      </div>
      <span className={`${chip} ${publication.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
        <span aria-hidden="true" className={`size-1.5 rounded-full ${publication.active ? "bg-emerald-500" : "bg-slate-400"}`} />
        {publication.active ? "Active" : "Revoked"}
      </span>
    </header>

    {notice && <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">{notice}</p>}

    {canWrite && <div className="space-y-2 p-4">
      {publication.active && !credentials && <Button type="button" size="none" className={act} disabled={busy} onClick={reveal}>Show Link &amp; PIN</Button>}

      {credentials && <div className={panel}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="sm:w-40 sm:shrink-0">
            <p className={label}>Client Link</p>
            <p className={hint}>Share this URL with your client</p>
          </div>
          <span className={readOnly}>
            <LinkIcon {...icon} className="shrink-0 text-slate-400" />
            <span className="truncate text-xs text-slate-700" title={url}>{url}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="none" className={act} onClick={() => copy("url", url)}>
              {copied === "url" ? <><CheckIcon {...icon} /> Copied</> : <><ContentCopyIcon {...icon} /> Copy</>}
            </Button>
            <Button type="button" variant="primary" size="none" className={act} onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
              <OpenInNewIcon {...icon} /> Open
            </Button>
          </div>
        </div>
      </div>}

      <div className="grid gap-2 md:grid-cols-2">
        {credentials && <div className={panel}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className={label}>Access PIN</p>
              <p className={hint}>Client will need this PIN to access</p>
            </div>
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-mono text-lg font-bold tracking-[0.2em] text-slate-900">{credentials.pin}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" size="none" className={act} onClick={() => copy("pin", credentials.pin)}>
              {copied === "pin" ? <><CheckIcon {...icon} /> Copied</> : <><ContentCopyIcon {...icon} /> Copy PIN</>}
            </Button>
            {publication.active && <Button type="button" size="none" className={act} disabled={busy} onClick={() => setConfirming("pin")}>
              <RefreshIcon {...icon} /> Reset PIN
            </Button>}
          </div>
          {/*
            * A six-digit PIN is a link issued before PINs were four digits. It is not rewritten on
            * its own, because a client may already be holding it and would be locked out without
            * being told — Reset is the deliberate act that replaces it, and says so.
            */}
          {credentials.pin && credentials.pin.length !== 4 && <p className="mt-2 text-[11px] text-amber-700">
            Older {credentials.pin.length}-digit PIN. It still works — Reset issues a 4-digit one and stops this one immediately.
          </p>}
        </div>}

        {publication.active && <div className={panel}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className={label}>Link Expiry</p>
              <p className={hint}>This link will stop working on</p>
            </div>
            {!editingExpiry && <span className={`${readOnly} flex-none`}>
              <EventIcon {...icon} className="shrink-0 text-slate-400" />
              <span className="text-xs font-medium text-slate-800">{expiry || "No expiry"}</span>
            </span>}
          </div>
          <div className="mt-2">
            {editingExpiry
              ? <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[10rem] flex-1">
                    <DateField
                      value={expiryDateKey(publication.expiresAt)}
                      onChange={changeExpiry}
                      disabled={busy}
                      minDate={earliestExpiryKey()}
                      restriction="past"
                      placeholder="Select expiry date"
                    />
                  </div>
                  <Button type="button" size="none" className={act} disabled={busy} onClick={() => setEditingExpiry(false)}>Cancel</Button>
                </div>
              : <Button type="button" size="none" className={act} disabled={busy} onClick={() => setEditingExpiry(true)}>
                  <EditCalendarIcon {...icon} /> Change Date
                </Button>}
          </div>
        </div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className={hint}>
          {publication.lastAccessAt
            ? `Opened ${publication.accessCount} time${publication.accessCount === 1 ? "" : "s"} · Last opened ${friendlyDateTime(publication.lastAccessAt)}`
            : "Not opened yet"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {atLimit && <Button type="button" size="none" className={`${act} border-amber-300 text-amber-700 hover:bg-amber-50`} disabled={busy} onClick={grant}>Grant +1 Revision</Button>}
          {publication.active && <Button type="button" size="none" className={`${act} border-red-300 text-red-600 hover:bg-red-50`} disabled={busy} onClick={() => setConfirming("revoke")}>
            <DeleteOutlinedIcon {...icon} /> Revoke Client Link
          </Button>}
        </div>
      </div>
    </div>}

    {confirming === "revoke" && <ConfirmDialog
      title="Revoke the client link?"
      message="The client's link and PIN stop working immediately. Publishing again issues fresh credentials."
      confirmLabel="Revoke Link"
      busyLabel="Revoking..."
      loading={busy}
      onCancel={() => setConfirming(null)}
      onConfirm={revoke}
    />}
    {confirming === "pin" && <ConfirmDialog
      title="Reset PIN?"
      message="The previous PIN will stop working immediately. The client URL and the expiry date stay exactly as they are."
      confirmLabel="Reset PIN"
      busyLabel="Resetting..."
      loading={busy}
      onCancel={() => setConfirming(null)}
      onConfirm={resetPin}
    />}
  </section>;
}
