"use client";
import { useCallback, useEffect, useState } from "react";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import GuestSelfies from "@/components/shared/GuestSelfies";
import { buildDerivatives } from "@/lib/imageDerivatives.mjs";
import { derivativeOptionsFor } from "@/lib/visualCurationCompression.mjs";
import { fetchGuestSelfieThumbnail, listGuestSelfies, listGuestMyPhotos, removeGuestSelfie, rejectGuestMatch, uploadGuestPhoto, uploadGuestSelfie } from "@/services/ai-feature/ai-feature-public.service";
import FindMyPhotos from "./FindMyPhotos";
import GuestEventFooter from "./GuestEventFooter";
import GuestEventHeader from "./GuestEventHeader";
import GuestUploadButton from "./GuestUploadButton";
import GuestWhatsAppSummary from "./GuestWhatsAppSummary";
import MobileEventHero from "./MobileEventHero";
import MyPhotosTab from "./MyPhotosTab";
import { PAGE_CONTAINER, PAGE_SIZE, defaultGuestTab, guestTabsFor, isSessionExpired, selfieLimitMessage, selfieLimitReached } from "./guestActions";

/**
 * The event once the guest is in: one shell - `GuestEventHeader` sticky at the top, My Photos in a
 * main pane that grows, `GuestEventFooter` after it - on one ordinary page scroll. A guest sees only
 * the photos their own selfie matched; there is no whole-event gallery. My Photos holds the selfie
 * search too, and the event's guest upload when it is open: a guest without a selfie, or
 * one choosing a different selfie, gets `FindMyPhotos` there, and the matches once a selfie is in.
 * A guest with a selfie is shown their matches as they stand - no new search is run on arrival.
 * Every call goes through `guard`, so a
 * session the server no longer honours sends the guest back to the join card rather than leaving
 * a broken page.
 */
