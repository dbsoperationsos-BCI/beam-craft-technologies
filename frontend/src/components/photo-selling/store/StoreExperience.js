"use client";

import AddShoppingCart from "@mui/icons-material/AddShoppingCart";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import ShoppingBagOutlined from "@mui/icons-material/ShoppingBagOutlined";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import Lightbox from "@/components/shared/Lightbox";
import Loader from "@/components/shared/Loader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import GuestEventFooter from "@/components/ai-feature/guest/GuestEventFooter";
import GuestEventHeader from "@/components/ai-feature/guest/GuestEventHeader";
import GuestPhotoGrid from "@/components/ai-feature/guest/GuestPhotoGrid";
import MobileEventHero from "@/components/ai-feature/guest/MobileEventHero";
import { PAGE_CONTAINER } from "@/components/ai-feature/guest/guestActions";
import GuestStatusScreen from "@/components/ai-feature/guest/GuestStatusScreen";
import GuestSelfies from "@/components/shared/GuestSelfies";
import { openCashfreeCheckout } from "@/lib/cashfreeCheckout";
import { cartKey, clearStoreSession, formatMoney, loadCart, loadStoreSession, ORDER_STATUS_LABELS, saveCart, saveOrderKey, saveStoreSession, toggleInCart } from "@/lib/photoSelling.mjs";
import { checkout, deleteSelfieSearch, fetchStoreSelfieThumbnail, getLatestSelfieSearch, getSelfieSearch, getStore, getStoreGuest, getStoreGuestPhotos, listMyOrders, listStoreSelfies, openStoreSession, removeStoreSelfie, stopStoreWhatsApp } from "@/services/photo-selling/photo-store-public.service";
import StoreButton from "./StoreButton";
import StoreCart from "./StoreCart";
import StoreGuestDetails from "./StoreGuestDetails";
import StoreLanding from "./StoreLanding";
import StoreMatchesSummary from "./StoreMatchesSummary";
import StoreSelfieSearch from "./StoreSelfieSearch";

/**
 * The guest store at /s/[code]: the landing page (and its PIN, where there is one), then a selfie -
 * the only way in - then the guest's own matched photos, a cart and checkout through Cashfree.
 *
 * The gallery is never shown whole. The page holds no list of the gallery's photos at all: it asks
 * the server for its own search's matches, and the server answers with those and nothing else (and
 * refuses a cart naming any other photo). Opening the store is not a match: until a selfie has
 * matched, there is nothing to see or buy. No match, or a failed search, is said plainly with a way
 * to try again - never filled in with other photos.
 *
 * Every photo shown is a watermarked preview; what a buyer gets is the photo's original, downloaded
 * from their order once the payment is confirmed. The device keeps its store session, its cart and its
 * order keys in local storage (`lib/photoSelling.mjs`), and the server keeps its latest search's
 * matches for 24 hours, so coming back from Cashfree, or later today, finds the guest's photos where
 * they were.
 *
 * The first screen is always the login (StoreLanding, the AI Feature's guest login page): every guest
 * gives a name and WhatsApp number - no code - with the PIN where set and the WhatsApp tick where the
 * gallery sends photo-match messages (`meta.whatsapp.offered`); the selfie page comes after it. A
 * session this device kept is checked with the server before anything behind the login is shown, and
 * a session the server refuses (expired, another gallery's, forged) - then or on any later call -
 * returns the guest to the login with a notice. A device whose session predates the login asking for
 * the details is asked once (StoreGuestDetails). A guest who asked to be told keeps
 * their matches beyond the 24 hours, photos uploaded later included (`getStoreGuestPhotos`), and with
 * none yet is told they will hear on WhatsApp. "Your Selfies" (GuestSelfies) lists the guest's up to ten
 * selfies - every one is searched with, Add Selfie runs another search, and removing one drops the
 * photos only it found.
 */
