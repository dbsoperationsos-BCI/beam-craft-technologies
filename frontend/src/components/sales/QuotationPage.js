"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
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
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { createSalesQuotation, createSalesQuotationDraft, createSalesQuotationVersion, deleteSalesQuotation, downloadSalesQuotationPdf, finalizeSalesQuotation, generateSalesQuotationDraft, getSalesQuotation, getSalesQuotations, renewSalesQuotationLink, unfinalizeSalesQuotation, updateSalesQuotationDraft } from "@/services/sales/projects.service";

import ProjectBookingPanel from "./ProjectBookingPanel";
import { draftKeptUntil } from "./ProjectDraftsDialog";
import useProjectDrafts from "./useProjectDrafts";
import { projectDraftTitle } from "@/lib/projectDrafts.mjs";
import { quotationToProjectPrefill } from "./projectBooking";
import QuotationGeneratorPanel from "./QuotationGeneratorPanel";
import QuotationVersionsDialog from "./QuotationVersionsDialog";
import { isDraftQuotation, isFinalizedQuotation, isLinkActive, linkExpiryText, linkStatusLabel } from "./quotationLinkStatus";
import { publicOrigin } from "@/lib/publicOrigin";
import { QUOTATION_BRANDS, brandBadgeLabel, brandLabel, brandOfQuotation } from "@/lib/quotationBrand.mjs";
import { takeQuotationGeneratorDraft } from "@/lib/quotationGeneratorDraft";
import { clearEditingDrafts, editingDraftScope, readEditingDraft } from "@/lib/quotationEditingDraft.mjs";


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
    isDraft: isDraftQuotation(quotation),
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

/** Whether a row is a chain of the register rather than an earlier version opened under one. */
const isChainRow = (row) => !row?.isVersionRow;

/*
 * A duplicate open in the generator, named in the address so a reload opens it again rather than
 * dropping what was on screen: `?duplicate=<source version id>`. Replaced rather than pushed, so Back
 * leaves the register instead of reopening a form that was closed.
 */
const DUPLICATE_PARAM = "duplicate";