export default function GuestGallery({ code, session, meta, guest, onGuestChange, onExpired, onLeave, notify, offerWhatsApp = false }) {
  const tabs = guestTabsFor(meta);
  const [tab, setTab] = useState(() => defaultGuestTab(tabs));
  // Bumped when a selfie lands, so My Photos reads again rather than showing the list from before.
  const [mineVersion, setMineVersion] = useState(0);
  // True while a guest who already has a selfie is choosing a different one.
  const [replacing, setReplacing] = useState(false);
  const allowSharing = Boolean(meta?.gallery?.allowSharing);
  const eventName = meta?.event?.name;

  const guard = useCallback((error) => { if (isSessionExpired(error)) onExpired(); }, [onExpired]);
  const fetchMine = useCallback((page) => listGuestMyPhotos(code, session, { page, pageSize: PAGE_SIZE }).then((response) => response.data), [code, session]);

  async function notMe(item) {
    try { await rejectGuestMatch(code, session, item.matchId); onGuestChange({ ...guest, matchedCount: Math.max(0, (guest?.matchedCount || 1) - 1) }); }
    catch (error) { guard(error); notify?.(error.message || "Could not remove that photo.", "error"); throw error; }
  }
  async function selfie(file, source) {
    try { const response = await uploadGuestSelfie(code, session, file, source); if (response.data?.guest) onGuestChange(response.data.guest); setMineVersion((current) => current + 1); return response.data; }
    catch (error) {
      guard(error);
      // Refused as over the limit (another tab, an older count): show the limit from now on. The
      // route's rate limit is a 429 too, so the message tells the two apart.
      if (Number(error?.status) === 429 && /maximum/i.test(error?.message || "") && guest?.selfieLimit) onGuestChange({ ...guest, selfieUploads: guest.selfieLimit });
      throw error;
    }
  }
  /**
   * A guest's photo is optimized on the phone to the event's own presets (`meta.media`, the pair
   * the studio or the event chose) and only the preview and thumbnail travel - the same rule as a
   * staff upload. A format the phone cannot decode (HEIC on some browsers) goes whole for the
   * server to convert, which is the one documented exception; a photo that decoded but could not
   * be encoded is a failure the guest sees, never a silent upload of the original.
   */
  async function uploadPhoto(file) {
    try {
      let prepared = null;
      try { prepared = await buildDerivatives(file, derivativeOptionsFor("aiFeature", meta?.media)); }
      catch (error) { if (error?.code !== "UNDECODABLE") throw error; }
      return await uploadGuestPhoto(code, session, file, prepared);
    }
    catch (error) { guard(error); throw error; }
  }
  // Your Selfies: the guest's own selfies, read again whenever one is added or removed.
  const [selfies, setSelfies] = useState(null);
  useEffect(() => {
    if (!meta?.features?.selfieSearch) return undefined;
    let live = true;
    listGuestSelfies(code, session).then((response) => { if (live) setSelfies(response.data); }).catch((error) => { if (live) guard(error); });
    return () => { live = false; };
  }, [code, session, mineVersion, meta?.features?.selfieSearch, guard]);
  const loadSelfie = useCallback((id) => fetchGuestSelfieThumbnail(code, session, id), [code, session]);
  async function removeSelfie(id) {
    try { const response = await removeGuestSelfie(code, session, id); if (response.data?.guest) onGuestChange(response.data.guest); setMineVersion((current) => current + 1); notify?.("Selfie removed.", "success"); }
    catch (error) { guard(error); notify?.(error.message || "Could not remove that selfie.", "error"); throw error; }
  }
  const canList = Boolean(meta?.gallery?.showMyPhotos);
  const canFind = Boolean(meta?.features?.selfieSearch);
  const selfieStatus = guest?.selfieStatus || "NONE";
  // A guest whose last selfie failed keeps the matches an earlier one found, so only a guest with
  // neither a selfie nor a match is sent to the search.
  const finding = canFind && (replacing || !canList || (selfieStatus !== "UPLOADED" && !guest?.matchedCount));
  function found(result) {
    setReplacing(false);
    if (result?.matched) notify?.(`${result.matched} ${result.matched === 1 ? "photo" : "photos"} found.`, "success");
    else if (canList && result?.matched === null) notify?.("Your selfie is in. Your photos will appear shortly.", "success");
    else if (canList && result?.matched === 0) notify?.("Your selfie is in. No photos found yet.", "success");
  }

  /*
   * The page's one scroll is this box, not the document. `body` carries `overflow-x: hidden` for
   * the whole application, which makes it the header's scroll container in the browser's eyes - a
   * container that never scrolls, so a `sticky` header inside it scrolled away with the photos.
   * Giving the gallery a box of exactly the window's height that scrolls itself puts the header
   * in a container that does scroll, and it stays put. Still one scrollbar: the document has
   * nothing left to scroll.
   */
  return <div className="flex h-dvh flex-col overflow-y-auto overscroll-contain bg-[#f4f7fb]">
    <GuestEventHeader eventName={eventName} guest={guest} meta={meta} tabs={tabs} tab={tab} onTabChange={(next) => { setTab(next); setReplacing(false); }} onLeave={onLeave} />

    {/* The pane grows to fill the window, so a short list still puts the footer at the bottom and
        a long one scrolls the page - one scroll, the header staying put over it. */}
    <main className={`${PAGE_CONTAINER} flex-1 py-4 sm:py-6`}>
      {/* The WhatsApp line sits on My Photos, where the guest's own photos are; a join-card box the
          server refused is asked again on whichever tab the guest lands. */}
      {meta?.features?.whatsappSummary && <GuestWhatsAppSummary code={code} session={session} guest={guest} onGuestChange={onGuestChange} notify={notify} onError={guard} showBar={tab === "mine"} startOpen={offerWhatsApp} />}
      {tab === "mine" && <MobileEventHero event={meta?.event} />}
      {/* A guest's own photos go to the studio; one shows here only once their selfie matches it. */}
      {tab === "mine" && meta?.features?.guestUploads && <div className="mb-3 flex justify-end"><GuestUploadButton onUpload={uploadPhoto} onDone={() => setMineVersion((current) => current + 1)} notify={notify} /></div>}
      {tab === "mine" && canFind && !finding && selfies?.count > 0 && <GuestSelfies selfies={selfies} loadThumbnail={loadSelfie} onRemove={removeSelfie} onAdd={() => setReplacing(true)} className="mb-4 md:mb-5" />}
      {tab === "mine" && (finding
        ? <FindMyPhotos guest={guest} features={meta?.features} onUpload={selfie} onFound={found} replacing={replacing} onReplace={() => setReplacing(true)} onCancel={canList && replacing ? () => setReplacing(false) : undefined} />
        : <MyPhotosTab listKey={`mine:${selfieStatus}:${mineVersion}`} fetchPage={fetchMine} onError={guard} eventName={eventName} allowSharing={allowSharing} notify={notify} onNotMe={notMe} selfieStatus={selfieStatus} whatsappOn={Boolean(meta?.features?.whatsappSummary && guest?.whatsappSummary?.on)} showFind={canFind} limitReached={selfieLimitReached(guest)} limitMessage={selfieLimitMessage(guest)} onFindSelfie={() => setReplacing(true)} />)}
      {!tabs.length && <EmptyState title="Nothing to show yet" message="The host has not opened the gallery for guests. Check back later." />}
    </main>

    <GuestEventFooter />
  </div>;
}