export default function StoreExperience({ code }) {
  const router = useRouter();
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [meta, setMeta] = useState(null);
  const [failure, setFailure] = useState(null);
  const [session, setSession] = useState(null);
  // True until this device's kept session (if any) has been checked with the server.
  const [restoring, setRestoring] = useState(true);
  // The guest's search: null (none yet), { status: "NO_MATCH" }, or the COMPLETED search with its photos.
  const [search, setSearch] = useState(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [searchingAgain, setSearchingAgain] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [viewing, setViewing] = useState(-1);
  const [cart, setCart] = useState(() => loadCart(code));
  const [cartOpen, setCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [orders, setOrders] = useState([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  // The registered guest where the store asks for one: undefined while asked, null when none yet.
  const [guest, setGuest] = useState(undefined);
  const [stopping, setStopping] = useState(false);
  // Your Selfies: read again whenever a search adds one or one is removed.
  const [selfies, setSelfies] = useState(null);
  const [selfieVersion, setSelfieVersion] = useState(0);
  const offered = Boolean(meta?.whatsapp?.offered);

  const loadMeta = useCallback(async () => {
    setFailure(null);
    try { const response = await getStore(code); setMeta(response.data); }
    catch (caught) { setFailure(caught); }
  }, [code]);
  useEffect(() => { const timer = setTimeout(() => void loadMeta(), 0); return () => clearTimeout(timer); }, [loadMeta]);
  useEffect(() => { saveCart(code, cart); }, [code, cart]);

  /** The server refused the session: back to the login, with nothing of the old visit left on screen. */
  const sessionLost = useCallback(() => {
    clearStoreSession(code);
    setSession(null); setGuest(undefined); setSearch(null); setSelfies(null); setOrders([]);
    showError("Your session has ended. Please log in again.");
  }, [code, showError]);

  /** A search's photos, with the guest's kept matches (later uploads') added once each where the store keeps them. */
  const withKept = useCallback(async (activeSession, photos = []) => {
    const kept = (await getStoreGuestPhotos(code, activeSession).catch(() => null))?.data?.photos || [];
    const seen = new Set(photos.map((photo) => photo.photoId));
    return [...photos, ...kept.filter((photo) => !seen.has(photo.photoId))];
  }, [code]);

  const showResults = useCallback(async (activeSession, searchId) => {
    setLoadingResults(true);
    try {
      const response = searchId ? await getSelfieSearch(code, activeSession, searchId) : { data: { id: "kept", status: "COMPLETED", photos: [] } };
      response.data = { ...response.data, photos: await withKept(activeSession, response.data.photos) };
      if (!response.data.photos.length) { setSearch(searchId ? response.data : null); setSearchingAgain(false); return; }
      setSearch({ ...response.data, status: "COMPLETED" });
      setSearchingAgain(false);
      // A cart only ever holds this device's matches; anything no longer matched leaves it.
      // Picture addresses expire, so the cart takes the fresh ones from these results.
      const matched = new Map((response.data.photos || []).map((photo) => [photo.photoId, photo]));
      setCart((current) => current.filter((line) => matched.has(line.photoId)).map((line) => ({ ...line, thumbnailUrl: matched.get(line.photoId).thumbnailUrl })));
    } catch (caught) {
      if (caught.status === 401) sessionLost(); else { setSearch(null); showError("We couldn't load your photos. Please search again."); }
    } finally {
      setLoadingResults(false);
    }
  }, [code, showError, sessionLost, withKept]);

  // A session this device already holds is checked with the server first (who the guest is), then
  // opens straight onto its latest results, if it has any. None kept, or one refused: the login.
  useEffect(() => {
    if (!meta || session) return undefined;
    const timer = setTimeout(async () => {
      const saved = loadStoreSession(code);
      if (!saved) { setRestoring(false); return; }
      let current = null;
      try { current = (await getStoreGuest(code, saved)).data.guest || null; }
      catch (caught) { if (caught.status === 401) { sessionLost(); setRestoring(false); return; } }
      setGuest(current);
      setSession(saved);
      setRestoring(false);
      try {
        const response = await getLatestSelfieSearch(code, saved);
        const latest = response.data.search;
        if (latest?.status === "COMPLETED") await showResults(saved, latest.id);
        else {
          // No search today: a guest's selfies may have matches - their earlier searches' and later uploads'.
          await showResults(saved, null);
          if (latest?.status === "NO_MATCH") setSearch((current) => current || { status: "NO_MATCH" });
        }
      } catch (caught) {
        if (caught.status === 401) sessionLost();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [meta, session, code, showResults, sessionLost, offered]);

  // The guest's details: every guest has them; a session from before the first screen asked is asked now.
  useEffect(() => {
    if (!session || guest !== undefined) return undefined;
    let live = true;
    getStoreGuest(code, session).then((response) => { if (live) setGuest(response.data.guest || null); }).catch((caught) => { if (!live) return; if (caught.status === 401) sessionLost(); else setGuest(null); });
    return () => { live = false; };
  }, [code, session, guest, sessionLost]);

  useEffect(() => {
    if (!session || !guest) return undefined;
    let live = true;
    listStoreSelfies(code, session).then((response) => { if (live) setSelfies(response.data); }).catch(() => {});
    return () => { live = false; };
  }, [code, session, guest, selfieVersion]);
  const loadSelfie = useCallback((id) => fetchStoreSelfieThumbnail(code, session, id), [code, session]);

  /** Removes one selfie; the list is the photos the remaining ones match, or the waiting message. */
  async function removeSelfie(id) {
    try {
      const response = await removeStoreSelfie(code, session, id);
      if (response.data?.guest) setGuest(response.data.guest);
      const photos = await withKept(session, []);
      const remaining = response.data?.guest?.selfieCount ?? 0;
      setSearch(photos.length ? { id: "kept", status: "COMPLETED", photos } : remaining ? { status: "NO_MATCH" } : null);
      setCart((current) => current.filter((line) => photos.some((photo) => photo.photoId === line.photoId)));
      setSelfieVersion((value) => value + 1);
      showSuccess("Selfie removed.");
    } catch (caught) {
      showError(caught.message || "We couldn't remove that selfie. Please try again.");
      throw caught;
    }
  }

  async function stopWhatsApp() {
    setStopping(true);
    try { const response = await stopStoreWhatsApp(code, session); setGuest(response.data.guest); showSuccess("WhatsApp messages stopped. The face from your selfie is no longer kept."); }
    catch (caught) { showError(caught.message || "We couldn't stop the messages. Please try again."); }
    finally { setStopping(false); }
  }

  useEffect(() => {
    if (!session) return;
    listMyOrders(code, session).then((response) => setOrders(response.data || [])).catch(() => setOrders([]));
  }, [code, session]);

  /** The login: opens the store session, or throws what the server said for the login card to show. */
  async function enter(details) {
    const response = await openStoreSession(code, details);
    saveStoreSession(code, response.data.session);
    setGuest(response.data.guest || null);
    setSession(response.data.session);
    window.scrollTo({ top: 0 });
  }

  const inCart = useMemo(() => new Set(cart.map(cartKey)), [cart]);
  const toggle = (photo) => setCart((current) => toggleInCart(current, { photoId: photo.photoId, thumbnailUrl: photo.thumbnailUrl }));
  const dropUnavailable = (ids, message) => {
    setCart((current) => current.filter((line) => !ids.includes(line.photoId)));
    showError(`${message} We've taken ${ids.length === 1 ? "it" : "them"} out of your cart.`);
  };
  async function forgetSearch() {
    setForgetting(true);
    try {
      if (search?.id && search.id !== "kept") await deleteSelfieSearch(code, session, search.id);
      setSearch(null);
      setCart([]);
      setConfirmForget(false);
      showSuccess("Your search was deleted from this gallery.");
    } catch (caught) {
      showError(caught.message || "Your search couldn't be deleted. Please try again.");
    } finally {
      setForgetting(false);
    }
  }

  async function pay(buyer) {
    setCheckingOut(true);
    setCheckoutError("");
    try {
      const response = await checkout(code, session, { items: cart, buyer });
      const { orderRef, orderKey, checkout: started } = response.data;
      saveOrderKey(code, orderRef, orderKey);
      if (started.paid) { router.push(`/s/${encodeURIComponent(code)}/orders/${orderRef}`); return; }
      await openCashfreeCheckout(started);
    } catch (caught) {
      const unavailable = caught?.data?.details?.unavailable;
      if (caught.status === 409 && Array.isArray(unavailable)) dropUnavailable(unavailable, caught.message);
      else setCheckoutError(caught.message || "We couldn't start the payment. Please try again.");
      setCheckingOut(false);
    }
  }

  if (failure) return <GuestStatusScreen status={failure.status} message={failure.message} failure={failure} onRetry={loadMeta} subject="gallery" />;
  if (!meta) return <GuestStatusScreen loading loadingLabel="Opening the gallery..." />;
  if (!session) return restoring
    ? <GuestStatusScreen loading loadingLabel="Opening the gallery..." />
    : <><StoreLanding meta={meta} onEnter={enter} /><FloatingNotice notice={notice} onClose={clearNotice} /></>;

  const accent = meta.accentColor;
  const matched = search?.status === "COMPLETED" && !searchingAgain ? (search.photos || []) : null;
  const gridItems = (matched || []).map((photo) => ({ ...photo, id: photo.photoId }));
  const viewed = viewing >= 0 && matched ? matched[viewing] : null;

  const overlay = (photo) => {
    const added = inCart.has(cartKey(photo));
    return <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 rounded-b-xl bg-gradient-to-t from-black/60 to-transparent p-1.5 md:rounded-b-lg">
      <span className="pointer-events-none rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{formatMoney(photo.pricePaise, meta.currency)}</span>
      <IconButton label={added ? "Remove from cart" : "Add to cart"} onClick={() => toggle(photo)} size="md" shape="circle"
        className="pointer-events-auto shadow backdrop-blur"
        style={added ? { backgroundColor: accent || "#ffffff", color: accent ? "#ffffff" : "#171717" } : { backgroundColor: "rgba(0,0,0,0.5)", color: "#ffffff" }}>
        {added ? <CheckRounded style={{ fontSize: 18 }} /> : <AddShoppingCart style={{ fontSize: 17 }} />}
      </IconButton>
    </div>;
  };

  // The AI Feature's guest gallery shell: its header (studio mark, the gallery's name, "Hi <name>")
  // sticky over one scrolling box, the cover strip on a phone, the content pane, its footer. The
  // store's own cart and orders sit in the header's actions; there is no Leave - a store's selfies
  // and matches belong to its session, so leaving would lose them.
  const event = { name: meta.title, startDate: meta.eventDate, location: meta.venue, coverUrl: meta.coverUrl };
  const cartBar = matched && cart.length > 0 && !cartOpen;
  const headerActions = <>
    {orders.length > 0 && <StoreButton size="md" onClick={() => setOrdersOpen(true)} className="hidden sm:inline-flex"><ReceiptLongOutlined style={{ fontSize: 18 }} className="mr-1.5" aria-hidden="true" />My orders</StoreButton>}
    {orders.length > 0 && <IconButton label="My orders" onClick={() => setOrdersOpen(true)} className="sm:hidden"><ReceiptLongOutlined /></IconButton>}
    {matched && <StoreButton size="md" variant="primary" accent={accent} onClick={() => setCartOpen(true)} aria-label={`Cart, ${cart.length} item${cart.length === 1 ? "" : "s"}`}>
      <ShoppingBagOutlined style={{ fontSize: 18 }} className="mr-1.5" aria-hidden="true" />{cart.length > 0 ? cart.length : "Cart"}
    </StoreButton>}
  </>;

  return <div className="flex h-dvh flex-col overflow-y-auto overscroll-contain bg-[#f4f7fb] text-slate-900">
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <GuestEventHeader eventName={meta.title} guest={guest} meta={{ event }} tabs={[]} actions={headerActions} />

    <main className={`${PAGE_CONTAINER} flex-1 py-4 sm:py-6 ${cartBar ? "pb-24 sm:pb-6" : ""}`}>
      <MobileEventHero event={event} />
      {loadingResults
        ? <Loader label="Loading your photos..." className="py-16" />
        : matched
          ? <>
            {guest && selfies && <GuestSelfies selfies={selfies} loadThumbnail={loadSelfie} onRemove={removeSelfie} onAdd={() => setSearchingAgain(true)} className="mb-4 md:mb-5" />}
            <StoreMatchesSummary count={matched.length} onSearchAgain={guest ? undefined : () => setSearchingAgain(true)} onDelete={guest ? undefined : () => setConfirmForget(true)} onStopWhatsApp={guest?.whatsappOn ? stopWhatsApp : undefined} stopping={stopping} />
            <GuestPhotoGrid items={gridItems} hasMore={false} loading={false} loadingMore={false} onLoadMore={() => {}} onOpen={setViewing} resetKey={search.id} curated={gridItems.length <= 5} renderOverlay={overlay} />
          </>
          : guest === undefined
          ? <Loader label="Opening the gallery..." className="py-16" />
          : !guest
          ? <StoreGuestDetails code={code} session={session} accent={accent} offered={offered} onSaved={setGuest} />
          : <>
            {!searchingAgain && selfies?.count > 0 && <GuestSelfies selfies={selfies} loadThumbnail={loadSelfie} onRemove={removeSelfie} onAdd={() => setSearchingAgain(true)} className="mb-4 md:mb-5" />}
            <StoreSelfieSearch code={code} session={session} accent={accent} whatsappOn={Boolean(guest?.whatsappOn)} onStopWhatsApp={guest?.whatsappOn ? stopWhatsApp : undefined} stopping={stopping}
            preparing={Boolean(meta.search?.preparing)} unavailable={meta.search?.available ? "" : meta.search?.reason || "Photo search isn't available right now."}
            noMatch={search?.status === "NO_MATCH" && !searchingAgain}
            onFound={(result) => { setSelfieVersion((value) => value + 1); return showResults(session, result.id); }}
            onNoMatch={() => { setSearch({ status: "NO_MATCH" }); setSearchingAgain(false); setSelfieVersion((value) => value + 1); }}
            onRefresh={loadMeta} onBack={searchingAgain && search?.status === "COMPLETED" ? () => setSearchingAgain(false) : undefined} />
          </>}
    </main>

    <GuestEventFooter />

    {cartBar && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
      <StoreButton variant="primary" accent={accent} className="w-full" onClick={() => setCartOpen(true)}>View cart · {cart.length} item{cart.length === 1 ? "" : "s"}</StoreButton>
    </div>}

    {viewed && <Lightbox src={viewed.previewUrl} alt={`Your photo ${viewing + 1} of ${matched.length}`} title={meta.title} subtitle={`Photo ${viewing + 1} of ${matched.length} · watermarked preview`}
      onClose={() => setViewing(-1)} hasPrev={viewing > 0} hasNext={viewing < matched.length - 1}
      onPrev={() => setViewing((value) => Math.max(0, value - 1))} onNext={() => setViewing((value) => Math.min(matched.length - 1, value + 1))}>
      <StoreButton size="md" variant={inCart.has(cartKey(viewed)) ? "secondary" : "primary"} accent={accent} onClick={() => toggle(viewed)}>
        {inCart.has(cartKey(viewed)) ? "Remove from cart" : `Add to cart · ${formatMoney(viewed.pricePaise, meta.currency)}`}
      </StoreButton>
    </Lightbox>}

    {cartOpen && <StoreCart code={code} session={session} meta={meta} cart={cart} onRemove={(line) => setCart((current) => current.filter((item) => cartKey(item) !== cartKey(line)))}
      onDropUnavailable={dropUnavailable} onCheckout={pay} checkingOut={checkingOut} checkoutError={checkoutError} onClose={() => { if (!checkingOut) setCartOpen(false); }} />}

    {confirmForget && <ConfirmDialog title="Delete your search?" message="Your matched photos are removed from this gallery now, and your cart is emptied. Anything you've already bought stays yours. You can search again with a new selfie at any time."
      confirmLabel="Delete my search" busyLabel="Deleting..." loading={forgetting} onConfirm={forgetSearch} onCancel={() => { if (!forgetting) setConfirmForget(false); }} />}

    {ordersOpen && <Dialog title="My orders" description="Orders made on this device." onClose={() => setOrdersOpen(false)} size="md">
      <ul className="flex flex-col divide-y divide-slate-100">
        {orders.map((order) => <li key={order.orderRef} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{order.orderRef}</p><p className="text-xs text-slate-500">{order.itemCount} item{order.itemCount === 1 ? "" : "s"} · {formatMoney(order.totalPaise, order.currency)} · {ORDER_STATUS_LABELS[order.status] || order.status}</p></div>
          <StoreButton size="sm" onClick={() => router.push(`/s/${encodeURIComponent(code)}/orders/${order.orderRef}`)}>Open</StoreButton>
        </li>)}
      </ul>
    </Dialog>}
  </div>;
}
