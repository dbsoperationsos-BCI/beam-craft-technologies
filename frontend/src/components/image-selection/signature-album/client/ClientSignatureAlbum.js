"use client";

import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import { expiredLinkFrom } from "@/lib/expiredLink.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import Loader from "@/components/shared/Loader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { copyToClipboard } from "@/lib/clipboard";
import AlbumFrame from "./AlbumFrame";
import AlbumPinGate from "./AlbumPinGate";
import SignatureAlbumView from "./SignatureAlbumView";
import { getAlbumMeta, verifyAlbumPin, getAlbumContent, listAlbumChapterItems, startAlbumDownload, getAlbumDownloadStatus, albumDownloadUrl, fetchAlbumImage } from "@/services/image-selection/signature-album-public.service";
import { getAlbumSession, setAlbumSession, clearAlbumSession } from "@/lib/signatureAlbumSession";

/**
 * The client's Signature Album: /a/<code>.
 *
 * Meta first (the PIN screen needs only that), the PIN if the album asks for one, then the album
 * itself through `SignatureAlbumView` - the same rendering the studio's preview draws - with each
 * chapter's photos arriving as the reader scrolls. Download Album and share appear only where the
 * studio allowed them.
 */
function Unavailable({ title, message }) {
  return <main className="grid min-h-[100svh] place-items-center bg-white px-6 text-center text-slate-800">
    <div><h1 className="text-2xl font-light tracking-wide">{title}</h1><p className="mt-3 text-sm text-slate-500">{message}</p></div>
  </main>;
}

// How long the control reads "Downloading…" after the PDF is handed to the browser. The page
// cannot see the browser's download finish, so this is a hand-over, not a progress.
const DOWNLOAD_HANDOVER_MS = 10000;
// How often the page asks whether the album's PDF is ready while the server prints it.
const DOWNLOAD_POLL_MS = 2000;

const downloadFailed = () => new URLSearchParams(window.location.search).get("download") === "failed";
const withoutDownloadFlag = () => { const url = new URL(window.location.href); url.searchParams.delete("download"); return `${url.pathname}${url.search}${url.hash}`; };

