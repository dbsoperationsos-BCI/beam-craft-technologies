"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { TableCellValue } from "@/components/data-table/tableCells";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ImageUploadField from "@/components/shared/ImageUploadField";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { createClientOffer, getClientAppSettings, listClientOffers, removeClientOffer, saveClientAppSettings, updateClientOffer } from "@/services/sales/client-offers.service";

/*
 * Client Management -> Client Offers: the offers in the clients' app, on two tabs - Home offers (the Home page,
 * where a client can ask about one on WhatsApp) and Referral offers (the Referrals page: what a client
 * gets for referring a friend). The team adds an offer - the studio's own poster, square, portrait or
 * story - and from the moment it is on and within its dates every client sees it. Client app
 * settings, above the offers: the WhatsApp number questions (and claims) go to, and the coins a client
 * earns when a friend they referred books.
 * Behind `CLIENT / Client Offers`: Read to see them, Read / Write to change them.
 */

/*
 * The poster sizes the app shows, the ones the studio already makes for Instagram. Checked by shape,
 * as the server does (client-offers/service.js `POSTER_SIZES`), so the same poster exported larger
 * still counts.
 */
const POSTER_SIZES = [
  { key: "square", label: "Square", width: 1080, height: 1080 },
  { key: "portrait", label: "Portrait", width: 1080, height: 1350 },
  { key: "story", label: "Story", width: 1080, height: 1920 },
];
const posterSizeOf = (width, height) => {
  if (!width || !height) return null;
  const ratio = width / height;
  return POSTER_SIZES.find((size) => Math.abs(ratio - size.width / size.height) <= (size.width / size.height) * 0.02) || null;
};
// Room for a story at full size; the server keeps the same ceiling.
const POSTER_COMPRESS = { maxBytes: 500 * 1024, maxDimension: 1920 };

