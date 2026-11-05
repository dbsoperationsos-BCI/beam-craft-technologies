"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import ImageUploadField from "@/components/shared/ImageUploadField";
import InfrastructureImageGrid from "@/components/shared/InfrastructureImageGrid";
import Loader from "@/components/shared/Loader";
import MultiSelectField from "@/components/shared/MultiSelectField";
import SortableList from "@/components/shared/SortableList";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useFormErrors from "@/components/shared/useFormErrors";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import Dialog from "@/components/ui/Dialog";
import Tabs from "@/components/ui/Tabs";
import {
  createQuotationBrandTerm,
  deleteQuotationBrandTerm,
  getQuotationBrandAdminConfiguration,
  getQuotationGeneralSettings,
  reorderQuotationBrandTerms,
  updateQuotationBrand,
  updateQuotationBrandTerm,
  updateQuotationGeneralSettings,
} from "@/services/sales/quotation-brands.service";
import { getMasterData } from "@/services/hrm/master-data.service";
import { MAX_INFRA_PHOTOS } from "@/lib/infrastructureCollage.mjs";
import { QUOTATION_BRANDS, brandLabel } from "@/lib/quotationBrand.mjs";
import { dropIndex, moveInList } from "@/lib/sidebarLayout.mjs";

/**
 * Settings -> Quotation Settings: what each brand's quotations offer.
 *
 * One rail group with one screen per brand - Dum Dum, Qua Qua, Corp - and three tabs on each: the
 * brand's terms, the words on its client-facing PDF, and the pictures on it. The studio rates the
 * generator prices with, and the brand masters, are left to the API and the generator's own
 * fallbacks; the studio asked for those screens to go.
 *
 * Every change here reaches only quotations raised *after* it. A version already sent carries its
 * own snapshot of the brand - its terms, its wording, its logo, the price each line was added at -
 * and prints from that, never from these tables. The screen says so where it matters.
 *
 * Gated by the caller on `ADMIN / System Settings`, which is what the admin routes behind every
 * save here enforce; `canWrite` drops the controls rather than disabling them.
 */

const currency = (value) => (value === null || value === undefined || value === "" ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0));
const digits = (value) => String(value ?? "").replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const asPrice = (value) => (String(value ?? "").trim() === "" ? null : Number(value));

/*
 * The three tabs a brand's screen carries: its terms, the words on its PDF, and the pictures on it.
 * PDF Content and PDF Image were one tab; the pictures moved to a tab of their own so a studio
 * working through its photographs is not scrolling past the wording, and each tab saves only its
 * own part of the brand - the brand PATCH applies a field only where it is sent. The services,
 * deliverables, packages and pricing a brand quotes with are not configured here - the studio
 * asked for those screens to go - so the generator offers the project catalogue at the studio
 * rates, as it always has; the tables and routes behind them are untouched.
 */
const BRAND_TABS = [
  { id: "terms", label: "Terms" },
  { id: "pdf", label: "PDF Content" },
  { id: "images", label: "PDF Image" },
];

/**
 * The wording fields on a brand's PDF Content tab, grouped the way the page is read: each is
 * `[key, label, kind, hint]`, and a group is `[title, fields]`. `{brand}` in a sentence prints as
 * the brand's name. What every brand shares - the notes and trademark cards, Journey & Legacy,
 * Our Infrastructure - is not here; it is General's, below.
 */
const PDF_FIELD_GROUPS = [
  ["The head of the page", [
    ["tagline", "Tagline under the name", "text", "The short line printed under the brand name on the cover."],
    ["motto", "Motto (the pill under the tagline)", "text", "One line printed in a rounded pill under the tagline."],
    ["websiteUrl", "Website", "text", "Left blank, the quotation's branch website prints - Organization → Branches."],
    ["coverQuote", "Quote under the cover photograph", "area", "Printed in italics just below the opening photograph."],
    ["proposalLabel", "Proposal card label", "text", "The small words above the client's name on the proposal card."],
  ]],
  ["The events", [
    ["eventSectionLabel", "Event section label", "text", "The small gold line over the event cards - \"Ceremonial Itinerary\" for a wedding, \"Production scope\" for a corporate job."],
    ["eventSectionTitle", "Event section title", "text", "The heading over the event cards - \"Event Coverage & Deliverables Details\" or \"Project Itinerary\"."],
    ["eventLabel", "Event card label", "text", "\"Event\" prints as EVENT 01, EVENT 02 …; a corporate brand may prefer \"Project\"."],
    ["mainEventBadge", "Main event badge", "text", "Marks the event card the quotation flags as its main event."],
    ["servicesTitle", "Services heading", "text", "The heading over each event card's list of services."],
    ["deliverablesTitle", "Deliverables heading", "text", "The heading over each event card's list of deliverables."],
    ["deliverableFootnote", "Storage note", "text", "The bar under the events. Left blank, no bar prints."],
  ]],
  ["The money", [
    ["pricingLabel", "Pricing card label", "text", "Left blank, the heading set on General → Pricing & Total prints."],
    ["validityText", "Validity line", "text", "Left blank, the line set on General → Pricing & Total prints. {months} and {validUntil} are filled in there too."],
  ]],
  ["The close of the proposal", [
    ["closingQuote", "Closing quote", "area", "Printed in italics near the end, before the terms link."],
    ["closingThanks", "Closing thanks", "area", "The thank-you paragraph printed under the closing quote."],
    ["termsTitle", "Terms heading", "text", "The words on the link that opens this brand's terms."],
  ]],
  ["The Thank You page", [
    ["thankYouQuote", "Thank You quote", "area", "Printed in italics above the large Thank You on the last page."],
    ["thankYouTitle", "Thank You (script)", "text", "The large handwritten-style words across the last page."],
    ["thankYouSubtitle", "Thank You subtitle", "text", "The smaller line printed under the large Thank You."],
    ["footerNote", "Footer paragraph", "area", "Printed at the foot of the last page; {brand} prints the brand name."],
    ["contactPhone", "Footer phone", "text", "Left blank, the quotation's branch phone prints."],
    ["socialHandle", "Social handle", "text", "Printed beside the website on the last page, e.g. @yourstudio."],
    ["copyrightText", "Copyright line", "text", "Left blank: Copyright © <year> <brand name>. All rights reserved."],
  ]],
];
const PDF_FIELDS = PDF_FIELD_GROUPS.flatMap(([, fields]) => fields);

/** The pictures a brand's quotation prints that are the brand's own. */
const PDF_PICTURES = [
  ["coverImageUrl", "Cover photograph", "The full-width photograph the quotation opens on - a couple, a family, a stage. Shown 1020 pixels wide, so pick a large, portrait picture."],
  ["thankYouImageUrl", "Thank You photograph", "The closing photograph the studio signs off over. Tall - the section is as high as the cover."],
];

/**
 * The words every brand's quotation shares, edited once on General. The same `[key, label, kind,
 * hint]` shape; `{brand}` prints as the brand's name on each brand's copy.
 */