export default function ClientSignatureAlbum({ code }) {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [pinError, setPinError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [content, setContent] = useState(null);
  const [loadingMore, setLoadingMore] = useState({});
  const [downloadState, setDownloadState] = useState("idle");
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const sessionRef = useRef(null);
  const handoverTimer = useRef(null);
  const pollTimer = useRef(null);
  const loader = useCallback((path, signal) => fetchAlbumImage(path, sessionRef.current, signal), []);

  const applySession = useCallback((token) => { sessionRef.current = token; setSessionToken(token); }, []);
  const reopened = useRef(false);
  useEffect(() => () => { window.clearTimeout(handoverTimer.current); window.clearTimeout(pollTimer.current); }, []);

  // A download the server refused comes back here as `?download=failed` (`backToPage`) rather than
  // as an error page in place of the album: said once, and taken off the address.
  useEffect(() => {
    if (!downloadFailed()) return undefined;
    // The address is tidied with the notice, not before it: a run cancelled before its timer fires
    // (React's checks run every effect twice) must leave the flag for the run that shows it.
    const timer = window.setTimeout(() => {
      showError("The album download could not be completed. Please try again.");
      window.history.replaceState(window.history.state, "", withoutDownloadFlag());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showError]);

  // Meta, then a remembered session.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await getAlbumMeta(code);
        if (!active) return;
        setMeta(response.data);
        const remembered = getAlbumSession(code);
        if (remembered) applySession(remembered);
      } catch (failure) { if (active) setError({ status: failure.status, message: failure.message, expiredLink: failure.expiredLink }); }
    })();
    return () => { active = false; };
  }, [code, applySession]);

  /*
   * A session the server no longer accepts - expired, or opened before the PIN was reset or switched
   * on or off - sends the reader back to the PIN rather than to an error. The album is asked afresh
   * first, and only then is the session let go, so the opening below decides on what the album is
   * now: one that has no PIN is reopened at once, one that has gained a PIN shows the PIN screen.
   * Asked once in a row, so a refusal cannot loop.
   */
  const sessionRefused = useCallback(async () => {
    clearAlbumSession(code);
    if (!reopened.current) {
      reopened.current = true;
      try { setMeta((await getAlbumMeta(code)).data); } catch (failure) { setError({ status: failure.status, message: failure.message, expiredLink: failure.expiredLink }); }
    }
    applySession(null);
  }, [code, applySession]);

  // An album without a PIN opens its own session - at first, and again when a remembered one has
  // lapsed, where the reader used to be shown PIN boxes for an album that has no PIN. Twice at most
  // per visit, so a server that keeps refusing cannot keep this asking.
  const autoOpens = useRef(0);
  useEffect(() => {
    if (!meta || meta.requiresPin || sessionToken) return undefined;
    let active = true;
    (async () => {
      try {
        if (autoOpens.current >= 2) throw Object.assign(new Error("Unable to open the album. Please refresh and try again."), { status: 401 });
        const opened = await verifyAlbumPin(code, "");
        if (!active) return;
        autoOpens.current += 1;
        setAlbumSession(code, opened.data.sessionToken);
        applySession(opened.data.sessionToken);
      } catch (failure) { if (active) setError({ status: failure.status, message: failure.message, expiredLink: failure.expiredLink }); }
    })();
    return () => { active = false; };
  }, [code, meta, sessionToken, applySession]);

  // The album, once there is a session. A session the server no longer accepts sends the reader
  // back to the PIN rather than to an error.
  useEffect(() => {
    if (!sessionToken) return undefined;
    let active = true;
    (async () => {
      try {
        const album = await getAlbumContent(code, sessionToken);
        if (!active) return;
        reopened.current = false;
        setContent(album.data);
      } catch (failure) {
        if (!active) return;
        if (failure.status === 401) sessionRefused();
        else setError({ status: failure.status, message: failure.message, expiredLink: failure.expiredLink });
      }
    })();
    return () => { active = false; };
  }, [code, sessionToken, sessionRefused]);

  async function verify(pin) {
    setVerifying(true); setPinError("");
    try {
      const response = await verifyAlbumPin(code, pin);
      setAlbumSession(code, response.data.sessionToken);
      applySession(response.data.sessionToken);
    } catch (failure) { setPinError(failure.message || "Incorrect PIN."); }
    finally { setVerifying(false); }
  }

  const loadMore = useCallback(async (chapter) => {
    if (loadingMore[chapter.id]) return;
    setLoadingMore((current) => ({ ...current, [chapter.id]: true }));
    try {
      const response = await listAlbumChapterItems(code, sessionRef.current, chapter.id, { offset: chapter.items.length });
      setContent((current) => ({ ...current, chapters: current.chapters.map((row) => (row.id === chapter.id ? { ...row, items: [...row.items, ...response.data.items.filter((item) => !row.items.some((existing) => existing.id === item.id))] } : row)) }));
    } catch (failure) { showError(failure.message || "Unable to load more photos."); }
    finally { setLoadingMore((current) => ({ ...current, [chapter.id]: false })); }
  }, [code, loadingMore, showError]);

  /*
   * Download Album: the whole designed album as one PDF. The server prints it in the background, so
   * the session starts it - the answer that can say no - and the control reads "Preparing album..."
   * while the page asks every couple of seconds whether it is ready. Once it is, the browser is
   * pointed at the PDF's URL and saves it itself, so the page never holds the bytes. A second press
   * while one is under way is ignored rather than queued, and the server prints an album once
   * however many times it is asked.
   */
  async function downloadAlbum() {
    if (downloadState === "preparing" || downloadState === "downloading") return;
    setDownloadState("preparing");
    window.clearTimeout(pollTimer.current);
    const fail = (failure) => {
      // A session that lapsed sends the reader back to the PIN; the download is let go too, or its
      // button stayed on "preparing" once they were back in.
      if (failure.status === 401) { window.clearTimeout(pollTimer.current); setDownloadState("idle"); sessionRefused(); return; }
      setDownloadState("error");
      showError(failure.message || "Unable to prepare the album download. Please try again.");
    };
    let restarted = false;
    const check = async () => {
      try {
        const status = (await getAlbumDownloadStatus(code, sessionRef.current)).data;
        if (status.status === "ready") {
          showSuccess("Your album is ready - downloading now.");
          window.location.assign(albumDownloadUrl(code, status.ticket));
          setDownloadState("downloading");
          window.clearTimeout(handoverTimer.current);
          handoverTimer.current = window.setTimeout(() => setDownloadState("idle"), DOWNLOAD_HANDOVER_MS);
          return;
        }
        if (status.status === "failed") { fail(new Error("The album could not be prepared. Please try again.")); return; }
        // Gone meanwhile - the album was edited, or the file was cleared - so it is started once more.
        if (status.status === "idle") { if (restarted) { fail(new Error("The album could not be prepared. Please try again.")); return; } restarted = true; await startAlbumDownload(code, sessionRef.current); }
        pollTimer.current = window.setTimeout(check, DOWNLOAD_POLL_MS);
      } catch (failure) { fail(failure); }
    };
    try {
      await startAlbumDownload(code, sessionRef.current);
      showNotice("Preparing your album as one PDF. A large album can take a few minutes - you can keep browsing.");
      await check();
    } catch (failure) { fail(failure); }
  }
  async function share() {
    const url = content?.clientUrl || window.location.href;
    const text = `${content?.title || "Signature Album"} - ${content?.studioName || ""}`.trim();
    if (navigator.share) { try { await navigator.share({ title: content?.title, text, url }); return; } catch { /* dismissed */ } }
    if (await copyToClipboard(url)) showSuccess("Album link copied."); else showError("Unable to copy the link.");
  }

  // An expired album is the shared expired page, asked before the PIN screen ever is; anything
  // else - an unknown or unpublished link - is still this album's own "not available".
  const expiredAlbum = error ? expiredLinkFrom(error) : null;
  if (expiredAlbum) return <ExpiredClientLink {...expiredAlbum} />;
  if (error) return <Unavailable title="This album is not available" message={error.message} />;
  if (!meta) return <main className="grid min-h-[100svh] place-items-center bg-white"><Loader label="Opening your album..." size="lg" /></main>;
  // An album without a PIN never shows the PIN screen: its session is being opened (above).
  if (!sessionToken) return meta.requiresPin
    ? <AlbumPinGate meta={meta} onVerify={verify} error={pinError} busy={verifying} />
    : <main className="grid min-h-[100svh] place-items-center bg-white"><Loader label="Opening your album..." size="lg" /></main>;
  if (!content) return <AlbumFrame design={meta.design} className="grid min-h-[100svh] place-items-center"><Loader label="Loading your story..." size="lg" /></AlbumFrame>;

  return <SignatureAlbumView content={content} loader={loader} onDownloadAlbum={downloadAlbum} downloadState={downloadState} onShare={share} onLoadMore={loadMore} loadingMore={loadingMore}>
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </SignatureAlbumView>;
}