/** The width and height of a picture (a data URI or a link), or null when it cannot be read. */
function readSize(src) {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

const EMPTY = { tag: "", title: "", note: "", tone: "dark", placement: "home", validFrom: "", validUntil: "", sortOrder: 0, isActive: true, image: null };

// The two tabs: where in the clients' app the offers on each show.
const PLACES = {
  home: {
    label: "Home offers",
    about: "Offers shown on the Home page of the clients' app. A client can tap one to ask the studio about it on WhatsApp.",
    empty: "Add one and it shows on every client's Home page.",
  },
  referral: {
    label: "Referral offers",
    about: "Offers shown on the Referrals page of the clients' app - what a client gets for referring a friend, e.g. \"Refer a friend and get 1% off\". Shown as a wide banner at the top of the page: any image size, a wide one looks best.",
    empty: "Add one and it shows above the Refer a friend form on every client's Referrals page.",
  },
};

function formatDay(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function dates(offer) {
  if (offer.validFrom && offer.validUntil) return `${formatDay(offer.validFrom)} - ${formatDay(offer.validUntil)}`;
  if (offer.validUntil) return `Until ${formatDay(offer.validUntil)}`;
  if (offer.validFrom) return `From ${formatDay(offer.validFrom)}`;
  return "No end date";
}

/** Where an offer stands for the clients. */
function statusOf(offer) {
  if (offer.live) return "Showing to clients";
  if (!offer.isActive) return "Off";
  return offer.validFrom && offer.validFrom > new Date().toISOString().slice(0, 10) ? "Scheduled" : "Ended";
}
const STATUS_DOTS = { "Showing to clients": "bg-emerald-500", Off: "bg-slate-400", Scheduled: "bg-blue-500", Ended: "bg-amber-500" };

/** The card as the clients' app draws it: the poster whole at its own shape, or the words on dark or light. */
function OfferPreview({ offer, className = "" }) {
  if (offer.imageUrl || offer.image) {
    const size = posterSizeOf(offer.imageWidth, offer.imageHeight);
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={offer.image || offer.imageUrl} alt={offer.title} style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined} className={`w-full rounded-xl bg-slate-100 object-cover ${className}`} />;
  }
  const dark = offer.tone !== "light";
  return <div className={`flex aspect-video w-full flex-col justify-end rounded-xl p-4 ${dark ? "bg-[#2F443F] text-white" : "border border-[#E8E0D6] bg-[#EEDDBB] text-[#1F2B28]"}`}>
    {offer.tag ? <span className={`mb-1 text-[11px] font-semibold uppercase tracking-wider ${dark ? "text-[#EEDDBB]" : "text-[#A87528]"}`}>{offer.tag}</span> : null}
    <span className="text-lg font-semibold leading-snug">{offer.title || "Offer title"}</span>
    {offer.note ? <span className={`mt-1 text-xs ${dark ? "text-white/80" : "text-[#47524F]"}`}>{offer.note}</span> : null}
  </div>;
}

/** What the offer's picture is, in words: its poster size, or the referral banner's size. */
function sizeLabel(offer) {
  if (offer.placement === "referral") return offer.imageWidth ? `Banner - ${offer.imageWidth} x ${offer.imageHeight}` : "Banner";
  const size = posterSizeOf(offer.imageWidth, offer.imageHeight);
  return size ? `${size.label} poster - ${size.width} x ${size.height}` : "Earlier poster size";
}

/** A small picture of the offer at its own shape, for the list; clicked, it opens full size. */
function OfferThumb({ offer, onOpen }) {
  const src = offer.imageUrl || offer.image;
  const aspect = offer.imageWidth && offer.imageHeight ? offer.imageWidth / offer.imageHeight : 16 / 9;
  const height = 56;
  const width = Math.round(Math.min(Math.max(height * aspect, 32), 100));
  if (!src) return <span className="block shrink-0 rounded-md bg-slate-100" style={{ width, height }} />;
  return <button type="button" onClick={onOpen} title="View full size" className="group relative block shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500" style={{ width, height }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={offer.title || "Offer"} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
  </button>;
}

/*
 * A poster reshaped to one of the sizes, in the browser: 1080 wide at that size's shape, as WebP.
 * `fit` keeps the whole poster and fills the space around it with a soft, darkened, blurred copy of
 * itself (drawn tiny and scaled up, which every browser blurs alike); `fill` covers the frame and
 * crops what falls outside it, from the centre. Fails (null) for a picture the browser may not read
 * back - a poster already stored elsewhere, which has to be uploaded again to be reshaped.
 */
async function reshapePoster(src, size, mode) {
  const picture = await new Promise((resolve) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  if (!picture) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  const { naturalWidth: width, naturalHeight: height } = picture;
  const cover = Math.max(size.width / width, size.height / height);
  const coverAt = [(size.width - width * cover) / 2, (size.height - height * cover) / 2, width * cover, height * cover];
  if (mode === "fill") {
    context.drawImage(picture, ...coverAt);
  } else {
    const tiny = document.createElement("canvas");
    tiny.width = 24;
    tiny.height = Math.max(1, Math.round((24 * size.height) / size.width));
    tiny.getContext("2d").drawImage(picture, (tiny.width - width * (cover * tiny.width / size.width)) / 2, (tiny.height - height * (cover * tiny.width / size.width)) / 2, width * (cover * tiny.width / size.width), height * (cover * tiny.width / size.width));
    context.imageSmoothingQuality = "high";
    context.drawImage(tiny, 0, 0, size.width, size.height);
    context.fillStyle = "rgba(0, 0, 0, 0.28)";
    context.fillRect(0, 0, size.width, size.height);
    const contain = Math.min(size.width / width, size.height / height);
    context.drawImage(picture, (size.width - width * contain) / 2, (size.height - height * contain) / 2, width * contain, height * contain);
  }
  try {
    return canvas.toDataURL("image/webp", 0.9);
  } catch {
    return null;
  }
}

/** The three sizes to choose from - the poster's own lit up when it is one of them. */
function PosterSizes({ chosen, natural, onChoose, disabled }) {
  return <div role="radiogroup" aria-label="Poster size" className="grid grid-cols-3 gap-2">
    {POSTER_SIZES.map((option) => {
      const on = chosen === option.key;
      return <button
        key={option.key}
        type="button"
        role="radio"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChoose(option.key)}
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
      >
        {/* The shape, drawn to scale. */}
        <span aria-hidden="true" className={`block shrink-0 rounded-[3px] border-2 ${on ? "border-blue-600 bg-blue-100" : "border-slate-300"}`} style={{ width: 14, height: Math.round((14 * option.height) / option.width) }} />
        <span className="min-w-0">
          <span className={`block text-xs font-semibold ${on ? "text-blue-700" : "text-slate-700"}`}>{option.label}</span>
          <span className="block text-[11px] text-slate-500">{option.width} x {option.height}{natural === option.key ? " - as uploaded" : ""}</span>
        </span>
      </button>;
    })}
  </div>;
}

/*
 * Adding or changing an offer is its poster and nothing else. The studio picks a poster and one of
 * the three sizes: a poster already that size goes as it is; any other is reshaped to the chosen
 * size here - the whole of it fitted in (the space around it filled from the poster itself) or the
 * frame filled and the edges cropped - and the preview is exactly what clients will see.
 */
function OfferForm({ offer, placement, onClose, onSaved }) {
  const savedSize = offer?.imageWidth ? { width: offer.imageWidth, height: offer.imageHeight } : null;
  // The poster as picked (or as saved), and its size.
  const [source, setSource] = useState(offer?.imageUrl || null);
  const [sourceSize, setSourceSize] = useState(savedSize);
  // The size chosen, and how a poster of another shape is made to it.
  const [chosen, setChosen] = useState(posterSizeOf(savedSize?.width, savedSize?.height)?.key || null);
  const [mode, setMode] = useState("fit");
  // What is sent: the poster itself, or its reshaped copy.
  const [image, setImage] = useState(offer?.imageUrl || null);
  const [size, setSize] = useState(savedSize);
  const [shaping, setShaping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const natural = posterSizeOf(sourceSize?.width, sourceSize?.height)?.key || null;
  const unchanged = Boolean(offer?.imageUrl) && image === offer.imageUrl;
  // An offer saved before sizes were kept may be saved again with its poster as it is.
  // A referral offer is a banner at its own shape: any size goes as it is, nothing to choose.
  const anySize = placement === "referral";
  const sizeOk = unchanged || (anySize ? Boolean(image) : Boolean(posterSizeOf(size?.width, size?.height)));
  const reshaped = Boolean(chosen) && chosen !== natural;

  /** Makes the poster to send from `src` at `key` in `how`: as it is when it is that size already. */
  async function shape(src, srcSize, key, how) {
    const target = POSTER_SIZES.find((option) => option.key === key);
    if (!src || !target) return;
    if (posterSizeOf(srcSize?.width, srcSize?.height)?.key === key) {
      setImage(src);
      setSize(srcSize);
      return;
    }
    setShaping(true);
    const made = await reshapePoster(src, target, how);
    setShaping(false);
    if (!made) {
      setProblem("This poster cannot be resized here. Upload the poster file again, then choose its size.");
      return;
    }
    setImage(made);
    setSize({ width: target.width, height: target.height });
  }

  async function pick(value) {
    setProblem("");
    setSource(value || null);
    if (!value) {
      setSourceSize(null);
      setImage(null);
      setSize(null);
      setChosen(null);
      return;
    }
    const read = await readSize(value);
    setSourceSize(read);
    if (anySize) {
      setImage(value);
      setSize(read);
      setChosen(null);
      return;
    }
    // Its own size when it is one; otherwise the size nearest its shape, to start from.
    const own = posterSizeOf(read?.width, read?.height);
    const nearest = own || (read ? POSTER_SIZES.reduce((best, option) => (Math.abs(read.width / read.height - option.width / option.height) < Math.abs(read.width / read.height - best.width / best.height) ? option : best)) : POSTER_SIZES[0]);
    setChosen(nearest.key);
    await shape(value, read, nearest.key, mode);
  }

  async function choose(key) {
    setProblem("");
    setChosen(key);
    await shape(source, sourceSize, key, mode);
  }

  async function changeMode(how) {
    setMode(how);
    await shape(source, sourceSize, chosen, how);
  }

  async function save() {
    if (!image) { setProblem("Upload the offer's poster."); return; }
    if (!sizeOk) { setProblem("Choose the poster's size: square, portrait or story."); return; }
    setSaving(true);
    setProblem("");
    // Words, dates and order are left as they were (an edit) or open (a new offer): shown at once.
    const body = { ...EMPTY, placement, ...(offer ? { ...offer, validFrom: offer.validFrom || "", validUntil: offer.validUntil || "" } : {}), image };
    try {
      const result = offer ? await updateClientOffer(offer.id, body) : await createClientOffer(body);
      onSaved(result?.message || "Offer saved.");
    } catch (error) {
      setProblem(error.message || "Unable to save the offer.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={offer ? "Change offer" : placement === "referral" ? "Add referral offer" : "Add offer"}
    description={placement === "referral"
      ? "Upload the referral banner - any image size, a wide one looks best. It shows at the top of the Referrals page of every client's app."
      : "Upload the offer poster. It shows on the Home page of every client's app."}
    size="md"
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving || shaping || !image || !sizeOk}>{saving ? "Saving..." : offer ? "Save offer" : "Add offer"}</Button>
    </>}
  >
    <div className="space-y-4">
      <ImageUploadField label="Offer poster" required value={source} compress={POSTER_COMPRESS} onChange={(value) => { void pick(value); }} />
      {source && !anySize ? <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Poster size</p>
        <PosterSizes chosen={chosen} natural={natural} onChoose={(key) => { void choose(key); }} disabled={shaping || saving} />
        {/* A poster of another shape: how it is made to the chosen size. */}
        {reshaped ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-600">{sourceSize ? `Your poster is ${sourceSize.width} x ${sourceSize.height}.` : "Your poster is another size."}</span>
          <div role="radiogroup" aria-label="How it fits" className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
            {[["fit", "Fit whole poster"], ["fill", "Fill (crop edges)"]].map(([key, label]) => <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              disabled={shaping || saving}
              onClick={() => { void changeMode(key); }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${mode === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >{label}</button>)}
          </div>
        </div> : null}
      </div> : null}
      {image && sizeOk ? <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{shaping ? "Resizing..." : "Preview - as clients see it"}</p>
        {/* A story is tall: shown at a width that keeps the whole of it in the dialog. A referral banner
            takes the dialog's width, as it takes the page's in the app. */}
        <div className={`mx-auto transition-opacity ${shaping ? "opacity-50" : ""}`} style={{ maxWidth: anySize ? undefined : posterSizeOf(size?.width, size?.height)?.key === "story" ? 220 : 300 }}>
          <OfferPreview offer={{ image, imageWidth: size?.width, imageHeight: size?.height }} />
        </div>
      </div> : null}
      {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
    </div>
  </Dialog>;
}

/** The client app's settings: the offers' WhatsApp number and the coins a booked referral earns. */
function SettingsForm({ settings, onClose, onSaved }) {
  const [whatsapp, setWhatsapp] = useState(settings.offersWhatsapp || "");
  const [coins, setCoins] = useState(String(settings.coinsPerBooking ?? 20));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    setSaving(true);
    setProblem("");
    try {
      const result = await saveClientAppSettings({ offersWhatsapp: whatsapp.trim(), coinsPerBooking: Number(coins) || 0 });
      onSaved(result?.message || "Settings saved.");
    } catch (error) {
      setProblem(error.message || "Unable to save the settings.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title="Client app settings"
    description="What the clients' app uses for offers and referrals."
    size="md"
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save settings"}</Button>
    </>}
  >
    <div className="space-y-4">
      <TextField label="WhatsApp number for offers" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="+91 9442648610" note="Where a client's Ask on WhatsApp and Claim go. Left empty, the client's own branch phone is used." />
      <TextField label="Coins for a referral that books" type="number" min={0} value={coins} onChange={(event) => setCoins(event.target.value)} note="Earned once, when a friend the client referred from the app becomes a booking. Coins already earned stay as they were." />
      {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
    </div>
  </Dialog>;
}

export default function ClientOffersPage() {
  const { canWrite } = useModuleAccess("CLIENT", "Client Offers");
  const { density } = useCompactView();
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  // The offer whose picture is open full size, from its thumbnail.
  const [previewing, setPreviewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [place, setPlace] = useState("home");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const shown = useMemo(() => (offers || []).filter((offer) => (offer.placement || "home") === place), [offers, place]);
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const load = useCallback(async () => {
    try {
      const result = await listClientOffers();
      setOffers(result?.data || []);
      setSettings((await getClientAppSettings())?.data || null);
      setLastUpdated(new Date());
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load offers.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function remove() {
    setBusy(true);
    try {
      await removeClientOffer(removing.id);
      showSuccess("Offer removed.");
      setRemoving(null);
      await load();
    } catch (removeError) {
      showError(removeError.message || "Unable to remove the offer.");
    } finally {
      setBusy(false);
    }
  }

  // One column a fact, as every table in the OS reads: each can be filtered, sorted, hidden and exported.
  const columns = useMemo(() => {
    const text = (id, header, value, width = 160) => ({ id, header, accessorFn: value, cell: ({ row }) => value(row.original) || "—", exportValue: value, width, minWidth: Math.min(width, 120) });
    return [
      { id: "picture", header: place === "referral" ? "Banner" : "Poster", accessorFn: (row) => row.imageUrl || "", enableColumnFilter: false, enableSorting: false, width: 120, minWidth: 100, cell: ({ row }) => <span onClick={(event) => event.stopPropagation()}><OfferThumb offer={row.original} onOpen={() => setPreviewing(row.original)} /></span> },
      text("title", "Title", (row) => row.title || (place === "referral" ? "Referral banner" : "Offer poster"), 220),
      text("size", "Size", sizeLabel, 220),
      text("runs", "Runs", dates, 220),
      { ...text("status", "Status", statusOf, 160), cell: ({ row }) => <TableCellValue value={statusOf(row.original)} type="status" statusStyles={STATUS_DOTS} /> },
      {
        id: "actions",
        header: "",
        accessorFn: () => "",
        enableColumnFilter: false,
        enableSorting: false,
        width: 56,
        minWidth: 56,
        cell: ({ row }) => (canWrite ? <OptionsMenu ariaLabel="Offer actions" items={[
          { label: "View", onSelect: () => setPreviewing(row.original) },
          { label: "Edit", onSelect: () => setEditing(row.original) },
          { label: "Remove", tone: "danger", onSelect: () => setRemoving(row.original) },
        ]} /> : null),
      },
    ];
  }, [canWrite, place]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "-";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Client Offers"
      actions={canWrite ? <div className="flex gap-2">
        <Button type="button" onClick={() => setEditingSettings(true)} disabled={!settings}>Client app settings</Button>
        <Button type="button" variant="primary" onClick={() => setEditing("new")}>{place === "referral" ? "Add referral offer" : "Add offer"}</Button>
      </div> : null}
      tabs={Object.entries(PLACES).map(([id, entry]) => ({ id, label: entry.label, count: offers ? offers.filter((offer) => (offer.placement || "home") === id).length : undefined }))}
      tabValue={place}
      onTabChange={setPlace}
      tabsAriaLabel="Where the offers show"
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* The client app settings and where this tab's offers show, in one slim line above the table. */}
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
      {settings ? <>
        <span>WhatsApp for offers: <b className="font-semibold text-slate-700">{settings.offersWhatsapp || "Client's branch phone"}</b></span>
        <span>Coins for a referral that books: <b className="font-semibold text-slate-700">{settings.coinsPerBooking}</b></span>
      </> : null}
      <span className="min-w-0 flex-1 basis-80">{PLACES[place].about}{place === "referral" ? "" : " Posters are square (1080 x 1080), portrait (1080 x 1350) or story (1080 x 1920)."}</span>
    </div>
    {error ? <p className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        <div className="flex min-h-0 min-w-0 flex-1">
          <DataTable
            key={place}
            columns={columns}
            data={shown}
            density={density}
            loading={!offers && !error}
            loadingMessage="Loading offers..."
            emptyMessage={`No ${place === "referral" ? "referral offers" : "offers"} yet.${canWrite ? ` ${PLACES[place].empty}` : ""}`}
            noMatchMessage="No offers match."
            onVisibleRowsChange={setTableStats}
            onRowDoubleClick={(row) => { if (canWrite) setEditing(row); }}
            ariaLabel={`${PLACES[place].label} table`}
            features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: `client-offers-${place}` } }}
          />
        </div>
      </DataTableShell>
    </div>
    {editing ? <OfferForm
      offer={editing === "new" ? null : editing}
      placement={editing === "new" ? place : editing.placement || "home"}
      onClose={() => setEditing(null)}
      onSaved={(message) => { setEditing(null); showSuccess(message); void load(); }}
    /> : null}
    {editingSettings && settings ? <SettingsForm
      settings={settings}
      onClose={() => setEditingSettings(false)}
      onSaved={(message) => { setEditingSettings(false); showSuccess(message); void load(); }}
    /> : null}
    {previewing ? <Dialog
      title={previewing.title || (previewing.placement === "referral" ? "Referral banner" : "Offer poster")}
      description={sizeLabel(previewing)}
      size="lg"
      onClose={() => setPreviewing(null)}
      footer={<Button type="button" onClick={() => setPreviewing(null)}>Close</Button>}
    >
      <div className="mx-auto" style={{ maxWidth: posterSizeOf(previewing.imageWidth, previewing.imageHeight)?.key === "story" ? 320 : undefined }}>
        <OfferPreview offer={previewing} />
      </div>
    </Dialog> : null}
    {removing ? <ConfirmDialog
      title={removing.title ? `Remove "${removing.title}"?` : "Remove this offer?"}
      message={`It stops showing on the clients' ${removing.placement === "referral" ? "Referrals" : "Home"} page at once.`}
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={busy}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void remove()}
    /> : null}
  </section>;
}