const GENERAL_FIELD_GROUPS = [
  ["Pricing & Total", [
    ["pricingLabel", "Pricing card heading", "text", "A brand's own heading, on its PDF Content tab, still prints for that brand."],
    ["gstText", "GST line", "text", "{gst} prints the quotation's own GST rate - set by its pricing, not here. Printed only where the quotation carries a rate."],
    ["paymentLabel", "Payment link label", "text", "The link to the branch's payment details, shown only where the branch has some."],
    ["validityMonths", "Valid for (months)", "months", "Whole months, 1 to 60."],
    ["validityText", "Validity line", "area", "{months} prints the months above; {validUntil} the quotation's own date that many months on - \"14 Jan 2027\". A brand's own validity line, on its PDF Content tab, still prints for that brand."],
  ]],
  ["Additional Notes", [
    ["notesTitle", "Additional notes heading", "text", "The heading over the notes card on every brand's quotation."],
    ["notesDefault", "Standard note", "area", "Printed under the heading when the quotation itself carries no note. Left blank, a quotation without a note prints no card."],
  ]],
  ["Officially Trademarked Brand", [
    ["trademarkBadge", "Trademark badge", "text", "The small gold badge at the top of the trademark card."],
    ["trademarkTitle", "Trademark heading", "text", "The heading of the trademark card on every brand's quotation."],
    ["trademarkBody", "Trademark paragraph", "area", "The paragraph inside the trademark card; left blank, none prints."],
    ["trademarkNote", "Trademark footnote (italic)", "area", "A small italic line under the trademark card; left blank, none prints."],
  ]],
  ["Journey & Legacy", [
    ["journeyTitle", "Journey heading", "text", "The heading over the Journey & Legacy timeline."],
    ["journeySubtitle", "Journey subheading", "text", "The spaced-out line printed under the Journey heading."],
    ["journeyIntro", "Journey introduction (italic)", "text", "One italic sentence introducing the timeline below it."],
    ["locationsTitle", "Locations heading", "text", "The chips under it are the active branches from Organization → Branches."],
  ]],
  ["Our Infrastructure", [
    ["infrastructureTitle", "Infrastructure heading", "text", "The heading over the branch photograph collages."],
    ["infrastructureSubtitle", "Infrastructure subheading", "text", "The spaced-out line printed under the Infrastructure heading."],
    ["infrastructureTagline", "Infrastructure tagline", "text", "The closing line printed under the branch photographs."],
  ]],
];
const GENERAL_FIELDS = GENERAL_FIELD_GROUPS.flatMap(([, fields]) => fields);

/**
 * The sections of the client's copy the studio can switch off, and what each is called - the four
 * shared cards, and the Pricing & Total card with the three lines inside it.
 */
const SECTION_SWITCHES = [
  ["pricing", "Pricing & Total"],
  ["gst", "GST line"],
  ["payment", "Payment link"],
  ["validity", "Validity line"],
  ["notes", "Additional Notes"],
  ["trademark", "Officially Trademarked Brand"],
  ["journey", "Journey & Legacy"],
  ["infrastructure", "Our Infrastructure"],
];

const errorText = (error, fallback) => error?.data?.message || error?.message || fallback;

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * One brand: three tabs over one loaded configuration.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export default function QuotationBrandSettingsPanel({ code, canWrite = false, onNotice, onError, unsavedRef }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("terms");
  const name = config?.brand?.name || brandLabel(code);

  /*
   * Where this screen's staged work is reported, for the two ways out of it.
   *
   * PDF Content and PDF Image stage their edits - a term is written by its own dialog the moment it
   * is saved, so the Terms tab is never holding work - and each writes its dirty flag here. The settings rail
   * reads the same ref through `unsavedRef` to decide whether leaving the brand asks first, and the
   * tab bar reads it to decide whether *this* click does: the two are the same loss, since the tab
   * that is not on screen is not mounted and its edits exist nowhere else.
   *
   * The fallback is for a caller that passes no ref; the tab guard still works from it.
   */
  const ownUnsavedRef = useRef(false);
  const unsavedEditsRef = unsavedRef || ownUnsavedRef;
  // Read inside the guard rather than during render: a ref does not re-render on a keystroke, so
  // the answer has to be taken at the moment the tab is clicked.
  const { guard: guardTabChange, confirmProps: tabConfirmProps } = useUnsavedGuard(() => unsavedEditsRef.current);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getQuotationBrandAdminConfiguration(code);
      setConfig(response?.data || null);
    } catch (error) {
      onError?.(errorText(error, `Unable to load the ${brandLabel(code)} settings.`));
    } finally {
      setLoading(false);
    }
  }, [code, onError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const patch = (changes) => setConfig((current) => (current ? { ...current, ...changes } : current));

  if (loading || !config) return <Loader label={`Loading ${brandLabel(code)} settings...`} />;

  const shared = { code, name, config, canWrite, onNotice, onError, patch, reload: load };

  return <div className="space-y-5">
    <Tabs tabs={BRAND_TABS} value={tab} onChange={(next) => guardTabChange(() => setTab(next))} ariaLabel={`${name} quotation settings`} className="border-b border-slate-200" />
    {tab === "terms" && <TermsTab {...shared} />}
    {tab === "pdf" && <PdfContentTab {...shared} unsavedRef={unsavedEditsRef} />}
    {tab === "images" && <PdfImageTab {...shared} unsavedRef={unsavedEditsRef} />}
    {/* The rail's question, asked by the tab bar, in the rail's words - the PDF content is lost
        the same way whichever of the two is clicked. */}
    <ConfirmDialog {...tabConfirmProps} />
  </div>;
}

/* ---- terms ---- */

