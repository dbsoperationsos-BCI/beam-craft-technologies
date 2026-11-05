"use client";
import { useCallback, useState } from "react";
import Logout from "@mui/icons-material/Logout";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { listGuestFolders, listGuestGallery, listGuestMyPhotos, rejectGuestMatch, setGuestRsvp, uploadGuestPhoto, uploadGuestSelfie } from "@/services/ai-feature/ai-feature-public.service";
import { formatEventRange } from "@/lib/aiFeature.mjs";
import FindMyPhotos from "./FindMyPhotos";
import GuestPhotoPane from "./GuestPhotoPane";
import GuestRsvpBar from "./GuestRsvpBar";
import GuestSubEvents from "./GuestSubEvents";
import GuestUploadButton from "./GuestUploadButton";
import { PAGE_SIZE, defaultGuestTab, guestTabsFor, isSessionExpired } from "./guestActions";

/**
 * The event once the guest is in: a bar that stays put with the event, the guest and the tabs,
 * then whichever tab is open. Every call goes through `guard`, so a session the server no longer
 * honours sends the guest back to the join card rather than leaving a broken page.
 */
export default function GuestGallery({ code, session, meta, guest, onGuestChange, onExpired, onLeave, notify }) {
  const branding = useStudioBranding();
  const tabs = guestTabsFor(meta);
  const [tab, setTab] = useState(() => defaultGuestTab(tabs, guest));
  // Bumped when a selfie lands, so My Photos reads again rather than showing the list from before.
  const [mineVersion, setMineVersion] = useState(0);
  const allowSharing = Boolean(meta?.gallery?.allowSharing);
  const eventName = meta?.event?.name;

  const guard = useCallback((error) => { if (isSessionExpired(error)) onExpired(); }, [onExpired]);
  const fetchAll = useCallback((page) => listGuestGallery(code, session, { page, pageSize: PAGE_SIZE }).then((response) => response.data), [code, session]);
  const fetchMine = useCallback((page) => listGuestMyPhotos(code, session, { page, pageSize: PAGE_SIZE }).then((response) => response.data), [code, session]);
  const fetchFolderPage = useCallback((folderId) => (page) => listGuestGallery(code, session, { folderId, page, pageSize: PAGE_SIZE }).then((response) => response.data), [code, session]);
  const listFolders = useCallback(() => listGuestFolders(code, session).then((response) => response.data), [code, session]);

  async function notMe(item) {
    try { await rejectGuestMatch(code, session, item.matchId); onGuestChange({ ...guest, matchedCount: Math.max(0, (guest?.matchedCount || 1) - 1) }); }
    catch (error) { guard(error); notify?.(error.message || "Could not remove that photo.", "error"); throw error; }
  }
  async function rsvp(value) {
    try { const response = await setGuestRsvp(code, session, value); onGuestChange(response.data); notify?.("Thanks - your answer is saved.", "success"); }
    catch (error) { guard(error); notify?.(error.message || "Could not save your answer.", "error"); }
  }
  async function selfie(file) {
    try { const response = await uploadGuestSelfie(code, session, file); if (response.data?.guest) onGuestChange(response.data.guest); setMineVersion((current) => current + 1); return response.data; }
    catch (error) { guard(error); throw error; }
  }
  async function uploadPhoto(file) {
    try { return await uploadGuestPhoto(code, session, file); }
    catch (error) { guard(error); throw error; }
  }
  const showMine = tabs.some((item) => item.id === "mine");
  const showFind = tabs.some((item) => item.id === "find");
  const selfieStatus = guest?.selfieStatus || "NONE";
  function found(result) {
    if (result?.matched) notify?.(`${result.matched} ${result.matched === 1 ? "photo" : "photos"} found.`, "success");
    if (result?.goToMine || (showMine && result?.matched)) setTab("mine");
  }

  const mineEmpty = selfieStatus === "UPLOADED"
    ? <EmptyState title="No photos of you yet" message="New photos are matched automatically as the photographer uploads. Check back in a little while." />
    : <EmptyState title="Find yourself in the photos" message={showFind ? "Share a selfie and we will pick out every photo you appear in." : "The host has not opened selfie search for this event."} action={showFind && <button type="button" onClick={() => setTab("find")} className="inline-flex min-h-11 items-center rounded-full bg-[#7fa4fa] px-5 text-sm font-semibold text-white hover:bg-[#638df0]">Find my photos</button>} />;

  return <div className="flex min-h-dvh flex-col bg-[#f4f7fb]">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <span className="hidden sm:block"><AppLogo variant="clientSelectionMobile" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{eventName}</p>
          <p className="truncate text-xs text-slate-500">{[guest?.name && `Hi ${guest.name}`, formatEventRange(meta?.event?.startDate, meta?.event?.endDate)].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" onClick={onLeave} aria-label="Leave event" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 sm:text-sm"><Logout style={{ fontSize: 16 }} aria-hidden="true" /><span className="hidden sm:inline">Leave</span></button>
      </div>
      {tabs.length > 1 && <nav aria-label="Gallery sections" className="mx-auto w-full max-w-6xl overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-1">
          {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition ${tab === item.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item.label}</button>)}
        </div>
      </nav>}
    </header>

    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">
      {meta?.features?.rsvp && <div className="mb-4"><GuestRsvpBar guest={guest} onChange={rsvp} /></div>}
      {tab === "all" && <GuestPhotoPane listKey="all" fetchPage={fetchAll} onError={guard} eventName={eventName} allowSharing={allowSharing} notify={notify}
        toolbar={(paged) => <>
          <p className="text-sm text-slate-600">{paged.loading ? "" : `${paged.total} ${paged.total === 1 ? "photo" : "photos"}`}</p>
          {meta?.features?.guestUploads && <GuestUploadButton onUpload={uploadPhoto} onDone={paged.reload} notify={notify} />}
        </>}
        empty={<EmptyState title="No photos yet" message="The photographer has not uploaded anything yet. Check back soon." />} />}
      {tab === "mine" && showMine && <GuestPhotoPane listKey={`mine:${selfieStatus}:${mineVersion}`} fetchPage={fetchMine} onError={guard} eventName={eventName} allowSharing={allowSharing} notify={notify} onNotMe={notMe} empty={mineEmpty}
        toolbar={(paged) => <>
          <p className="text-sm text-slate-600">{paged.loading || !paged.total ? "" : `${paged.total} ${paged.total === 1 ? "photo" : "photos"} of you`}</p>
          {showFind && selfieStatus === "UPLOADED" && <button type="button" onClick={() => setTab("find")} className="min-h-10 text-sm font-semibold text-blue-700 underline decoration-blue-200 underline-offset-4">Use a different selfie</button>}
        </>} />}
      {tab === "subEvents" && <GuestSubEvents meta={meta} listFolders={listFolders} fetchFolderPage={fetchFolderPage} onError={guard} allowSharing={allowSharing} notify={notify} />}
      {!tabs.length && <EmptyState title="Nothing to show yet" message="The host has not opened the gallery for guests. Check back later." />}
      {tab === "find" && showFind && <FindMyPhotos guest={guest} onUpload={selfie} canShowMine={showMine} onFound={found} />}
    </main>

    <footer className="border-t border-slate-200 bg-white px-4 py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-3"><AppLogo variant="clientSelectionMobile" />{branding?.studioName && <p className="text-xs text-slate-500">Photos by {branding.studioName}</p>}</div>
        <button type="button" onClick={onLeave} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Logout style={{ fontSize: 16 }} aria-hidden="true" />Leave event</button>
      </div>
    </footer>
  </div>;
}
