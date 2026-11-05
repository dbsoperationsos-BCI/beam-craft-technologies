"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { quotationInfoSections } from "@/constants/infoPanelConfig";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useCompactView from "@/components/shared/useCompactView";
import { createSalesQuotation, createSalesQuotationVersion, deleteSalesQuotation, downloadSalesQuotationPdf, duplicateSalesQuotation, getSalesQuotation, getSalesQuotations, renewSalesQuotationLink } from "@/services/sales/projects.service";

import ProjectBookingPanel from "./ProjectBookingPanel";
import { quotationToProjectPrefill } from "./projectBooking";
import QuotationGeneratorPanel from "./QuotationGeneratorPanel";
import QuotationDuplicateDialog from "./QuotationDuplicateDialog";
import QuotationVersionsDialog from "./QuotationVersionsDialog";
import { isLinkActive, linkExpiryText, linkStatusLabel } from "./quotationLinkStatus";
import { publicOrigin } from "@/lib/publicOrigin";
import { QUOTATION_BRANDS, brandBadgeLabel, brandLabel, brandOfQuotation } from "@/lib/quotationBrand.mjs";
import { takeQuotationGeneratorDraft } from "@/lib/quotationGeneratorDraft";


/*
 * The register lists chains, not versions: one row per quotation showing the version that stands
 * today, with the rest of its history behind Version history. Six versions of one negotiation as
 * six rows would bury every other enquiry.
 *
 * A row is a quotation, not an enquiry. One enquiry can hold several - a Dum Dum package and a Corp
 * one, quoted the same week - and each is a row of its own with its own number and its own history,
 * because neither is a revision of the other. Only Edit adds a version to a row.
 */