function TermsTab({ code, name, config, canWrite, onNotice, onError, patch }) {
  const terms = config.terms || [];
  const standard = config.defaultTerms || [];
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState("");
  // True while the studio's standard clauses are being copied onto this brand, so a second press
  // cannot write them twice.
  const [adopting, setAdopting] = useState(false);

  /*
   * Copies the studio's standard clauses onto this brand, so they become rows it owns.
   *
   * The three shown while a brand has none of its own are the *template's* - they are not stored
   * anywhere, so there is nothing to edit, reorder or delete. Adopting them writes them as this
   * brand's own, in the order they print, after which each behaves like any term somebody typed.
   * Returns the new rows so the press that asked for it can go on to edit or delete one.
   */
  async function adoptStandardTerms() {
    if (adopting) return null;
    setAdopting(true);
    try {
      const created = [];
      for (const term of standard) {
        const response = await createQuotationBrandTerm(code, { title: term.title, body: term.body, isActive: true });
        created.push(response?.data || { ...term });
      }
      patch({ terms: created });
      onNotice?.(`The standard terms are now ${name}'s own, and can be edited, reordered or removed.`);
      return created;
    } catch (error) {
      onError?.(errorText(error, "Unable to copy the standard terms."));
      return null;
    } finally {
      setAdopting(false);
    }
  }

  async function save(values) {
    const data = { title: values.title.trim(), body: values.body.trim(), isActive: values.isActive !== false };
    try {
      if (editing?.id) {
        const response = await updateQuotationBrandTerm(code, editing.id, data);
        patch({ terms: terms.map((row) => row.id === editing.id ? { ...row, ...(response?.data || data) } : row) });
      } else {
        const response = await createQuotationBrandTerm(code, data);
        patch({ terms: [...terms, response?.data || data] });
      }
      onNotice?.("Terms saved. Quotations already sent keep the terms they were sent with.");
      setEditing(null);
    } catch (error) {
      onError?.(errorText(error, "Unable to save the term."));
    }
  }

  async function toggle(row, isActive) {
    setBusyId(row.id);
    try {
      await updateQuotationBrandTerm(code, row.id, { isActive });
      patch({ terms: terms.map((item) => item.id === row.id ? { ...item, isActive } : item) });
    } catch (error) {
      onError?.(errorText(error, "Unable to update the term."));
    } finally {
      setBusyId("");
    }
  }

  async function remove() {
    const target = deleting;
    setDeleting(null);
    try {
      await deleteQuotationBrandTerm(code, target.id);
      patch({ terms: terms.filter((row) => row.id !== target.id) });
    } catch (error) {
      onError?.(errorText(error, "Unable to delete the term."));
    }
  }

  async function reorder(ids) {
    const byId = new Map(terms.map((row) => [row.id, row]));
    patch({ terms: ids.map((id) => byId.get(id)).filter(Boolean) });
    try { await reorderQuotationBrandTerms(code, ids); } catch (error) { onError?.(errorText(error, "Unable to save the order.")); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* With no terms of its own the line stays on screen: it says the list below is the studio's,
          not this brand's, which is what the user has to act on. */}
      {terms.length
        ? sectionTitle("Terms & Conditions", `The Terms & Conditions printed on a ${name} quotation, in this order. Each can be edited, reordered, hidden or removed.`)
        : <p className="max-w-2xl text-xs text-slate-500 sm:text-sm">{`${name} has no terms of its own, so its quotations print the studio's standard terms shown below. Edit or remove one to make them this brand's own, or add a term of your own.`}</p>}
      {canWrite && <div className="flex flex-wrap gap-2">
        {terms.length === 0 && standard.length > 0 && <Button type="button" disabled={adopting} onClick={() => void adoptStandardTerms()}>{adopting ? "Copying..." : "Edit the standard terms"}</Button>}
        <Button type="button" variant="primary" onClick={() => setEditing({})}>Add term</Button>
      </div>}
    </div>
    {terms.length > 0
      ? <SortableList
        label={`${name} terms`}
        disabled={!canWrite}
        // No arrows on this list: each row carries its own ⋮, and the clauses are dragged into
        // order or moved with the arrow keys while the row has focus.
        moveButtons={false}
        items={terms.map((row) => ({ id: row.id, label: row.title, row }))}
        onReorder={reorder}
        renderRow={({ row }) => <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${row.isActive === false ? "text-slate-400 line-through" : "text-slate-800"}`}>{row.title}</p>
            <p className="line-clamp-2 text-xs text-slate-500">{row.body}</p>
          </div>
          {/* The switch stays on the row - it says what the clause is doing rather than doing
              something to it - and the two actions sit under the ⋮ every other row in the
              application carries. `onPointerDown` keeps a press on either from starting a drag. */}
          {canWrite && <div className="flex shrink-0 items-center gap-2" onPointerDown={(event) => event.stopPropagation()}>
            <ToggleSwitch size="sm" ariaLabel={`${row.title} printed`} checked={row.isActive !== false} disabled={busyId === row.id} onCheckedChange={(checked) => void toggle(row, checked)} />
            {/* The menu is portalled to the body, so it needs the layer that clears the Settings
                panel it is opened inside - at the default `menu` it renders *behind* the panel and
                pressing ⋮ appears to do nothing. */}
            <OptionsMenu ariaLabel={`Actions for ${row.title}`} menuZIndexClassName={layers.menuOverPanel} items={[
              { label: "Edit", onSelect: () => setEditing(row) },
              { label: "Delete", tone: "danger", onSelect: () => setDeleting(row) },
            ]} />
          </div>}
        </div>}
      />
      : <ol className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        {standard.map((term, index) => <li key={term.title} className="flex flex-wrap items-start gap-x-4 gap-y-2 text-xs text-slate-600 sm:text-sm">
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-slate-700">{String(index + 1).padStart(2, "0")} {term.title}</span>
            <p className="mt-0.5 text-slate-500">{term.body}</p>
          </div>
          {/* Editing or removing a standard clause makes all three this brand's own first - there is
              nothing stored to change until then - and then does what was asked to the one pressed. */}
          {canWrite && <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" disabled={adopting} onClick={async () => { const rows = await adoptStandardTerms(); if (rows?.[index]) setEditing(rows[index]); }}>Edit</Button>
            <Button type="button" size="sm" variant="danger" disabled={adopting} onClick={async () => { const rows = await adoptStandardTerms(); if (rows?.[index]) setDeleting(rows[index]); }}>Delete</Button>
          </div>}
        </li>)}
      </ol>}
    {editing && <TermDialog
      title={editing.id ? "Edit term" : `Add term to ${name}`}
      initial={{ title: editing.title || "", body: editing.body || "", isActive: editing.isActive !== false }}
      onClose={() => setEditing(null)}
      onSave={save}
    />}
    <ConfirmDialog open={Boolean(deleting)} title="Delete term?" message={`${deleting?.title || "This term"} will no longer print on new ${name} quotations. Quotations already sent keep it.`} confirmLabel="Delete" layer="dialogOverPanel" onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
  </div>;
}

function TermDialog({ title, initial, onClose, onSave }) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const fields = useFormErrors();
  const set = (name, value) => { fields.clear(name); setValues((current) => ({ ...current, [name]: value })); };

  // A plain dialog, not a form - see `MasterDialog` for why.
  async function submit() {
    if (saving) return;
    if (!fields.check({
      title: values.title.trim() ? "" : "Enter the term's title.",
      body: values.body.trim() ? "" : "Write the clause.",
    })) return;
    setSaving(true);
    try { await onSave(values); } finally { setSaving(false); }
  }

  return <Dialog title={title} size="md" layer="dialogOverPanel" busy={saving} onClose={onClose} footer={<>
    <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
    <Button type="button" variant="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving..." : "Save"}</Button>
  </>}>
    <div className="space-y-4">
      <TextField label="Title" required helperText="The short heading this clause prints under in the terms." value={values.title} maxLength={191} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} onChange={(event) => set("title", event.target.value)} error={fields.errors.title} />
      <TextAreaField label="Clause" required helperText="The full wording of the clause, exactly as the client should read it." rows={5} maxLength={4000} value={values.body} onChange={(event) => set("body", event.target.value)} error={fields.errors.body} />
      <ToggleSwitch ariaLabel="Printed on new quotations" helperText="Off keeps the clause here but leaves it off new quotations." checked={values.isActive} label={values.isActive ? "Printed on new quotations" : "Not printed"} onCheckedChange={(checked) => setValues((current) => ({ ...current, isActive: checked }))} />
    </div>
  </Dialog>;
}

/* ---- PDF content: the logo, the pictures, the event types, the timeline and the words ---- */

/*
 * How many photographs a branch may hold is `@/lib/infrastructureCollage.mjs`'s to say, because it
 * is the file that knows how to lay them out - there is a composition for one through eight and
 * none for a ninth. The API refuses a ninth as well; this is the half of it the studio sees.
 */

/*
 * How big a picked picture may be, and how much of it is kept.
 *
 * A cover or a Thank You photograph straight off a camera is well over 10 MB, so the pick limit is
 * 20 MB; it is then resampled in the browser to 2400px and about 2.5 MB before it is sent, which is
 * plenty for a picture printed 1080px wide. A collage photograph is shown at a fifth of that and
 * keeps less. The server re-compresses to its own ceiling either way.
 */
const PICTURE_PICK_LIMIT = 20 * 1024 * 1024;
const LARGE_PICTURE = { maxBytes: 2.5 * 1024 * 1024, maxDimension: 2400 };
const MAP_PICTURE = { maxBytes: 1024 * 1024, maxDimension: 1800 };
const COLLAGE_PICTURE = { maxBytes: 450 * 1024, maxDimension: 1600 };

const emptyGroup = () => ({ title: "", subtitle: "", photos: [] });
const emptyJourneyRow = () => ({ year: "", title: "", detail: "", place: "" });

/** A section's heading, with what the section does in its ⓘ rather than a paragraph under it. */
const sectionTitle = (text, tip) => <h3 className="flex items-center text-sm font-semibold text-slate-800">{text}<HelpTip text={tip} /></h3>;

/** A group of wording fields, each showing the standard wording it replaces. */
/** Blank (the template's three), or a whole number of months from 1 to 60. */
const validMonths = (value) => {
  const text = String(value ?? "").trim();
  return !text || (/^\d{1,2}$/.test(text) && Number(text) >= 1 && Number(text) <= 60);
};

function WordingFields({ groups, values, defaults, canWrite, onChange, errors = {} }) {
  return groups.map(([groupTitle, fields]) => <div key={groupTitle}>
    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{groupTitle}</p>
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      {fields.map(([key, label, type, hint]) => {
        const shared = { label, helperText: hint, value: values[key] || "", placeholder: defaults[key] || "Nothing printed", readOnly: !canWrite, error: errors[key], onChange: (event) => onChange(key, event.target.value) };
        return <div key={key} className={type === "area" ? "md:col-span-2" : ""}>
          {type === "area" ? <TextAreaField rows={3} maxLength={2000} {...shared} /> : type === "months" ? <TextField type="number" inputMode="numeric" min="1" max="60" step="1" {...shared} /> : <TextField maxLength={191} {...shared} />}
        </div>;
      })}
    </div>
  </div>);
}

/**
 * One branch's photographs: the collage exactly as the client will see it, and the handles to
 * arrange it.
 *
 * The preview is not a drawing of the composition - it is `InfrastructureImageGrid`, the same
 * component the client's copy and the PDF are laid out with, so what is arranged here is what
 * prints. Which is the point of showing it: the layout changes with the count, and where a
 * particular photograph lands - a wide frame across the top, one of the four small ones, a tall
 * portrait down the right - is decided by its position in this list and nothing else.
 *
 * Three ways to move a picture, for the same reason `SortableList` has three: a frame can be
 * dragged, which is what a mouse expects; the two chevrons on it do the same with a tap, since a
 * finger fires no HTML5 drag at all; and a focused frame answers the arrow keys. A blue line is
 * drawn down the gap a dragged picture will land in, so the drop and what it does cannot disagree.
 *
 * Replacing one is a click on it and then the field below - one upload field for the whole branch
 * rather than eight, which is what leaves room for the collage itself to be the thing on screen.
 */
function CollagePhotos({ photos, setPhotos, canWrite, saving }) {
  // Which frame the upload field below is pointed at, and the drag in progress. Both are this
  // branch's own, so a picture can only be dropped into the collage it was picked up from.
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const full = photos.length >= MAX_INFRA_PHOTOS;

  const move = (from, to) => {
    if (to < 0 || to >= photos.length) return;
    setPhotos(() => moveInList(photos, from, to));
    setSelected((current) => (current === from ? to : current));
  };
  const removeAt = (index) => {
    setPhotos((current) => current.filter((_, position) => position !== index));
    // The selection follows the list rather than the number: removing a picture before the selected
    // one must not silently re-point the upload field at its neighbour.
    setSelected((current) => (current === null || current === index ? null : current > index ? current - 1 : current));
  };
  /** Which side of a frame the pointer is on - the gap the picture would land in. */
  const sideOf = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? "before" : "after";
  };

  const cellProps = (index) => (canWrite && !saving ? {
    draggable: true,
    tabIndex: 0,
    role: "button",
    "aria-label": `Photograph ${index + 1}${selected === index ? ", selected" : ""}`,
    onClick: () => setSelected((current) => (current === index ? null : index)),
    onKeyDown: (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(index, index + (event.key === "ArrowLeft" ? -1 : 1)); return; }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected((current) => (current === index ? null : index)); }
    },
    onDragStart: (event) => { setDragging(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); },
    onDragEnd: () => { setDragging(null); setDropAt(null); },
    onDragOver: (event) => {
      if (dragging === null || dragging === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const side = sideOf(event);
      setDropAt((current) => (current?.index === index && current.side === side ? current : { index, side }));
    },
    onDrop: (event) => {
      if (dragging === null) return;
      event.preventDefault();
      move(dragging, dropIndex(dragging, index, sideOf(event)));
      setDragging(null);
      setDropAt(null);
    },
    className: `cursor-grab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${dragging === index ? "opacity-40" : ""}`,
  } : null);

  const renderCell = (photo, index) => <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={photo} alt="" className="pointer-events-none h-full w-full object-cover" />
    {selected === index && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-inset ring-blue-500" />}
    {dropAt?.index === index && <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 z-10 w-0.5 rounded-full bg-blue-500 ${dropAt.side === "before" ? "left-0" : "right-0"}`} />}
    <span aria-hidden="true" className="pointer-events-none absolute left-1 top-1 rounded bg-black/55 px-1.5 text-[10px] font-semibold leading-4 text-white">{index + 1}</span>
    {canWrite && <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-0.5 pb-0.5 pt-3">
      <button type="button" disabled={saving || index === 0} aria-label={`Move photograph ${index + 1} earlier`} onClick={(event) => { event.stopPropagation(); move(index, index - 1); }} className="rounded p-0.5 text-white/90 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent">
        <ChevronLeftIcon style={{ fontSize: 16 }} />
      </button>
      <button type="button" disabled={saving} aria-label={`Remove photograph ${index + 1}`} onClick={(event) => { event.stopPropagation(); removeAt(index); }} className="rounded p-0.5 text-white/90 hover:bg-rose-500/80">
        <CloseIcon style={{ fontSize: 16 }} />
      </button>
      <button type="button" disabled={saving || index === photos.length - 1} aria-label={`Move photograph ${index + 1} later`} onClick={(event) => { event.stopPropagation(); move(index, index + 1); }} className="rounded p-0.5 text-white/90 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent">
        <ChevronRightIcon style={{ fontSize: 16 }} />
      </button>
    </span>}
  </>;

  return <div className="mt-4 space-y-3">
    {photos.length === 0
      ? <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500 sm:text-sm">No photographs yet - this branch is left off the collage.</p>
      : <div className="w-full max-w-[612px]">
        <InfrastructureImageGrid photos={photos} cellClassName="bg-slate-100" cellProps={cellProps} renderCell={renderCell} />
      </div>}
    {canWrite && <div className="max-w-md">
      {/* One field for the whole branch: pointed at the selected frame, or at the next position
          when nothing is selected. A cleared field removes that photograph. */}
      {(selected !== null || !full) && <ImageUploadField
        key={selected === null ? "add" : `replace-${selected}`}
        label={selected === null ? `Add photograph ${photos.length + 1}` : `Replace photograph ${selected + 1}`}
        value={selected === null ? "" : photos[selected] || ""}
        helperText={selected !== null
          ? "Choosing a picture replaces this one where it stands, and clearing the field removes it. Click the frame again to stop replacing it."
          : "Added at the end. Drag a photograph, or use the chevrons on it, to arrange the collage; click one to replace it."}
        disabled={saving}
        maxBytes={PICTURE_PICK_LIMIT}
        compress={COLLAGE_PICTURE}
        onChange={(value) => {
          if (selected !== null) {
            if (value) setPhotos((current) => current.map((photo, position) => (position === selected ? value : photo)));
            else removeAt(selected);
            return;
          }
          // Guarded here as well as by the field being hidden at eight: a ninth must not slip in
          // between the picture being picked and the state settling.
          if (value) setPhotos((current) => (current.length >= MAX_INFRA_PHOTOS ? current : [...current, value]));
        }}
      />}
      {/* Kept on screen: the count left, and the limit once it is reached, are the state of the
          collage rather than an explanation of it. */}
      {selected === null && <p className="mt-1.5 text-[11px] text-slate-500">
        {full
          ? `This branch holds the most a collage can print - ${MAX_INFRA_PHOTOS} photographs. Remove one before adding another.`
          : `${MAX_INFRA_PHOTOS - photos.length} of ${MAX_INFRA_PHOTOS} left.`}
      </p>}
    </div>}
  </div>;
}

/**
 * One collage per branch: the branch's name, its state, and one to eight photographs.
 *
 * `branchOptions` is Organization -> Branches, active ones, as `{name, state}`. Offered less
 * whichever of them another collage has already claimed, so the same branch cannot be added twice
 * - the row's own current choice stays offered to it either way, whether or not another row
 * happens to share it, so opening a saved collage never finds its own branch missing from the
 * list.
 *
 * Picking a branch fills State from that branch's own record - the same field Organization ->
 * Branches edits - so it does not have to be typed and cannot be typed for the wrong branch by
 * mistake. It stays a plain field afterward: a state Organization -> Branches has not recorded
 * yet, or a wording the printed page should use instead, can still be typed or changed by hand.
 */
function InfrastructureEditor({ groups, setGroups, canWrite, saving, branchOptions = [] }) {
  const setPhotos = (index, update) => setGroups((current) => current.map((row, position) => (position === index ? { ...row, photos: update(row.photos) } : row)));
  const branchNames = branchOptions.map((branch) => branch.name);
  const stateFor = (name) => branchOptions.find((branch) => branch.name === name)?.state || "";
  const optionsFor = (index) => {
    const takenElsewhere = new Set(groups.filter((_, position) => position !== index).map((row) => row.title).filter(Boolean));
    const options = branchNames.filter((name) => !takenElsewhere.has(name));
    const current = groups[index]?.title;
    return current && !options.includes(current) ? [...options, current] : options;
  };
  return <div className="space-y-3">
    {canWrite && <div className="flex justify-end">
      <Button type="button" onClick={() => setGroups((current) => [...current, emptyGroup()])}>Add branch</Button>
    </div>}
    {groups.length === 0 && <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-xs text-slate-500 sm:text-sm">No collages yet - the section is left off the quotation.</p>}
    <div className="space-y-4">
      {groups.map((group, index) => <div key={index} className="rounded-lg border border-slate-200 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Dropdown label="Branch" placeholder="Select a branch" helperText="The branch whose photos this collage shows." value={group.title} readOnly={!canWrite} options={optionsFor(index)} onChange={(value) => setGroups((current) => current.map((row, position) => position === index ? { ...row, title: value, subtitle: stateFor(value) } : row))} />
          <TextField label="State" placeholder="Tamil Nadu" helperText="Printed after the branch name; filled from the branch you pick." value={group.subtitle} readOnly={!canWrite} onChange={(event) => setGroups((current) => current.map((row, position) => position === index ? { ...row, subtitle: event.target.value } : row))} />
          {canWrite && <div className="flex gap-2">
            <Button type="button" size="sm" ariaLabel="Move collage up" disabled={index === 0} onClick={() => setGroups((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</Button>
            <Button type="button" size="sm" ariaLabel="Move collage down" disabled={index === groups.length - 1} onClick={() => setGroups((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</Button>
            <Button type="button" size="sm" variant="danger" onClick={() => setGroups((current) => current.filter((_, position) => position !== index))}>Remove</Button>
          </div>}
        </div>
        <CollagePhotos photos={group.photos} setPhotos={(update) => setPhotos(index, update)} canWrite={canWrite} saving={saving} />
      </div>)}
    </div>
  </div>;
}

/** The Journey & Legacy milestones: a year and title, a line of detail, and the place on the right. */
function JourneyEditor({ rows, setRows, canWrite, journeyDefaults }) {
  return <div className="space-y-3">
    {canWrite && <div className="flex flex-wrap justify-end gap-2">
      {rows.length === 0 && journeyDefaults.length > 0 && <Button type="button" onClick={() => setRows(() => journeyDefaults.map((row) => ({ ...row })))}>Start from the standard timeline</Button>}
      <Button type="button" onClick={() => setRows((current) => [...current, emptyJourneyRow()])}>Add milestone</Button>
    </div>}
    {rows.length === 0
      ? <ol className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        {journeyDefaults.map((row, index) => <li key={index} className="text-xs text-slate-600 sm:text-sm"><span className="font-semibold text-slate-700">{row.year} • {row.title}</span> <span className="text-slate-500">— {row.detail}</span> <span className="italic text-slate-500">({row.place})</span></li>)}
      </ol>
      : <div className="space-y-3">
        {rows.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-end">
          <TextField label="Year" helperText="The year this milestone happened." value={row.year} readOnly={!canWrite} onChange={(event) => setRows((current) => current.map((item, position) => position === index ? { ...item, year: event.target.value } : item))} />
          <TextField label="Title" helperText="A few words naming the milestone." value={row.title} readOnly={!canWrite} onChange={(event) => setRows((current) => current.map((item, position) => position === index ? { ...item, title: event.target.value } : item))} />
          <TextField label="Detail" helperText="One short line on what changed that year." value={row.detail} readOnly={!canWrite} onChange={(event) => setRows((current) => current.map((item, position) => position === index ? { ...item, detail: event.target.value } : item))} />
          <TextField label="Place (right side)" helperText="The place printed opposite, on the right." value={row.place} readOnly={!canWrite} onChange={(event) => setRows((current) => current.map((item, position) => position === index ? { ...item, place: event.target.value } : item))} />
          {canWrite && <div className="flex gap-2">
            <Button type="button" size="sm" ariaLabel="Move milestone up" disabled={index === 0} onClick={() => setRows((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</Button>
            <Button type="button" size="sm" ariaLabel="Move milestone down" disabled={index === rows.length - 1} onClick={() => setRows((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</Button>
            <Button type="button" size="sm" variant="danger" onClick={() => setRows((current) => current.filter((_, position) => position !== index))}>Remove</Button>
          </div>}
        </div>)}
      </div>}
  </div>;
}

const cleanGroups = (groups) => groups
  .map((group) => ({ title: group.title.trim(), subtitle: group.subtitle.trim(), photos: group.photos.filter(Boolean) }))
  .filter((group) => group.title || group.photos.length);

const emptyCoverSet = () => ({ shoots: [], religion: "", coverImageUrl: "", thankYouImageUrl: "" });
const cleanCoverSets = (sets) => sets
  .map((set) => ({
    shoots: (set.shoots || []).filter(Boolean),
    coverImageUrl: set.coverImageUrl || null,
    thankYouImageUrl: set.thankYouImageUrl || null,
    religion: (set.religion || "").trim(),
  }))
  .filter((set) => set.shoots.length || set.religion || set.coverImageUrl || set.thankYouImageUrl);

/**
 * The cover and Thank You photographs a brand prints, per group of shoots.
 *
 * A quotation opens on the photograph of what it is mainly for - a wedding on a wedding picture, a
 * naming ceremony on a naming one - so the pair is chosen by the shoots on the quotation rather
 * than being one pair for the whole brand. Each set names the shoots it answers for, and a shoot
 * belongs to one set only: the dropdown in each row offers the brand's shoots less the ones the
 * other rows have already taken, so the sets cannot disagree about which picture a shoot gets.
 *
 * The first set is also the fallback. A quotation whose shoots are in no set at all, or which names
 * no shoot yet, prints that one - which is why it needs no shoots of its own to be useful, and why
 * a brand that had a single cover before picture sets existed reads back as exactly that.
 */
function CoverSetsEditor({ sets, shoots, religions = [], canWrite, saving, onChange }) {
  /*
   * ── One religion at a time ────────────────────────────────────────────────────────────────────
   *
   * The brand holds every set for every religion in one list; this screen shows the chosen
   * religion's and nothing else, so "Set 1, Set 2, Set 3" reads per religion the way somebody
   * filling them in thinks about them.
   *
   * `sets` is never narrowed on the way in and `onChange` is always given the **whole** list back,
   * which is the point that matters: editing Hinduism must not be a save that drops Christianity's
   * sets, and it would be if the editor only ever held what it could see.
   *
   * Without categories — a brand whose tab in Field Settings is still empty — there is no
   * selector and every set is shown, which is exactly the screen that existed before.
   */
  const grouped = religions.length > 0;
  const [religion, setReligion] = useState(religions[0] || "");
  // A religion removed from Field Settings while this was open must not leave the screen pointed at
  // a group that no longer exists.
  useEffect(() => {
    if (grouped && !religions.includes(religion)) setReligion(religions[0] || "");
  }, [grouped, religions, religion]);

  const belongs = (row) => !grouped || (row.religion || "") === religion;
  const others = grouped ? sets.filter((row) => !belongs(row)) : [];
  const mine = sets.filter(belongs);
  const rows = mine.length ? mine : [{ ...emptyCoverSet(), religion: grouped ? religion : "" }];

  // Every change writes the whole list: this religion's rows as edited, plus every other religion's
  // exactly as they were.
  const publish = (next) => onChange([...others, ...next]);
  const update = (index, changes) => publish(rows.map((row, position) => (position === index ? { ...row, ...changes } : row)));
  // Every shoot this brand quotes for, less the ones another set has claimed.
  /*
   * Every shoot this brand quotes for, less the ones another set has claimed **within this
   * religion**. A Wedding set for Hinduism and a Wedding set for Christianity are not in
   * competition, so one must not hide the shoot from the other.
   */
  const optionsFor = (index) => {
    const taken = new Set(rows.flatMap((row, position) => (position === index ? [] : row.shoots || [])));
    return shoots.filter((shoot) => !taken.has(shoot));
  };

  return <div className="space-y-4">
    {/*
      * Which religion's sets are being edited. One selector for the whole Pictures section rather
      * than one field per set: a studio fills in Hinduism's photographs, then Christianity's, and
      * the sets they are working through belong to the religion they are thinking about.
      */}
    {grouped && <div>
      {/* One tab per category the brand's Field Settings list holds - whatever it holds, so a
          category added there appears here on its own without a change to this screen. */}
      <Tabs
        tabs={religions.map((name) => ({ id: name, label: name }))}
        value={religion}
        onChange={(next) => { if (!saving) setReligion(next); }}
        ariaLabel="Category these picture sets are for"
        className="border-b border-slate-200"
      />
    </div>}

    {rows.map((row, index) => <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {index === 0
            ? (grouped ? `Set 1 - ${religion}'s fallback` : "Set 1 - also the fallback")
            : `Set ${index + 1}`}
        </p>
        {canWrite && rows.length > 1 && <Button type="button" size="sm" variant="danger" disabled={saving} onClick={() => publish(rows.filter((_, position) => position !== index))}>Remove set</Button>}
      </div>

      <div>
        <MultiSelectField
          label="Shoots this set is used for"
          searchable
          readOnly={!canWrite}
          disabled={saving}
          placeholder={index === 0 ? "Any shoot not listed in another set" : "Search and select shoots"}
          helperText={index === 0
            ? "Leave empty to use this pair for every shoot that no other set claims. Shoots picked here still print this pair."
            : "Only the shoots no other set has taken are offered."}
          options={optionsFor(index)}
          values={row.shoots || []}
          onChange={(next) => update(index, { shoots: next })}
        />

        {/*
          * The second thing a set may be named for, read exactly as the shoots beside it are: empty
          * means any religion, and naming one means this pair is used for that religion and no other.
          *
          * Unlike the shoots, a religion is *not* removed from the other sets' options. A shoot
          * belongs to one set, but "Hinduism" is a reasonable thing for both a Wedding set and a
          * Reception set to name.
          */}
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        {PDF_PICTURES.map(([key, label, hint]) => <div key={key}>
          {canWrite
            ? <ImageUploadField label={label} helperText={hint} value={row[key] || ""} disabled={saving} maxBytes={PICTURE_PICK_LIMIT} compress={LARGE_PICTURE} onChange={(value) => update(index, { [key]: value || "" })} />
            : <p className="flex items-center text-sm text-slate-600">{label}: {row[key] ? "uploaded" : "none"}<HelpTip text={hint} /></p>}
        </div>)}
      </div>

    </div>)}

    {canWrite && <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => publish([...rows, { ...emptyCoverSet(), religion: grouped ? religion : "" }])}>+ Add set</Button>}
  </div>;
}
const cleanJourney = (rows) => rows
  .map((row) => ({ year: row.year.trim(), title: row.title.trim(), detail: row.detail.trim(), place: row.place.trim() }))
  .filter((row) => row.year || row.title);

/**
 * A brand's own pictures on its client-facing PDF: the cover and Thank You sets, per category.
 *
 * Its own tab, its own Save. What it sends is `pdfAssets` alone - the brand PATCH applies a field
 * only where it is sent, so the wording and the download answer on PDF Content are not touched by
 * a save here, and a save there does not touch these. The sets, the categories, the shoots and the
 * uploads are exactly what the PDF Content tab used to hold; only where they sit changed.
 */
function PdfImageTab({ code, name, config, canWrite, onNotice, onError, patch, unsavedRef }) {
  const initial = useMemo(() => ({
    /*
     * The picture sets as the server hands them back, which is already one set holding whatever a
     * brand had before sets existed - so the screen opens on the studio's current pictures rather
     * than on an empty row, and saving does not quietly drop them.
     */
    coverSets: (config.pdfAssets?.coverSets || []).map((set) => ({
      shoots: [...(set.shoots || [])],
      coverImageUrl: set.coverImageUrl || "",
      thankYouImageUrl: set.thankYouImageUrl || "",
      religion: set.religion || "",
    })),
  }), [config.pdfAssets]);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  /*
   * The categories this brand may print a separate pair for: its own tab of Settings → Field
   * Settings → Categories, since every brand's quotation asks for one now. Empty while the studio
   * has not written that brand's list, which is what makes the tabs absent rather than a bar over
   * nothing - and the screen that existed before.
   */
  const [religions, setReligions] = useState([]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      getMasterData("religions", { active: true, vertical: code })
        .then((response) => { if (live) setReligions((response?.data || []).map((row) => row.name).filter(Boolean)); })
        // A list that will not load leaves the category tabs out rather than taking the screen
        // down: the sets are still shown, all of them, and still save.
        .catch(() => { if (live) setReligions([]); });
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [code]);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  // Published upward as PDF Content publishes its own - see there.
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = dirty;
    return () => { unsavedRef.current = false; };
  }, [dirty, unsavedRef]);

  async function save() {
    setSaving(true);
    try {
      const response = await updateQuotationBrand(code, { pdfAssets: { coverSets: cleanCoverSets(values.coverSets) } });
      const saved = response?.data || {};
      // The sets as they were stored, so the screen shows the links it now holds rather than the
      // data URIs it just uploaded, and a second save does not send the pictures a second time.
      patch({ brand: { ...config.brand, ...saved }, pdfAssets: { ...config.pdfAssets, ...(saved.pdfAssets || {}) } });
      onNotice?.(`${name} PDF images saved. Quotations already sent keep the pictures they were sent with.`);
    } catch (error) {
      onError?.(errorText(error, "Unable to save the PDF images."));
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-8">
    <section className="space-y-3">
      {sectionTitle("Pictures", `The photographs this brand's quotation opens and closes on, chosen by what the quotation is for. Pick the shoots a pair belongs to, then add another set for the shoots that deserve different pictures. A quotation prints the set its main event falls in; anything the sets do not name prints the first set.${religions.length > 0 ? " Each category has its own sets; a category with none falls back to the sets that name no category." : ""} Each picture is optional. The India map and the infrastructure collages are shared by every brand and live under General.`)}
      <CoverSetsEditor
        sets={values.coverSets}
        shoots={config.shoots || []}
        religions={religions}
        canWrite={canWrite}
        saving={saving}
        onChange={(coverSets) => setValues((current) => ({ ...current, coverSets }))}
      />
    </section>

    {canWrite && <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
      <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save PDF images"}</Button>
      {dirty && <Button type="button" disabled={saving} onClick={() => setValues(initial)}>Discard changes</Button>}
    </div>}
  </div>;
}

/** A brand's own words on its client-facing PDF, and whether its client may keep a copy. */
function PdfContentTab({ code, name, config, canWrite, onNotice, onError, patch, unsavedRef }) {
  const initial = useMemo(() => ({
    /*
     * Whether this brand's client may save their quotation as a file. Anything but a stored `true`
     * opens on No - a brand nobody has answered for has not agreed to it - which is also what the
     * server answers a brand it has no row for yet.
     */
    allowClientDownload: config.brand.allowClientDownload === true,
    ...Object.fromEntries(PDF_FIELDS.map(([key]) => [key, config.brand.pdfOverrides?.[key] || ""])),
  }), [config.brand]);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const defaults = config.pdfDefaults || {};

  /*
   * Published upward so the tab bar and the settings rail both know this screen is holding
   * something. Cleared on the way out: the edit goes with the tab, so a panel that has been
   * unmounted must stop claiming to hold one - otherwise the next click anywhere would ask about
   * work that no longer exists.
   */
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = dirty;
    return () => { unsavedRef.current = false; };
  }, [dirty, unsavedRef]);

  async function save() {
    setSaving(true);
    try {
      // The words and the download answer, and nothing else: the pictures are PDF Image's, saved
      // there, and a field the PATCH is not sent it leaves as it is.
      const response = await updateQuotationBrand(code, {
        allowClientDownload: values.allowClientDownload === true,
        pdfContent: Object.fromEntries(PDF_FIELDS.map(([key]) => [key, values[key] || ""])),
      });
      const saved = response?.data || {};
      patch({ brand: { ...config.brand, ...saved }, pdfAssets: { ...config.pdfAssets, ...(saved.pdfAssets || {}) } });
      onNotice?.(`${name} PDF content saved. Quotations already sent keep what they were sent with.`);
    } catch (error) {
      onError?.(errorText(error, "Unable to save the PDF content."));
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-8">
    {/*
      * Who may keep a copy, before the pictures that copy would be made of.
      *
      * Per brand rather than per quotation: it is the brand's posture towards its clients - a Corp
      * proposal is a file the client is meant to forward, a wedding one is meant to be read at the
      * link - and a salesperson should not have to decide it a hundred times. No is the default and
      * the answer to anything unreadable; the server refuses the file itself on No, so this is a
      * decision rather than a hidden button.
      */}
    <section className="space-y-3">
      {sectionTitle("Client download", "Whether the client reading this brand's quotation link may save it as a PDF. No hides the download control and refuses the file itself, so a link already sent stops handing out a copy the moment this is switched off. Your own download from Sales → Quotations is unaffected. The cover and Thank You photographs are on the PDF Image tab.")}
      {/* Full width on a phone, a field's width from `sm` up: a Yes/No does not need the row. */}
      <div className="w-full sm:max-w-xs">
        <Dropdown
          label="Allow Client Download"
          value={values.allowClientDownload ? "Yes" : "No"}
          readOnly={!canWrite}
          // "Yes" before "No" is the order the question is asked in, not the alphabet's.
          sorted={false}
          options={["Yes", "No"]}
          onChange={(value) => setValues((current) => ({ ...current, allowClientDownload: value === "Yes" }))}
        />
      </div>
    </section>

    <section className="space-y-5">
      {sectionTitle("Wording on the client's copy", "Only the words change; the layout, the type and the order of the sections are the same for every brand. Each field shows the standard wording it replaces, and a blank field prints that standard wording. {brand} inside a sentence prints as the brand's name. The Additional Notes, trademark, Journey & Legacy and Our Infrastructure wording is shared by every brand and lives under General.")}
      <WordingFields groups={PDF_FIELD_GROUPS} values={values} defaults={defaults} canWrite={canWrite} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
    </section>

    {canWrite && <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
      <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save PDF content"}</Button>
      {dirty && <Button type="button" disabled={saving} onClick={() => setValues(initial)}>Discard changes</Button>}
    </div>}
  </div>;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * General: the content every brand's quotation shares.
 *
 * The Additional Notes and Officially Trademarked Brand cards, Journey & Legacy (its headings,
 * the India map and the timeline) and Our Infrastructure (its headings, tagline and the collage
 * per branch) read the same on every brand's quotation, so they are kept once - on the studio's
 * quotation settings row - and edited here. Saved the moment Save is pressed; every version
 * already sent keeps what it was sent with.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export function QuotationGeneralSettingsPanel({ canWrite = false, onNotice, onError, unsavedRef }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState(null);
  const fields = useFormErrors();

  const initialFor = useCallback((general) => ({
    // Only an explicit false is off, so a settings row nobody has saved prints all four.
    sections: Object.fromEntries(SECTION_SWITCHES.map(([key]) => [key, general?.pdfSections?.[key] !== false])),
    assets: {
      indiaMapUrl: general?.pdfAssets?.indiaMapUrl || "",
      infrastructure: (general?.pdfAssets?.infrastructure || []).map((group) => ({ title: group.title || "", subtitle: group.subtitle || "", photos: [...(group.photos || [])] })),
      journey: (general?.pdfAssets?.journey || []).map((row) => ({ year: row.year || "", title: row.title || "", detail: row.detail || "", place: row.place || "" })),
    },
    ...Object.fromEntries(GENERAL_FIELDS.map(([key]) => [key, general?.pdfOverrides?.[key] || ""])),
  }), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getQuotationGeneralSettings();
      setConfig(response?.data || null);
      setValues(initialFor(response?.data));
    } catch (error) {
      onError?.(errorText(error, "Unable to load the shared quotation content."));
    } finally {
      setLoading(false);
    }
  }, [initialFor, onError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /*
   * Both worked out above the early return, because the effect that publishes the flag is a hook
   * and a hook cannot sit under a `return <Loader/>`. `initial` is then the same object the body
   * below compares against rather than a second copy of it.
   */
  const initial = useMemo(() => (config ? initialFor(config) : null), [config, initialFor]);
  const dirty = Boolean(values && initial) && JSON.stringify(values) !== JSON.stringify(initial);
  // Read by the settings rail and by the X when either is asked to leave this section.
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = dirty;
    return () => { unsavedRef.current = false; };
  }, [dirty, unsavedRef]);

  if (loading || !config || !values) return <Loader label="Loading shared quotation content..." />;

  const defaults = config.pdfDefaults || {};
  const setAssets = (update) => setValues((current) => ({ ...current, assets: { ...current.assets, ...update(current.assets) } }));

  async function save() {
    // The one wording field that is a figure, refused outside 1-60, said under itself.
    if (!fields.check({ validityMonths: validMonths(values.validityMonths) ? "" : "Enter a whole number of months from 1 to 60." })) return;
    setSaving(true);
    try {
      const response = await updateQuotationGeneralSettings({
        pdfContent: Object.fromEntries(GENERAL_FIELDS.map(([key]) => [key, values[key] || ""])),
        pdfAssets: {
          indiaMapUrl: values.assets.indiaMapUrl || null,
          infrastructure: cleanGroups(values.assets.infrastructure),
          journey: cleanJourney(values.assets.journey),
        },
        pdfSections: values.sections,
      });
      setConfig(response?.data || config);
      setValues(initialFor(response?.data || config));
      onNotice?.("Shared quotation content saved. Quotations already sent keep what they were sent with.");
    } catch (error) {
      onError?.(errorText(error, "Unable to save the shared quotation content."));
    } finally {
      setSaving(false);
    }
  }

  const group = (title) => GENERAL_FIELD_GROUPS.filter(([groupTitle]) => groupTitle === title);
  const onWord = (key, value) => { fields.clear(key); setValues((current) => ({ ...current, [key]: value })); };
  const setSection = (key, on) => setValues((current) => ({ ...current, sections: { ...current.sections, [key]: on } }));

  /*
   * A section's heading and its switch. Off, the whole card is left off the client's copy and the
   * fields below stay as they are - so wording and pictures can be prepared, or kept, without
   * printing. Quotations already raised keep the switches they were raised under.
   */
  // One line inside the Pricing & Total card: printed or not, beside its name.
  const partSwitch = (key, title) => {
    const on = values.sections[key] !== false;
    return <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <span className="text-sm text-slate-700">{title}</span>
      {canWrite
        ? <ToggleSwitch ariaLabel={`Print the ${title} on the quotation`} checked={on} onCheckedChange={(checked) => setSection(key, checked)} />
        : <span className="text-xs text-slate-500">{on ? "Printed" : "Not printed"}</span>}
    </div>;
  };

  // Each heading's ⓘ says what its switch does, plus anything the section needs explaining.
  const sectionHeader = (key, title, more = "") => {
    const on = values.sections[key] !== false;
    return <div className="flex flex-wrap items-center justify-between gap-3">
      {sectionTitle(title, more || "Off, this whole card is left off the client's copy and what is typed below it is kept.")}
      {canWrite
        ? <ToggleSwitch ariaLabel={`Print ${title} on the quotation`} checked={on} onCheckedChange={(checked) => setSection(key, checked)} />
        : <span className="text-xs text-slate-500">{on ? "Printed" : "Not printed"}</span>}
    </div>;
  };

  return <div className="space-y-8">
    <section className="space-y-4">
      {sectionHeader("pricing", "Pricing & Total", "The navy card with the quotation's total. Off, the whole card is left off the client's copy; each line in it can be left off on its own. The total and the GST charged never change here. A brand's own pictures and words are on its own screen.")}
      <div className="grid gap-2 sm:grid-cols-3">
        {partSwitch("gst", "GST line")}
        {partSwitch("payment", "Payment link")}
        {partSwitch("validity", "Validity line")}
      </div>
      <WordingFields groups={group("Pricing & Total")} values={values} defaults={defaults} canWrite={canWrite} onChange={onWord} errors={fields.errors} />
    </section>

    <section className="space-y-4">
      {sectionHeader("notes", "Additional Notes")}
      <WordingFields groups={group("Additional Notes")} values={values} defaults={defaults} canWrite={canWrite} onChange={onWord} />
    </section>

    <section className="space-y-4">
      {sectionHeader("trademark", "Officially Trademarked Brand")}
      <WordingFields groups={group("Officially Trademarked Brand")} values={values} defaults={defaults} canWrite={canWrite} onChange={onWord} />
    </section>

    <section className="space-y-4">
      {sectionHeader("journey", "Journey & Legacy", "Off, this whole card is left off the client's copy and what is typed below it is kept. One row per milestone: the year and title, a line of detail, and the place printed on the right. With no rows of your own, the standard timeline below prints.")}
      <WordingFields groups={group("Journey & Legacy")} values={values} defaults={defaults} canWrite={canWrite} onChange={onWord} />
      <div>
        {canWrite
          ? <ImageUploadField label="India map" helperText="Drawn faintly behind the timeline." value={values.assets.indiaMapUrl} disabled={saving} maxBytes={PICTURE_PICK_LIMIT} compress={MAP_PICTURE} onChange={(value) => setAssets(() => ({ indiaMapUrl: value || "" }))} />
          : <p className="flex items-center text-sm text-slate-600">India map: {values.assets.indiaMapUrl ? "uploaded" : "none"}<HelpTip text="Drawn faintly behind the timeline." /></p>}
      </div>
      <JourneyEditor rows={values.assets.journey} setRows={(update) => setAssets((assets) => ({ journey: update(assets.journey) }))} canWrite={canWrite} journeyDefaults={config.journeyDefaults || []} />
    </section>

    <section className="space-y-4">
      {sectionHeader("infrastructure", "Our Infrastructure", `Off, this whole card is left off the client's copy and what is typed below it is kept. One collage per branch: the branch's name, its state, and one to ${MAX_INFRA_PHOTOS} photographs. The composition follows the count - eight print the reference mosaic, fewer print a composition of their own - and every branch stands the same height on the page.`)}
      <WordingFields groups={group("Our Infrastructure")} values={values} defaults={defaults} canWrite={canWrite} onChange={onWord} />
      <InfrastructureEditor groups={values.assets.infrastructure} setGroups={(update) => setAssets((assets) => ({ infrastructure: update(assets.infrastructure) }))} canWrite={canWrite} saving={saving} branchOptions={config.branches || []} />
    </section>

    {canWrite && <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
      <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save shared content"}</Button>
      {dirty && <Button type="button" disabled={saving} onClick={() => { setValues(initial); fields.clearAll(); }}>Discard changes</Button>}
    </div>}
  </div>;
}

export { QUOTATION_BRANDS as QUOTATION_SETTINGS_BRANDS };