function setDuplicateParam(sourceId) {
  const url = new URL(window.location.href);
  if (sourceId) url.searchParams.set(DUPLICATE_PARAM, sourceId);
  else url.searchParams.delete(DUPLICATE_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

/*
 * The version being edited, in the address the same way: `?edit=<version id>`. A reload reopens the
 * generator on it, with the edits auto-saved in this tab (`lib/quotationEditingDraft.mjs`) put back
 * - the published quotation is never what changes until Save as New Version is pressed.
 */
const EDIT_PARAM = "edit";

function setEditParam(versionId) {
  const url = new URL(window.location.href);
  if (versionId) url.searchParams.set(EDIT_PARAM, versionId);
  else url.searchParams.delete(EDIT_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

/*
 * What a duplicate opens on: the source version's payload, with its row's own columns underneath
 * for a version raised before the payload carried them. Nothing that identifies the source goes
 * across - no id, number, version or link - because the generator builds the saved quotation from
 * its own fields and the server numbers it as a new chain. The enquiry is left empty as well: a
 * duplicate is for another enquiry, which is chosen afresh rather than carried over from the source.
 */
function duplicateDraft(source) {
  return {
    clientName: source.clientName,
    clientMainNumber: source.clientMainNumber,
    sourceBranch: source.sourceBranch,
    eventVenue: source.eventVenue,
    followedBy: source.followedBy,
    referredBy: source.referredBy,
    secondaryContactNumber: source.secondaryContactNumber,
    additionalNotes: source.additionalNotes,
    discount: source.discount,
    ...(source.payload || {}),
    enquiryId: "",
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
 * The tabs over the register: every brand, then one per brand, then the drafts. The count beside
 * each is the chains it would show, so the tab says how much of the register it holds before it is
 * pressed.
 *
 * All and the brand tabs are the generated quotations - what they have always listed, and what a
 * client can have been sent. A draft has been sent to nobody, so it sits under Draft alone, whatever
 * its brand (the Brand column still says which), rather than being counted among quotations that
 * exist for a client. Generating a draft moves it across.
 */
const BRAND_TAB_ALL = "ALL";
const DRAFT_TAB = "DRAFT";

function brandTabs(quotations) {
  const counts = new Map();
  let drafts = 0;
  for (const chain of quotations) {
    if (chain.isDraft) drafts += 1;
    else counts.set(chain.quotationBrand, (counts.get(chain.quotationBrand) || 0) + 1);
  }
  return [
    { id: BRAND_TAB_ALL, label: "All", count: quotations.length - drafts },
    ...QUOTATION_BRANDS.map((brand) => ({ id: brand.code, label: brand.label, count: counts.get(brand.code) || 0 })),
    { id: DRAFT_TAB, label: "Draft", count: drafts },
  ];
}

/** The chains one tab lists: the drafts under Draft, and only generated quotations everywhere else. */
function chainsForTab(quotations, tab) {
  if (tab === DRAFT_TAB) return quotations.filter((chain) => chain.isDraft);
  return quotations.filter((chain) => !chain.isDraft && (tab === BRAND_TAB_ALL || chain.quotationBrand === tab));
}

/*
 * The Board: a quotation has no status to move through - it is generated or still a draft - so the
 * register stands in the columns its tabs already cut it into: one per brand, then Draft. A card opens
 * the quotation, as a double-click does. Nothing is dropped: a brand is a fact about the quotation,
 * not a state it reaches, and a draft is generated from its own form.
 */
const BOARD_DRAFT = "Draft";
// The board's trend counts a quotation by its Quotation Date, else by when it was created.
const quotedOn = (quotation) => {
  const time = new Date(quotation.quotationDate || quotation.createdAt || "").getTime();
  return Number.isNaN(time) ? null : time;
};
const BOARD_ORDER = [...QUOTATION_BRANDS.map((brand) => brand.label), BOARD_DRAFT];
const boardGroupOf = (chain) => (chain.isDraft ? BOARD_DRAFT : groupValue(chain.brandName));
const BOARD_CARD = {
  title: (chain) => chain.clientName || chain.quotationName || chain.quotationId || "Quotation",
  subtitle: (chain) => [chain.quotationId || chain.quotationNumber || chain.enquiryId, chain.followedBy].filter(Boolean).join(" · "),
  meta: (chain) => [chain.quotationDate ? formatDate(chain.quotationDate) : "", (chain.versionCount || 1) > 1 ? `${chain.versionCount} versions` : ""].filter(Boolean).join(" · "),
};

function emptyMessageFor(tab) {
  if (tab === DRAFT_TAB) return "Quotations saved with Save Draft will appear here until they are generated.";
  return tab === BRAND_TAB_ALL ? "Generated quotations will appear here." : `No ${brandLabel(tab)} quotations yet.`;
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

/** The one version of a quotation that is FINALIZED, newest or not - or null when none is. */
const finalizedVersionOf = (chain) => (isFinalizedQuotation(chain) ? chain : (chain?.versions || []).find(isFinalizedQuotation) || null);

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
  // A duplicate's edits, kept in this tab and put back after a reload (`lib/quotationEditingDraft.mjs`).
  const [restoredDraft, setRestoredDraft] = useState(null);
  const [deletingQuotation, setDeletingQuotation] = useState(null);
  const [shareQuotation, setShareQuotation] = useState(null);
  // The chain the generator is editing, kept beside the version loaded into it: the chain carries
  // the version list the picker offers, the version carries the payload the form is built from.
  const [editingChain, setEditingChain] = useState(null);
  // A quotation started on the CRM's Quotation Calculator, waiting for the generator to open on it.
  const [generatorDraft, setGeneratorDraft] = useState(null);
  const [versionsQuotation, setVersionsQuotation] = useState(null);
  /*
   * The version a Duplicate opened the generator on, read back in full. Its own state rather than
   * `editingQuotation`, because that one means "raise the next version of this" and a duplicate is a
   * new quotation: saving it creates version 01 of a new number and never writes to the source.
   */
  const [duplicateSource, setDuplicateSource] = useState(null);
  const [renewingId, setRenewingId] = useState("");
  // Finalize or Unfinalize in flight from the generator - "finalize", "unfinalize" or neither.
  const [finalizing, setFinalizing] = useState("");
  // One PDF at a time - the server takes a few seconds to render one, and the guard is set before
  // the first await, so a second press does not start a second render. The id says which version's
  // Download is the busy one; the others are disabled until it is done.
  const { busy: downloadingPdf, run: runDownload } = useSubmitOnce();
  const [downloadingId, setDownloadingId] = useState("");
  // One press is one quotation: the guard is set before the first await, so a double-click is ignored.
  const { busy: savingQuotation, run: runSave } = useSubmitOnce();
  // Which of the generator's two saves is in flight, so the spinner is on the button pressed.
  const [savingKind, setSavingKind] = useState("");
  /*
   * The generator's key, held while a new quotation becomes a draft under it.
   *
   * The panel is keyed on what it was opened on, so picking another version rebuilds it. The first
   * Save Draft turns a new quotation into a draft with an id of its own, and re-keying then would
   * rebuild the form the person is still typing in - so the key it was opened under is kept until
   * the generator closes.
   */
  const [heldGeneratorKey, setHeldGeneratorKey] = useState(null);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  // Save Draft on a booking started here; the drafts are listed and reopened on Bookings & Converted.
  // `bookingDraft` is a draft chosen with "Use draft" when this quotation's enquiry already had one.
  const projectDrafts = useProjectDrafts();
  const [bookingDraft, setBookingDraft] = useState(null);
  const closeBooking = () => { setBookingPrefill(null); setBookingDraft(null); };
  const { density } = useCompactView();
  // Which brand's chains the table shows. Filtered here, over the rows already loaded, so pressing
  // a tab is immediate and the search, the sort, the export and the row actions carry on as they
  // are - the table simply sees fewer rows.
  const [brandTab, setBrandTab] = useState(BRAND_TAB_ALL);
  const visibleQuotations = useMemo(() => chainsForTab(quotations, brandTab), [brandTab, quotations]);
  const tabs = useMemo(() => brandTabs(quotations), [quotations]);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * `rows` is the chains on screen, and a tick is a whole chain: the bulk route deletes every
   * version of it, where the row menu's Delete takes one version and keeps the rest. Earlier
   * versions under an open chevron carry no box (`isChainRow`) - the table only ever sends its
   * top-level rows, so a box there would tick and do nothing.
   */
  const bulk = useTableSelection({
    prefix: "/api/sales/quotations",
    rows: visibleQuotations,
    noun: "quotation",
    canSelectRow: isChainRow,
    deleteMessage: "Every version of each selected quotation is deleted. This cannot be undone. Anything that cannot be deleted is left alone and stays ticked.",
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
      setEditParam(row.id);
      setGeneratorOpen(true);
      return;
    }
    try {
      const response = await getSalesQuotation(row.id);
      setEditingQuotation(decorateQuotation({ ...response.data, versions: row.versions }));
      setEditParam(row.id);
      setGeneratorOpen(true);
    } catch (error) {
      showError(error.message || "Unable to open that version.");
    }
    }, [showError]);

  /*
   * A reload with `?edit=` in the address: the same version back in the generator, with the edits
   * auto-saved in this tab put back over it where there are any. Read in full, as a row expanded out
   * of its chain is. Nothing is saved by reopening.
   */
  const reopenEdit = useCallback(async (versionId) => {
    try {
      const response = await getSalesQuotation(versionId);
      const version = decorateQuotation(response.data);
      const edits = readEditingDraft(editingDraftScope({ editingId: version.id }));
      setEditingChain(version);
      setEditingQuotation(edits ? { ...version, payload: edits } : version);
      setGeneratorOpen(true);
      if (edits) showSuccess(`Your unsaved changes to ${version.quotationId || "this quotation"} were restored. Nothing is saved until you save it.`);
    } catch (error) {
      setEditParam(null);
      showError(error.message || "Unable to reopen that quotation.");
    }
  }, [showError, showSuccess]);

  /*
   * Opens the generator on a copy of a version, as a new quotation.
   *
   * Read back in full rather than taken off the row, because an earlier-version row carries no
   * payload and a register loaded minutes ago is not what should be copied. Also how a reload with
   * `?duplicate=` in the address gets back to the same form.
   */
  const openDuplicate = useCallback(async (sourceId, { restore = false } = {}) => {
    try {
      const response = await getSalesQuotation(sourceId);
      setEditingQuotation(null);
      setEditingChain(null);
      setGeneratorDraft(null);
      setDuplicateSource(response.data);
      // On a reload, the copy as it was being edited, where this tab kept it.
      const edits = restore ? readEditingDraft(editingDraftScope({ duplicateId: response.data.id })) : null;
      setRestoredDraft(edits);
      setDuplicateParam(response.data.id);
      setGeneratorOpen(true);
      if (edits) showSuccess("Your unsaved changes to this copy were restored. Nothing is saved until you save it.");
    } catch (error) {
      setDuplicateParam(null);
      showError(error.message || "Unable to open that quotation to duplicate.");
    }
  }, [showError, showSuccess]);

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

  // One list for the row's ⋮ and the board card's ⋮.
  const quotationActions = useCallback((quotation) => [
    // The only way to reach the record view on a touch screen, where a double-click is the
    // browser's zoom gesture rather than something a row ever receives.
    { label: "View", onSelect: () => setViewingQuotation(quotation) },
    // Editing does not change this quotation, it raises the next version of it.
    // On a draft, Edit carries on with the draft itself rather than raising a version over it.
    ...(canWrite ? [{ label: "Edit", onSelect: () => void openGenerator(quotation) }] : []),
    /*
     * Where a quotation is opened, copied, saved as a PDF and re-enabled - offered on every row
     * except a draft's, however many versions the chain has.
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
    // A draft has no link and no history yet - nothing has been sent - so neither is offered.
    ...(quotation.isDraft ? [] : [{ label: (quotation.versions?.length || 0) > 1 ? "Versions" : "Link", onSelect: () => setVersionsQuotation(quotation) }]),
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
     *
     * And only at the finalized version - whichever version of the quotation that is, newest or
     * not: a project is booked at a finalized quotation and nothing else (the server refuses any
     * other), so a quotation with no finalized version does not offer it.
     */
    ...(canCreateProject && !quotation.isDraft && finalizedVersionOf(quotation) && !bookedFromChain(quotation)
      ? [{ label: "Create Project", onSelect: () => void openBooking(finalizedVersionOf(quotation).id) }]
      : []),
    // Duplicating writes a new quotation, so it is a write and is absent without READ_WRITE
    // rather than present and refused.
    ...(canWrite && !quotation.isDraft ? [{ label: "Duplicate", onSelect: () => void openDuplicate(quotation.id) }] : []),
    // A finalized version is kept as it is, so a quotation holding one is not offered for deleting
    // (the server refuses it too); unfinalizing that version first is what brings Delete back.
    ...(canWrite && !finalizedVersionOf(quotation) ? [{ label: "Delete", tone: "danger", onSelect: () => setDeletingQuotation(quotation) }] : []),
  ], [canCreateProject, canWrite, openBooking, openDuplicate, openGenerator]);

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
     * Editing does not change this quotation, it raises the next version of it; Duplicate opens a
     * copy of it that saves as a new quotation. Both are writes, so both are absent without READ_WRITE rather than
     * present and refused.
     */
    cell: column.id === "actions" ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.quotationId || row.original.quotationNumber || "quotation"}`} items={quotationActions(row.original)} /> : column.id === "finalizedQuotation"
      ? ({ row }) => <FinalizedQuotationCell quotation={row.original} />
      : column.id === "brandName"
        ? ({ row }) => <BrandBadge code={row.original.quotationBrand} />
        : ({ row }) => displayValue(row.original, column),
    exportValue: (quotation) => displayValue(quotation, column),
    // The name is five facts joined by dashes, so it is given room the other columns do not need.
    width: column.id === "actions" ? 56 : column.id === "quotationName" ? 320 : column.id === "brandName" ? 110 : 180,
    minWidth: column.id === "actions" ? 56 : column.id === "quotationName" ? 240 : column.id === "brandName" ? 96 : 160,
  })), [quotationActions]);

  const generatorKey = heldGeneratorKey || editingQuotation?.id || (duplicateSource ? `duplicate-${duplicateSource.id}` : generatorDraft ? "calculator-draft" : "new-quotation");

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
    await runDownload(async () => {
      setDownloadingId(quotation.id);
      try {
        await downloadSalesQuotationPdf(quotation.id, `${quotation.quotationId || "quotation"}.pdf`);
      } catch (error) {
        // A dropped connection throws the browser's own words ("Failed to fetch"), not the server's.
        showError(error instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : error?.message || "Unable to download the quotation PDF.");
      } finally {
        setDownloadingId("");
      }
    });
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
    setHeldGeneratorKey(null);
    setEditingQuotation(null);
    setEditingChain(null);
    setGeneratorDraft(null);
    setDuplicateSource(null);
    setRestoredDraft(null);
    setDuplicateParam(null);
    setEditParam(null);
    // Closed or saved: the edits this tab kept are done with.
    clearEditingDrafts();
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
      // A duplicate open when the page was reloaded opens again, read back from its source.
      const duplicateId = new URLSearchParams(window.location.search).get(DUPLICATE_PARAM);
      if (duplicateId) {
        void openDuplicate(duplicateId, { restore: true });
        return;
      }
      // A version that was being edited reopens the same way, with its kept edits.
      const editId = new URLSearchParams(window.location.search).get(EDIT_PARAM);
      if (editId) {
        void reopenEdit(editId);
        return;
      }
      const draft = takeQuotationGeneratorDraft();
      if (!draft) return;
      setEditingChain(null);
      setEditingQuotation(null);
      setGeneratorDraft(draft);
      setGeneratorOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canWrite, openDuplicate, reopenEdit]);

  /** Loads an earlier version into the generator, so the next version can be raised from it. */
  async function loadVersionIntoGenerator(versionId) {
    if (!versionId || versionId === editingQuotation?.id) return;
    try {
      const response = await getSalesQuotation(versionId);
      setEditingQuotation(decorateQuotation(response.data));
      setEditParam(versionId);
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
    // Which save this is, said once: only an edit raises a version; a duplicate is created exactly
    // as a new quotation is, so it gets a new number and starts at version 01; a draft is generated
    // in place, under the number it already has.
    const mode = isDraftQuotation(editingQuotation) ? "draft" : editingQuotation ? "edit" : duplicateSource ? "duplicate" : "create";
    const source = editingQuotation;
    const duplicatedFrom = duplicateSource;
    setSavingKind("generate");
    await runSave(async () => {
      try {
        const response = mode === "draft"
          ? await generateSalesQuotationDraft(source.id, { ...quotation, draftUpdatedAt: source.updatedAt })
          : mode === "edit"
          ? await createSalesQuotationVersion(source.id, quotation)
          : await createSalesQuotation(quotation);
        const saved = decorateQuotation(response.data);
        await loadQuotations({ notifyOnError: false });
        closeGenerator();
        setShareQuotation(saved);
        showNotice(mode === "draft"
          ? `${saved.quotationId} generated from the draft.`
          : mode === "edit"
          // A save that changed nothing in the document raises no version: the client has that
          // quotation already, and a second identical one would only move its link.
          ? response.unchanged
            ? `Nothing changed in ${saved.quotationId}, so no new version was raised.`
            : `${saved.quotationId} raised as the new version.`
          : mode === "duplicate"
            ? `${saved.quotationId} created as a duplicate of ${duplicatedFrom.quotationId}.`
            : `${saved.quotationId} generated and added to inventory.`);
      } catch (error) {
        // The form stays open with everything typed into it, so the save can simply be pressed again.
        showError(error.message || "Unable to save quotation.");
      }
    });
  }

  /*
   * Save Draft. The first save of a new quotation numbers it and keeps it as a draft; every later
   * one - in this sitting or after reopening it from the Draft tab - rewrites that same draft, never
   * a second one. The generator stays open on it, so the person can carry on and save again, and
   * the register is re-read behind it so the Draft tab's count is the database's.
   *
   * The draft's `updatedAt` goes back with each save: a draft changed in another tab since this one
   * opened it is refused (409) rather than overwritten, and the message says to reopen it.
   */
  async function saveQuotationDraft(quotation) {
    const draft = isDraftQuotation(editingQuotation) ? editingQuotation : null;
    const keyBeforeSave = generatorKey;
    setSavingKind("draft");
    await runSave(async () => {
      try {
        const response = draft
          ? await updateSalesQuotationDraft(draft.id, { ...quotation, draftUpdatedAt: draft.updatedAt })
          : await createSalesQuotationDraft(quotation);
        const saved = decorateQuotation({ ...response.data, versions: [] });
        if (!draft) setHeldGeneratorKey(keyBeforeSave);
        setEditingQuotation(saved);
        setEditingChain(saved);
        // From here it is this draft being edited, not a calculator handoff or a duplicate: a
        // reload must not reopen a second copy of the source.
        setGeneratorDraft(null);
        setDuplicateSource(null);
        setRestoredDraft(null);
        setDuplicateParam(null);
        setEditParam(saved.id);
        // Saved to the server now, so nothing is left to keep in this tab.
        clearEditingDrafts();
        showSuccess(`${saved.quotationId} saved as a draft. Carry on here, or reopen it later from the Draft tab.`);
        await loadQuotations({ notifyOnError: false });
      } catch (error) {
        // The form stays open with everything typed into it, so the save can simply be pressed again.
        showError(error.message || "Unable to save the draft.");
      }
    });
  }

  /*
   * A renewed link changes one version, which may be the row in the register, a row in the version
   * history, or both at once. Patched in place rather than re-read: the list is unchanged apart
   * from this one clock, and reloading it would close the dialog the button was pressed in.
   *
   * A finalize or an unfinalize changes the same things - the clock, and the version's finalize
   * state with it - and is patched the same way, the generator open on it included.
   */
  function applyRenewedVersion(saved) {
    const patchChain = (chain) => {
      if (chain.quotationNumber !== saved.quotationNumber) return chain;
      const versions = (chain.versions || []).map((version) => version.id === saved.id
        ? { ...version, linkExpiresAt: saved.linkExpiresAt, linkActive: saved.linkActive, linkNeverExpires: saved.linkNeverExpires, finalization: saved.finalization }
        : version);
      return decorateQuotation({ ...chain, ...(chain.id === saved.id ? saved : {}), versions });
    };
    setQuotations((current) => current.map(patchChain));
    setShareQuotation((current) => current?.id === saved.id ? saved : current);
    setVersionsQuotation((current) => current ? patchChain(current) : current);
    setEditingQuotation((current) => current ? patchChain(current) : current);
    setEditingChain((current) => current ? patchChain(current) : current);
  }

  /*
   * Finalize Quotation and Unfinalize, from the generator. Neither raises a version: the generator
   * stays open on the same one, which then reads only (finalized) or edits again (unfinalized).
   * Finalize sends what is on screen, and the server refuses it when that is not what is saved.
   */
  async function changeFinalization(kind, payload) {
    const source = editingQuotation;
    if (!source?.id || finalizing) return;
    setFinalizing(kind);
    try {
      const response = kind === "finalize"
        ? await finalizeSalesQuotation(source.id, payload)
        : await unfinalizeSalesQuotation(source.id);
      applyRenewedVersion(decorateQuotation(response.data));
      const name = response.data?.quotationId || source.quotationId || "Quotation";
      if (kind === "finalize") {
        // What is on screen is what was saved, so nothing is left for this tab to keep.
        clearEditingDrafts();
        showNotice(response.unchanged ? `${name} was already finalized.` : `${name} finalized. Its link no longer expires.`);
      } else {
        showNotice(response.unchanged ? `${name} was not finalized.` : `${name} unfinalized. Its link is open for 5 days - edit it and Save as new version to change it.`);
      }
    } catch (error) {
      showError(error.message || (kind === "finalize" ? "Unable to finalize the quotation." : "Unable to unfinalize the quotation."));
    } finally {
      setFinalizing("");
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
      const deleted = deletingQuotation;
      await deleteSalesQuotation(deleted.id);
      // Re-read rather than drop the row: deleting the current version leaves the chain standing on
      // the version below it, and filtering the row out would hide a quotation that still exists.
      setDeletingQuotation(null);
      await loadQuotations({ notifyOnError: false });
      showNotice(deleted.isDraft ? `Draft ${deleted.quotationId} deleted.` : "Quotation version deleted.");
    } catch (error) {
      showError(error.message || "Unable to delete quotation.");
    }
  }

  const [layout, setLayout] = useTableBoardLayout("sales-quotations");
  const onBoard = layout === "board";
  const boardColumns = useMemo(() => columnsFromRows(quotations, boardGroupOf, { order: BOARD_ORDER }), [quotations]);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    {/* The generator writes - it creates a quotation - so it is gated on this screen's own
        SALES / Quotation Management. The pricing catalogue it prices with is no longer edited from
        here; `/api/sales/quotation-settings` and its dialog are untouched and have no way in. */}
    <ModulePageHeader
      title="Quotations"
      // The Board's columns are the tabs' own brands and Draft, so the tabs step aside while it shows.
      tabs={onBoard ? undefined : tabs}
      tabValue={brandTab}
      onTabChange={setBrandTab}
      tabsAriaLabel="Quotation brand"
      actions={<>
        <TableBoardSwitch value={layout} onChange={setLayout} />
        {canWrite && <Button type="button" variant="primary" onClick={() => void openGenerator(null)}>Quotation generator</Button>}
      </>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* Booking a project from a quotation, on the register rather than on another screen. The
        panel and its save are Bookings & Converted's own, shared rather than repeated. */}
    {(bookingPrefill || bookingDraft) && <ProjectBookingPanel
      key={bookingDraft?.id || "new"}
      prefill={bookingDraft ? null : bookingPrefill}
      draft={bookingDraft?.snapshot || null}
      draftId={bookingDraft?.id || ""}
      findDraft={projectDrafts.forEnquiry}
      onUseDraft={setBookingDraft}
      onSaveDraft={(snapshot, { droppedFiles = false } = {}) => {
        const saved = projectDrafts.save({ id: bookingDraft?.id, enquiryId: snapshot.form?.enquiryId, title: projectDraftTitle(snapshot.form), snapshot });
        closeBooking();
        showSuccess(`Draft saved on this computer until ${draftKeptUntil(saved)} - open it from Bookings & Converted → Drafts.${droppedFiles ? " The payment proof is not kept; choose it again when you reopen." : ""}`);
      }}
      onClose={closeBooking}
      /* The register is re-read so the quotation that has now been booked stops offering to book
         again - `finalized` is what the entry reads, and it only changes on the server. A draft of
         this booking is done with too. */
      onSaved={(created, sent) => {
        if (bookingDraft) projectDrafts.remove(bookingDraft.id);
        projectDrafts.removeForEnquiry(sent?.enquiryId || created?.enquiryId);
        return loadQuotations({ notifyOnError: false });
      }}
      onNotice={showNotice}
      onError={showError}
    />}
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {onBoard ? quotations.length : tableStats.total}</span></TableFooter>}>
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {onBoard ? <KanbanBoard
          rows={quotations}
          columns={boardColumns}
          statusOf={boardGroupOf}
          // What the quotations in each column are worth.
          columnAmount={(rows) => columnTotal(rows, (chain) => chain.amount, "Quoted")}
          dateOf={quotedOn}
          card={BOARD_CARD}
          onOpen={setViewingQuotation}
          // The card's ⋮ is the row's ⋮.
          cardActions={quotationActions}
          viewOnly="A quotation's brand is fixed when it is made. Duplicate it to quote under another brand."
          loading={isLoading}
          noun="quotations"
          ariaLabel="Quotations board"
        /> : <div className="flex min-h-0 min-w-0 flex-1">
        <DataTable
          columns={columns}
          data={visibleQuotations}
          density={density}
          loading={isLoading}
          loadingMessage="Loading quotations..."
          emptyMessage={emptyMessageFor(brandTab)}
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
        </div>}
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
      key={generatorKey}
      editingDraftScope={editingDraftScope({ editingId: editingQuotation?.id, duplicateId: duplicateSource?.id })}
      initialQuotation={editingQuotation}
      initialDraft={editingQuotation ? null : restoredDraft || (duplicateSource ? duplicateDraft(duplicateSource) : generatorDraft)}
      duplicateOf={editingQuotation ? null : duplicateSource}
      saving={savingQuotation}
      savingDraft={savingQuotation && savingKind === "draft"}
      // A draft has one version and nothing to pick between, so it is offered no version picker.
      versions={editingQuotation?.isDraft ? [] : editingChain?.versions || []}
      selectedVersionId={editingQuotation?.id || ""}
      onSelectVersion={loadVersionIntoGenerator}
      // Not while a save is in flight: the save closes the form itself and opens the share dialog.
      onClose={() => { if (!savingQuotation) closeGenerator(); }}
      onGenerate={addGeneratedQuotation}
      onSaveDraft={saveQuotationDraft}
      // Writes, so a writer's only - the generator opens only for one, and says so again here.
      finalizing={finalizing}
      onFinalize={canWrite ? (payload) => changeFinalization("finalize", payload) : undefined}
      onUnfinalize={canWrite ? () => changeFinalization("unfinalize") : undefined}
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
          <Button type="button" busy={downloadingId === shareQuotation.id} busyLabel="Preparing PDF..." disabled={downloadingPdf} onClick={() => downloadPdf(shareQuotation)}>Download PDF</Button>
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
      // A new tab on the page the client is sent, so this list is still here when they come back.
      onOpenLink={(version) => window.open(publicUrl(version), "_blank", "noopener,noreferrer")}
      onCopyLink={(version) => void copyPublicLink(version)}
      downloadingId={downloadingId}
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
    <ConfirmDialog
      open={Boolean(deletingQuotation)}
      title={deletingQuotation?.isDraft ? "Delete draft?" : "Delete quotation?"}
      message={deletingQuotation?.isDraft
        ? `This deletes the draft ${deletingQuotation.quotationId || ""}. Nothing was sent from it, and it cannot be undone.`
        : `This removes ${deletingQuotation?.quotationId || "this quotation"} from the quotation inventory. Earlier versions of ${deletingQuotation?.quotationNumber || "this chain"} are kept.`}
      confirmLabel={deletingQuotation?.isDraft ? "Delete draft" : "Delete"}
      onCancel={() => setDeletingQuotation(null)}
      onConfirm={confirmDeleteQuotation}
    />
  </section>;
}