const quotationColumns = [
  /*
   * The id alone, not the chain number beside it. `quotationId` is "QUT039-01" - the chain and the
   * version together - so a Quotation Number column printed "QUT039" next to something that
   * already said it, and cost a column's width to do so. The chain number is still what the
   * version-history dialog and the delete warning name, where the chain is the subject.
   */
  { id: "quotationId", label: "Quotation ID" },
  /*
   * What the studio calls it - `Quotation - Vertical - Branch - Client Name - Venue` - stamped on
   * the row when the version was raised, never rebuilt here. Beside the id because the two answer
   * the same question at different precisions: the id says exactly which document, the name says
   * which one you are looking at without having to read four other columns.
   */
  { id: "quotationName", label: "Quotation Name" },
  /*
   * Which of the three brands the quotation was raised under, as a small badge. It is the one
   * fact the name already states in words, but a badge can be scanned down a column and the tabs
   * above the table filter on the same value - so the column carries the word and the cell draws it.
   */
  { id: "brandName", label: "Brand" },
  { id: "versionCount", label: "Versions", type: "number" },
  { id: "enquiryId", label: "Enquiry ID" },
  { id: "clientName", label: "Client Name" },
  { id: "clientMainNumber", label: "Client Main Number" },
  { id: "sourceBranch", label: "Source Branch" },
  { id: "eventVenue", label: "Event Venue" },
  { id: "followedBy", label: "Followed By" },
  { id: "referredBy", label: "Reffered By" },
  { id: "secondaryContactNumber", label: "Secondary Contact Number" },
  { id: "quotationDate", label: "Quotation Date", type: "datetime" },
  { id: "validUntil", label: "Valid Until", type: "date" },
  { id: "amount", label: "Amount", type: "number" },
  { id: "status", label: "Status" },
  { id: "finalizedQuotation", label: "Finalized Quotation" },
  { id: "linkStatus", label: "Link" },
  { id: "linkExpiresAt", label: "Link Expires", type: "datetime" },
  { id: "createdAt", label: "Created At", type: "date" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/*
 * The two columns where the hour is part of the answer.
 *
 * A quotation is raised at a moment, and its link stops opening at one - five days to the minute
 * from when it was generated. Shown as a bare day, "expires today" reads the same at nine in the
 * morning as at half past eleven at night, which is the difference between a link somebody can
 * still send and one they cannot.
 */
function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/*
 * The two columns the server does not store: whether this version's link still opens, and how many
 * versions the chain holds. Written onto the row as it arrives so the table can sort, filter and
 * export them like any other column rather than special-casing a cell renderer.
 */
function decorateQuotation(quotation) {
  const quotationBrand = brandOfQuotation(quotation);
  return {
    ...quotation,
    quotationBrand,
    // The brand as a word, so the column, the info panel and the CSV export all read "Dum Dum"
    // rather than a code.
    brandName: brandLabel(quotationBrand),
    linkStatus: linkStatusLabel(quotation),
    versionCount: quotation.versionCount ?? (quotation.versions?.length || 1),
    /*
     * Blank, not "Not selected", for a version nobody converted at.
     *
     * Only one version of a chain is ever the one that closed the sale, so a column that named
     * every other version would print a negative on almost every row and bury the one row that
     * says something. An empty cell beside a marked one reads as "not this one" without being
     * told, and sorting the column brings the finalized versions together.
     */
    finalizedQuotation: quotation.finalized ? "Selected" : "",
  };
}

/*
 * One earlier version, shaped as a row of the register.
 *
 * The chain's own columns - client, branch, venue - are the same for every version of it, so they
 * come across; what the version itself knows overrides them. `payload` is deliberately dropped: the
 * chain row carries the *current* version's payload, and letting a v1 row inherit it would open the
 * generator on v3's answers under v1's name. The row is read back in full when it is opened.
 */
function versionRow(chain, version) {
  const { payload, ...chainFields } = chain;
  return {
    ...decorateQuotation({ ...chainFields, ...version, versions: chain.versions }),
    // Blank rather than repeated: the count belongs to the chain, and printing "3 versions" on each
    // of the three would read as nine.
    versionCount: null,
    // Nothing hangs under a version, and it holds no payload of its own until it is opened.
    isVersionRow: true,
  };
}

/** The earlier versions of a chain. The row itself is the current one, so it is not repeated. */
function earlierVersions(chain) {
  if (chain?.isVersionRow) return [];
  return (chain?.versions || []).filter((version) => version.id !== chain.id).map((version) => versionRow(chain, version));
}

function displayValue(quotation, column) {
  const value = quotation[column.id];
  // The one column whose empty state is empty. Every other blank cell reads "—" to say the field
  // was never filled in; here a blank means "not the version that was sold", which the marked row
  // beside it already explains.
  if (column.id === "finalizedQuotation") return value || "";
  if (column.type === "datetime") return formatDateTime(value);
  if (column.type === "date") return formatDate(value);
  if (column.type === "number") return value === null || value === undefined || value === "" ? "—" : new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  return value || "—";
}

/**
 * The marker on the version a project converted at.
 *
 * A green dot and a border, the way a status is stated everywhere else in the app, rather than a
 * plain word - this is the one row of a chain that says the negotiation ended, and it has to be
 * findable by glancing down the column. Nothing at all on the versions that were not chosen.
 *
 * The project's own event id rides along in the tooltip: "which version was finalized" and "by
 * which project" are the same question asked twice, and the second answer costs nothing here.
 */
function FinalizedQuotationCell({ quotation }) {
  if (!quotation.finalized) return null;
  return <span
    title={quotation.finalizedByEventId ? `Finalized on project ${quotation.finalizedByEventId}` : "Finalized on a project"}
    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
  >
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
    Selected
  </span>;
}

/*
 * The brand badge: the same small pill the finalized marker uses, in a quiet grey rather than the
 * status green - a brand is a fact about the row, not a state it has reached.
 */
function BrandBadge({ code }) {
  if (!code) return null;
  return <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">{brandBadgeLabel(code)}</span>;
}

/*
 * The tabs over the register: every brand, then one per brand. The count beside each is the
 * chains it would show, so the tab says how much of the register it holds before it is pressed.
 */
const BRAND_TAB_ALL = "ALL";

function brandTabs(quotations) {
  const counts = new Map();
  for (const chain of quotations) counts.set(chain.quotationBrand, (counts.get(chain.quotationBrand) || 0) + 1);
  return [
    { id: BRAND_TAB_ALL, label: "All", count: quotations.length },
    ...QUOTATION_BRANDS.map((brand) => ({ id: brand.code, label: brand.label, count: counts.get(brand.code) || 0 })),
  ];
}

function sortValue(quotation, column) {
  const value = quotation[column.id];
  if (column.type === "number") return Number(value) || 0;
  // Both kinds sort on the instant behind them, so a column showing the hour still orders by it.
  if (column.type === "date" || column.type === "datetime") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return String(value || "").toLocaleLowerCase();
}

/**
 * Whether a project has already been booked from this quotation - any version of it.
 *
 * A project converts at one version, so the row's own `finalized` answers only for the version on
 * screen. The question worth asking is about the whole chain: a quotation whose v1 became a project
 * has been booked, and offering Create Project on its v3 would invite a second project against one
 * negotiation. Every version carries the flag, which is what makes this readable without a fetch.
 */
const bookedFromChain = (chain) => Boolean(chain?.finalized) || (chain?.versions || []).some((version) => version.finalized);

export default function QuotationPage() {
  // SALES / Quotation Management. Reading the register and a chain's versions is a read; raising a
  // version, duplicating one, deleting one and re-enabling a link are writes and are hidden
  // without READ_WRITE.
  const { canWrite } = useRouteAccess();
  /*
   * Booking a project is `SALES / Sales Manager`, not this screen's permission.
   *
   * Being able to raise a quotation is not being able to book the project it becomes, and the
   * endpoint behind Create Project answers to Sales Manager - so the entry is absent for a role
   * that only quotes, rather than leading to a form whose Save the server refuses.
   */
  const { canWrite: canCreateProject } = useModuleAccess("SALES", "Sales Manager");
  // The quotation a project is being booked from, mapped into the shape the booking panel prefills
  // from. Null whenever no booking is in progress.
  const [bookingPrefill, setBookingPrefill] = useState(null);
  const [quotations, setQuotations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState(null);
  const [deletingQuotation, setDeletingQuotation] = useState(null);
  const [shareQuotation, setShareQuotation] = useState(null);
  // The chain the generator is editing, kept beside the version loaded into it: the chain carries
  // the version list the picker offers, the version carries the payload the form is built from.
  const [editingChain, setEditingChain] = useState(null);
  // A quotation started on the CRM's Quotation Calculator, waiting for the generator to open on it.
  const [generatorDraft, setGeneratorDraft] = useState(null);
  const [versionsQuotation, setVersionsQuotation] = useState(null);
  // The version being copied onto another enquiry, which may be the register row or one picked out
  // of the version history.
  const [duplicatingQuotation, setDuplicatingQuotation] = useState(null);
  const [duplicating, setDuplicating] = useState(false);
  const [renewingId, setRenewingId] = useState("");
  const [savingQuotation, setSavingQuotation] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  // Which brand's chains the table shows. Filtered here, over the rows already loaded, so pressing
  // a tab is immediate and the search, the sort, the export and the row actions carry on as they
  // are - the table simply sees fewer rows.
  const [brandTab, setBrandTab] = useState(BRAND_TAB_ALL);
  const visibleQuotations = useMemo(() => brandTab === BRAND_TAB_ALL ? quotations : quotations.filter((chain) => chain.quotationBrand === brandTab), [brandTab, quotations]);
  const tabs = useMemo(() => brandTabs(quotations), [quotations]);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * `rows` is the chains on screen, not their earlier versions: a version is a sub-row under its
   * chain, and `selectedFrom` only ever matches what this list holds. A version ticked under an
   * open chevron is still a quotation the server will delete by id - it is the same record the row
   * menu's Delete removes - it just is not counted here, which keeps the count honest for the
   * common case of ticking the register itself.
   */
  const bulk = useTableSelection({
    prefix: "/api/sales/quotations",
    rows: visibleQuotations,
    noun: "quotation",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => loadQuotations({ notifyOnError: false }),
  });

  const loadQuotations = useCallback(async ({ notifyOnError = true } = {}) => {
    setIsLoading(true);
    try {
      const response = await getSalesQuotations();
      setQuotations(Array.isArray(response?.data) ? response.data.map(decorateQuotation) : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load quotations.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQuotations(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQuotations]);

  // Single click selects the row and fills the panel beside it; double-click reads the quotation
  // back in full. The same pair every other table in the OS answers to.
  const [infoQuotation, setInfoQuotation] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [viewingQuotation, setViewingQuotation] = useState(null);

  /*
   * Opens the generator on a version. The register row is already the chain's current version,
   * payload and all, so opening it costs no request; a row expanded out of the chain carries no
   * payload of its own and is read back in full first.
   */
  const openGenerator = useCallback(async (row) => {
    if (!row) {
      setEditingChain(null);
      setEditingQuotation(null);
      setGeneratorOpen(true);
      return;
    }
    setEditingChain(row);
    if (row.payload) {
      setEditingQuotation(row);
      setGeneratorOpen(true);
      return;
    }
    try {
      const response = await getSalesQuotation(row.id);
      setEditingQuotation(decorateQuotation({ ...response.data, versions: row.versions }));
      setGeneratorOpen(true);
    } catch (error) {
      showError(error.message || "Unable to open that version.");
    }
    }, [showError]);

  /*
   * Books the project this quotation was raised for, without leaving the register.
   *
   * The version is read back in full first rather than prefilled from the row. Two reasons, and
   * the second is the one that matters: an earlier-version row carries no `payload` of its own -
   * `versionRow` drops it deliberately - so the vertical the prefill needs is simply not there;
   * and a register loaded some minutes ago is not what the project should be booked against.
   */
  const openBooking = useCallback(async (quotationRowId) => {
    try {
      const response = await getSalesQuotation(quotationRowId);
      setBookingPrefill(quotationToProjectPrefill(response.data));
    } catch (error) {
      showError(error.message || "Unable to open that quotation.");
    }
  }, [showError]);

  const columns = useMemo(() => quotationColumns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (quotation) => displayValue(quotation, column),
    sortingFn: (first, second) => {
      const a = sortValue(first.original, column);
      const b = sortValue(second.original, column);
      return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
    },
    /*
     * Editing does not change this quotation, it raises the next version of it; Duplicate writes one
     * under another enquiry. Both are writes, so both are absent without READ_WRITE rather than
     * present and refused.
     */
    cell: column.id === "actions" ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.quotationId || row.original.quotationNumber || "quotation"}`} items={[
      // The only way to reach the record view on a touch screen, where a double-click is the
      // browser's zoom gesture rather than something a row ever receives.
      { label: "View", onSelect: () => setViewingQuotation(row.original) },
      // Editing does not change this quotation, it raises the next version of it.
      ...(canWrite ? [{ label: "Edit", onSelect: () => void openGenerator(row.original) }] : []),
      /*
       * Where a quotation is opened, copied, saved as a PDF and re-enabled - offered on every row,
       * however many versions the chain has.
       *
       * It used to appear only on a chain with more than one, on the reasoning that a list of one
       * version is the row you are already looking at. True of the *list*, and wrong about the
       * point: the actions underneath each version are the only way to reach the link the client
       * was sent, so a quotation raised once had no way to be downloaded or copied from the
       * register at all. The dialog already drew a single version correctly.
       *
       * Named for what it holds in each case - the history where there is one, the link where there
       * is not - so the entry says what pressing it will show. "Quotation link" said *quotation*
       * twice on a menu already opened from a quotation's own row.
       *
       * Read off `versions` rather than `versionCount`: the count is blanked on an earlier-version
       * row on purpose - `versionRow` - so the register's own Versions column does not repeat "3
       * versions" on every row of a chain already known to have three. The array itself is not; it
       * rides along on every row of a chain, current version and earlier ones alike, so this is
       * offered from a version row exactly as it is from the chain's current one.
       */
      { label: (row.original.versions?.length || 0) > 1 ? "Versions" : "Link", onSelect: () => setVersionsQuotation(row.original) },
      /*
       * Booking the project this quotation was raised for, offered while nothing has been booked
       * from it yet.
       *
       * "Nothing" means the whole chain, not this row: a project converts at one *version*, and a
       * chain with an earlier version already converted is a quotation that has been booked -
       * offering it again would invite a second project against one negotiation. `finalized` rides
       * on every version for exactly this reading.
       *
       * The project is booked here, on the register, rather than by being sent to Bookings &
       * Converted to start again: the quotation is what is being acted on and the studio is in the
       * middle of reading it. `ProjectBookingPanel` is the same panel and the same save that
       * screen uses, so there is still one definition of what booking a project means - the two
       * screens share it rather than each having one.
       */
      ...(canCreateProject && !bookedFromChain(row.original)
        ? [{ label: "Create Project", onSelect: () => void openBooking(row.original.id) }]
        : []),
      // Duplicating writes a quotation under another enquiry, so it is a write and is absent
      // without READ_WRITE rather than present and refused.
      ...(canWrite ? [{ label: "Duplicate", onSelect: () => setDuplicatingQuotation(row.original) }] : []),
      ...(canWrite ? [{ label: "Delete", tone: "danger", onSelect: () => setDeletingQuotation(row.original) }] : []),
    ]} /> : column.id === "finalizedQuotation"
      ? ({ row }) => <FinalizedQuotationCell quotation={row.original} />
      : column.id === "brandName"
        ? ({ row }) => <BrandBadge code={row.original.quotationBrand} />
        : ({ row }) => displayValue(row.original, column),
    exportValue: (quotation) => displayValue(quotation, column),
    // The name is five facts joined by dashes, so it is given room the other columns do not need.
    width: column.id === "actions" ? 56 : column.id === "quotationName" ? 320 : column.id === "brandName" ? 110 : 180,
    minWidth: column.id === "actions" ? 56 : column.id === "quotationName" ? 240 : column.id === "brandName" ? 96 : 160,
  })), [canCreateProject, canWrite, openBooking, openGenerator]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  function publicUrl(quotation) {
    if (!quotation?.publicPath) return "";
    return `${publicOrigin()}${quotation.publicPath}`;
  }

  async function downloadPdf(quotation) {
    /*
     * The server renders the client-facing page to a PDF and returns it as a download, so this
     * saves a file rather than opening the browser's print dialog for the user to save from.
     *
     * The studio's own route rather than the client's link: the client's now answers to the brand's
     * Allow Client Download, and a brand that does not hand its clients a copy must still hand one
     * to the salesperson sending the proposal on. Signed in, so the file is fetched with the token
     * and saved from the bytes rather than by pointing the browser at an address.
     */
    if (!quotation?.id) return;
    try {
      await downloadSalesQuotationPdf(quotation.id, `${quotation.quotationId || "quotation"}.pdf`);
    } catch (error) {
      showError(error?.message || "Unable to download the quotation PDF.");
    }
  }

  async function copyPublicLink(quotation) {
    const url = publicUrl(quotation);
    try {
      await navigator.clipboard.writeText(url);
      showNotice("Public quotation link copied.");
    } catch {
      showError("Unable to copy. Select the link manually.");
    }
  }

  function closeGenerator() {
    setGeneratorOpen(false);
    setEditingQuotation(null);
    setEditingChain(null);
    setGeneratorDraft(null);
  }

  /*
   * The calculator's handoff: Apply to Quotation over there stashes a draft and sends the person
   * here, and the generator opens on it as a new quotation the moment this screen can raise one.
   * Taken, not read - a second visit to Quotations must not reopen a form already dealt with - and
   * only for a writer, because that is who the generator is offered to.
   */
  useEffect(() => {
    if (!canWrite) return undefined;
    // Deferred a tick, as the register's own first load is, so the pickup is not a state change
    // made inside the effect body.
    const timer = window.setTimeout(() => {
      const draft = takeQuotationGeneratorDraft();
      if (!draft) return;
      setEditingChain(null);
      setEditingQuotation(null);
      setGeneratorDraft(draft);
      setGeneratorOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canWrite]);

  /** Loads an earlier version into the generator, so the next version can be raised from it. */
  async function loadVersionIntoGenerator(versionId) {
    if (!versionId || versionId === editingQuotation?.id) return;
    try {
      const response = await getSalesQuotation(versionId);
      setEditingQuotation(decorateQuotation(response.data));
    } catch (error) {
      showError(error.message || "Unable to load that version.");
    }
  }

  /*
   * Saving always writes a version, and which one it is depends on how the generator was opened.
   *
   * Opened on a quotation - Edit - it raises that quotation's next version. Opened empty it writes
   * version 1 of a new quotation, even for an enquiry already being quoted for: those are two
   * packages, not two drafts of one, and only an edit says "this replaces what I sent you".
   *
   * The whole list is re-read afterwards rather than patched, because a new quotation is a new row
   * and a new version changes the row that is already there.
   */
  async function addGeneratedQuotation(quotation) {
    const source = editingQuotation;
    setSavingQuotation(true);
    try {
      const response = source
        ? await createSalesQuotationVersion(source.id, quotation)
        : await createSalesQuotation(quotation);
      const saved = decorateQuotation(response.data);
      await loadQuotations({ notifyOnError: false });
      closeGenerator();
      setShareQuotation(saved);
      showNotice(source ? `${saved.quotationId} raised as the new version.` : `${saved.quotationId} generated and added to inventory.`);
    } catch (error) {
      showError(error.message || "Unable to save quotation.");
    } finally {
      setSavingQuotation(false);
    }
  }

  /*
   * A renewed link changes one version, which may be the row in the register, a row in the version
   * history, or both at once. Patched in place rather than re-read: the list is unchanged apart
   * from this one clock, and reloading it would close the dialog the button was pressed in.
   */
  function applyRenewedVersion(saved) {
    const patchChain = (chain) => {
      if (chain.quotationNumber !== saved.quotationNumber) return chain;
      const versions = (chain.versions || []).map((version) => version.id === saved.id
        ? { ...version, linkExpiresAt: saved.linkExpiresAt, linkActive: saved.linkActive }
        : version);
      return decorateQuotation({ ...chain, ...(chain.id === saved.id ? saved : {}), versions });
    };
    setQuotations((current) => current.map(patchChain));
    setShareQuotation((current) => current?.id === saved.id ? saved : current);
    setVersionsQuotation((current) => current ? patchChain(current) : current);
  }

  /*
   * Copies a version onto another enquiry, as a quotation of its own.
   *
   * The whole list is re-read afterwards: the copy is a new row of the register, not a version of
   * anything the target enquiry was quoted before.
   */
  async function duplicateVersion(enquiryId) {
    if (!duplicatingQuotation) return;
    setDuplicating(true);
    try {
      const response = await duplicateSalesQuotation(duplicatingQuotation.id, enquiryId);
      const saved = decorateQuotation(response.data);
      await loadQuotations({ notifyOnError: false });
      setDuplicatingQuotation(null);
      setVersionsQuotation(null);
      setShareQuotation(saved);
      showNotice(`${saved.quotationId} duplicated onto ${enquiryId}.`);
    } catch (error) {
      showError(error.message || "Unable to duplicate quotation.");
    } finally {
      setDuplicating(false);
    }
  }

  async function renewLink(version) {
    if (!version?.id) return;
    setRenewingId(version.id);
    try {
      const response = await renewSalesQuotationLink(version.id);
      applyRenewedVersion(decorateQuotation(response.data));
      showNotice(`${version.quotationId || "Quotation"} link re-enabled for 5 days.`);
    } catch (error) {
      showError(error.message || "Unable to re-enable the quotation link.");
    } finally {
      setRenewingId("");
    }
  }

  async function confirmDeleteQuotation() {
    if (!deletingQuotation) return;
    try {
      await deleteSalesQuotation(deletingQuotation.id);
      // Re-read rather than drop the row: deleting the current version leaves the chain standing on
      // the version below it, and filtering the row out would hide a quotation that still exists.
      setDeletingQuotation(null);
      await loadQuotations({ notifyOnError: false });
      showNotice("Quotation version deleted.");
    } catch (error) {
      showError(error.message || "Unable to delete quotation.");
    }
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    {/* The generator writes - it creates a quotation - so it is gated on this screen's own
        SALES / Quotation Management. The pricing catalogue it prices with is no longer edited from
        here; `/api/sales/quotation-settings` and its dialog are untouched and have no way in. */}
    <ModulePageHeader
      title="Quotations"
      tabs={tabs}
      tabValue={brandTab}
      onTabChange={setBrandTab}
      tabsAriaLabel="Quotation brand"
      actions={canWrite ? <Button type="button" variant="primary" onClick={() => void openGenerator(null)}>Quotation generator</Button> : null}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* Booking a project from a quotation, on the register rather than on another screen. The
        panel and its save are Bookings & Converted's own, shared rather than repeated. */}
    {bookingPrefill && <ProjectBookingPanel
      prefill={bookingPrefill}
      onClose={() => setBookingPrefill(null)}
      /* The register is re-read so the quotation that has now been booked stops offering to book
         again - `finalized` is what the entry reads, and it only changes on the server. */
      onSaved={() => loadQuotations({ notifyOnError: false })}
      onNotice={showNotice}
      onError={showError}
    />}
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1">
        <DataTable
          columns={columns}
          data={visibleQuotations}
          density={density}
          loading={isLoading}
          loadingMessage="Loading quotations..."
          emptyMessage={brandTab === BRAND_TAB_ALL ? "Generated quotations will appear here." : `No ${brandLabel(brandTab)} quotations yet.`}
          noMatchMessage="No quotations found."
          onVisibleRowsChange={setTableStats}
          selectedRowId={infoQuotation?.id}
          onRowClick={(row) => { setInfoQuotation(row); setInfoPanelState("expanded"); }}
          onRowDoubleClick={setViewingQuotation}
          ariaLabel="Quotation inventory table"
          /* One row per chain, with its earlier versions folded under a chevron: the register stays a
             list of enquiries, and the history is one click away on the row it belongs to. */
          features={{ filtering: true, sorting: true, columnVisibility: true, expandable: { label: "earlier versions of this quotation", canExpand: (row) => !row.isVersionRow && (row.versionCount || 1) > 1, getSubRows: earlierVersions }, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: "sales-quotations", onResult: (exported) => showNotice(exported ? "Quotation CSV export downloaded." : "No quotations available to export.") }, selection: bulk.selection }}
        />
        </div>
        <DataTableInfoPanel
          title="Quotations"
          entity={infoQuotation}
          sections={quotationInfoSections}
          emptyText="Select a quotation row to view details."
          state={infoPanelState}
          onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
        />
        </div>
      </DataTableShell>
    </div>
    {viewingQuotation && <RecordViewPanel
      title={viewingQuotation.quotationId || viewingQuotation.quotationNumber || "Quotation"}
      entity={viewingQuotation}
      sections={quotationInfoSections}
      sidebarAriaLabel="Quotation sections"
      onClose={() => setViewingQuotation(null)}
    />}
    {/* Keyed on the version loaded, so picking another version rebuilds the form from that
        version's payload instead of leaving the last one's answers underneath it. */}
    {generatorOpen && <QuotationGeneratorPanel
      key={editingQuotation?.id || (generatorDraft ? "calculator-draft" : "new-quotation")}
      initialQuotation={editingQuotation}
      initialDraft={editingQuotation ? null : generatorDraft}
      versions={editingChain?.versions || []}
      selectedVersionId={editingQuotation?.id || ""}
      onSelectVersion={loadVersionIntoGenerator}
      onClose={closeGenerator}
      onGenerate={addGeneratedQuotation}
    />}
    {shareQuotation && <Dialog
      title={`${shareQuotation.quotationId || "Quotation"} ready`}
      description="This link opens the quotation without a login, for five days."
      size="md"
      busy={savingQuotation}
      onClose={() => setShareQuotation(null)}
      footer={<>
        <Button type="button" onClick={() => setShareQuotation(null)}>Done</Button>
        {/* A lapsed link is not something to send: the actions that hand it out give way to the
            one that reopens it. */}
        {isLinkActive(shareQuotation) ? <>
          <Button type="button" onClick={() => downloadPdf(shareQuotation)}>Download PDF</Button>
          <Button type="button" onClick={() => void copyPublicLink(shareQuotation)}>Copy Link</Button>
          <Button type="button" variant="primary" onClick={() => window.open(publicUrl(shareQuotation), "_blank", "noopener,noreferrer")}>Open Quotation</Button>
        </> : canWrite ? <Button
          type="button"
          variant="primary"
          disabled={renewingId === shareQuotation.id}
          onClick={() => void renewLink(shareQuotation)}
        >
          {renewingId === shareQuotation.id ? "Re-enabling…" : "Re-enable for 5 days"}
        </Button> : null}
      </>}
    >
      <div className="space-y-4 pb-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-600">{shareQuotation.quotationNumber} · version {String(shareQuotation.version || 1).padStart(2, "0")}</p>
          {isLinkActive(shareQuotation)
            ? <a href={publicUrl(shareQuotation)} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm font-medium text-blue-700 underline">{publicUrl(shareQuotation)}</a>
            : <p className="mt-1 break-all text-sm text-slate-500">{publicUrl(shareQuotation)}</p>}
          <p className={`mt-2 text-xs ${isLinkActive(shareQuotation) ? "text-emerald-700" : "text-red-700"}`}>{linkExpiryText(shareQuotation)}</p>
        </div>
      </div>
    </Dialog>}
    {versionsQuotation && <QuotationVersionsDialog
      quotation={versionsQuotation}
      canWrite={canWrite}
      renewingId={renewingId}
      onRenew={renewLink}
      onCopyLink={(version) => void copyPublicLink(version)}
      onDownloadPdf={downloadPdf}
      /*
       * The same generator the register row's Edit opens, on this version rather than on whichever
       * one stands today — `openGenerator` reads a version back in full when it carries no payload,
       * which is every row in this list except the chain's current one. The history closes behind
       * it: leaving it open over the form would put the version being edited behind the panel
       * editing it.
       */
      onEditVersion={(version) => { setVersionsQuotation(null); void openGenerator({ ...version, versions: versionsQuotation.versions }); }}
      onClose={() => setVersionsQuotation(null)}
    />}
    {duplicatingQuotation && <QuotationDuplicateDialog
      quotation={duplicatingQuotation}
      saving={duplicating}
      onDuplicate={duplicateVersion}
      onClose={() => setDuplicatingQuotation(null)}
    />}
    <ConfirmDialog
      open={Boolean(deletingQuotation)}
      title="Delete quotation?"
      message={`This removes ${deletingQuotation?.quotationId || "this quotation"} from the quotation inventory. Earlier versions of ${deletingQuotation?.quotationNumber || "this chain"} are kept.`}
      confirmLabel="Delete"
      onCancel={() => setDeletingQuotation(null)}
      onConfirm={confirmDeleteQuotation}
    />
  </section>;
}
