"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import ImportDialog from "@/components/data-table/ImportDialog";
import TableFooter from "@/components/data-table/TableFooter";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import useStickyTab from "@/components/shared/useStickyTab";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import InterviewAddApplicationDialog from "@/components/hrm/InterviewAddApplicationDialog";
import InterviewCandidateFormPanel from "@/components/hrm/InterviewCandidateFormPanel";
import ResendApplicationFormDialog from "@/components/hrm/ResendApplicationFormDialog";
import InterviewBulkEntryDialog from "@/components/hrm/InterviewBulkEntryDialog";
import InterviewBulkStageDialog from "@/components/hrm/InterviewBulkStageDialog";
import InterviewApplicationInviteDialog from "@/components/hrm/InterviewApplicationInviteDialog";
import interviewInfoFormatters from "@/components/hrm/interviewInfoFormatters";
import InterviewScheduleDialog, { SCHEDULE_MODES } from "@/components/hrm/InterviewScheduleDialog";
import InterviewDecisionDialog from "@/components/hrm/InterviewDecisionDialog";
import OnboardingInviteDialog from "@/components/employees/OnboardingInviteDialog";
import { cancelOnboardingInvite, getOnboardingInvites } from "@/services/hrm/onboarding-invites.service";
import { INTERVIEW_IMPORT_COLUMNS } from "@/constants/importColumns";
import { importTableRows } from "@/services/api/tableImport.service";
import { copyToClipboard } from "@/lib/clipboard";
/*
 * The register is read a page at a time, so its selection cannot be a set of the ids on screen -
 * that is what made "select all" mean "the first hundred". `leadSelection` is the model the CRM
 * board already uses for exactly this shape: `allMatching` plus the exceptions somebody un-ticked,
 * which is one boolean for a stage of five thousand rather than five thousand strings, and lets a
 * row fetched later arrive already ticked.
 */
import { countSelected, emptySelection, headerState, isSelected, toggleAll, toggleOne } from "@/lib/leadSelection";
import {
  cancelApplicationInvite,
  createCandidatesBulk,
  deleteCandidate,
  deleteCandidatesBulk,
  getApplicationInvites,
  getCandidates,
  CANDIDATE_PAGE_SIZE,
  setCandidateStatus,
  getCandidateColumnValues,
  getCandidateIds,
  getInterviewOptions,
  resendApplicationForm,
} from "@/services/hrm/interview.service";
import {
  ALL_CANDIDATE_STATUSES,
  CANDIDATE_STATUS_FILTERS,
  FILTERABLE_CANDIDATE_COLUMNS,
  DEFAULT_CANDIDATE_STATUS,
  FOLLOW_UP_STATUS,
  FORM_PENDING_STATUS,
  FORM_SUBMITTED_STATUS,
  ON_HOLD_STATUS,
  ONBOARDED_STATUS,
  REJECTED_STATUS,
  SELECTED_STATUS,
  candidateDefaultHiddenColumns,
  candidateInfoSections,
  candidateStatusCounts,
  candidateModeStyles,
  candidateStatusStyles,
  candidateTableFields,
  candidatesForStatus,
  statusQueryFor,
} from "@/constants/interviewConfig";

/**
 * Interview: the people applying to the studio, and where each of them has got to.
 *
 * HRM's counterpart of Leads & Followups, laid out the way the Employee Repository beside it is,
 * because it is the same kind of screen - a register of people, read by stage: the stages are the
 * header's tab row with a count on each, the register is the shared table with the info panel
 * beside it, and the action bar is a primary button with a ⋮ after it.
 *
 * ── The action bar ──
 *
 * **Add Application** is the primary button, and it opens Add Lead's own dialog asked of a
 * candidate: a compact card over the dimmed page asking the six things an arriving application
 * carries, and nothing else. Everything the register can hold is on the full record, which a row
 * opens - the same split the CRM has between Add Lead and the lead popup.
 *
 * The ⋮ after it carries the three ways in that are not one application typed by hand, the same
 * arrangement the CRM's ⋮ and the repository's have:
 *
 *   * **Bulk Entry** - several candidates typed in one sitting, the CRM's own Bulk Entry dialog.
 *   * **Import** - a CSV, through the shared import dialog every module's table uses.
 *   * **View All Invites** - every screening form sent, with what became of each.
 *
 * The register is fetched whole and filtered here, so every tab carries its count and switching
 * touches nothing. Rows arrive four ways: typed in, typed in a batch, imported from a file, or
 * imported from the Google Sheets linked under Settings → Integrations → Interview - and a
 * candidate can be sent the screening form to fill in themselves, which is the fifth.
 */

/** What the sheet integration dispatches after a link, a sync or a delete; the page re-reads on it. */
const REFRESH_EVENT = "dbs:interview-candidates-refresh";

const emptyOptions = { interviewers: [], departments: [], positions: [], branches: [], genders: [], statuses: [], sources: [], modes: [], employmentTypes: [] };

/*
 * Two filter sets that mean the same thing.
 *
 * Compared by value rather than by identity because the table reports its filters as a fresh object
 * on every change - including the empty one it reports when the row is first drawn - and the read
 * of the register depends on the set it is given. Held by identity, an unchanged report would
 * re-read the whole stage, and that read would report again.
 */
function sameFilters(left, right) {
  const keys = Object.keys(left || {});
  if (keys.length !== Object.keys(right || {}).length) return false;
  return keys.every((key) => {
    const a = left[key];
    const b = right[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    }
    return a === b;
  });
}

function errorMessage(error, fallback) {
  if (error?.status === 401) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

export default function InterviewPage() {
  // HRM / Interview. READ reads the register; READ_WRITE is what adding, editing, importing,
  // deleting and sending a screening form all need.
  const { canWrite } = useRouteAccess();
  /*
   * **An onboarding invite is not this screen's to grant.**
   *
   * Every one of its endpoints answers to `HRM / Employee Management` - it is the Employee
   * Repository's record, raised from here - so gating those entries on this page's own
   * `HRM / Interview` write was the frontend promising something the server refuses: a recruiter
   * holding Interview and not Employee Management was shown **Send Onboarding Invite**, got a 403
   * on create, and the candidate never moved to Onboarded. `READ` as well as write, because the
   * row's Copy Link and Edit Invite read the invite list before they can offer anything.
   */
  const onboardingAccess = useModuleAccess("HRM", "Employee Management");
  /*
   * **The tick boxes are their own permission**, the way the CRM board's are.
   *
   * `HRM / Interview Select All` Read / Write. The boxes change nothing by themselves; what they
   * lead to is a write over a set the reader never has to look at - a stage moved across every
   * candidate ticked, or a delete that takes them all - which is a different job from working the
   * register a candidate at a time. A role without it gets no column of boxes at all, so there is no
   * selection to offer either button over, and the two bulk routes refuse it besides.
   */
  const { canWrite: canSelectCandidates } = useModuleAccess("HRM", "Interview Select All");
  /*
   * The stage is remembered across a reload, under this screen's own key: somebody working through
   * the interviews scheduled this week reloads to see what has moved, and coming back to the whole
   * register is exactly the wrong answer - the case `useStickyTab` was written for.
   */
  const [statusFilter, setStatusFilter] = useStickyTab("hrm-interview-status", ALL_CANDIDATE_STATUSES, CANDIDATE_STATUS_FILTERS.map((filter) => filter.id));
  const [candidates, setCandidates] = useState([]);
  /** How many the register holds at this stage, and every stage's own count - both the server's. */
  const [totalRows, setTotalRows] = useState(0);
  const [serverCounts, setServerCounts] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /*
   * One read at a time, and how many rows are held - both read by the scroll handler.
   *
   * Refs rather than state because a scroll fires many times a frame and state lags by one: the
   * board would start a request per event, each asking for the same offset. The CRM lead board
   * guards itself the same way, for the same reason.
   */
  const loadingRef = useRef(false);
  const heldRef = useRef(0);
  const [options, setOptions] = useState(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [infoCandidate, setInfoCandidate] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  /*
   * Adding and editing are two different screens, so they are two pieces of state: `addOpen` is the
   * compact Add Application dialog, and `editCandidate` is the full record a row opens. They were
   * one, which meant the dialog and the panel had to be told apart by whether the record had an id.
   */
  const [addOpen, setAddOpen] = useState(false);
  const [editCandidate, setEditCandidate] = useState(null);
  /*
   * The studio's own decision about a candidate, opened apart from their record: the stage, the
   * interview, the follow-ups and HR's note. Its own piece of state for the reason `editCandidate`
   * is - they are two screens, and a candidate can be read without anything being decided.
   */
  const [scheduleCandidate, setScheduleCandidate] = useState(null);
  /*
   * The decision being taken about a candidate, and which one: Selected, On Hold or Rejected, each
   * asked with its reason. `{ candidate, status }` rather than two pieces of state, so the dialog
   * cannot be open about one candidate while holding another's stage.
   */
  const [decision, setDecision] = useState(null);
  /*
   * The candidate being taken on: the Employee Repository's own onboarding invite, opened from here
   * with their answers already in it. Held as the candidate rather than a flag, because closing the
   * dialog has to know whose stage to move.
   */
  const [onboarding, setOnboarding] = useState(null);
  /*
   * What each column filter offers, asked of the server when its menu opens.
   *
   * The register is read a page at a time, so a menu built from the rows in the browser offered the
   * values of the hundred scrolled into view - which is a filter that grows as you scroll and hides
   * the very rows it was opened to find. This asks the column instead.
   *
   * Held against the **stage**, because that is what the answer describes: switching tab asks
   * again, and an answer that arrives after the reader has moved on belongs to the tab they left.
   * A column already answered is not asked twice, including one that answered with nothing.
   */
  /*
   * The column filters, and the copy the reads actually use.
   *
   * Filtering happens on the server, because the register arrives a page at a time - filtering the
   * rows in hand filtered the hundred scrolled into view, and picking a value the column held but
   * that page did not answered "no records found" over a register that had plenty.
   *
   * `appliedFilters` lags `columnFilters` by a moment so that typing into a text filter is one read
   * rather than one per keystroke. A menu tick is the same path; the debounce costs it nothing
   * anybody can see.
   */
  const [columnFilters, setColumnFilters] = useState({});
  const [appliedFilters, setAppliedFilters] = useState({});
  const [columnValues, setColumnValues] = useState({ key: "", byColumn: {} });
  const [loadingColumnValues, setLoadingColumnValues] = useState("");

  /** Every onboarding invite the studio holds, so an Onboarded row knows which one is its own. */
  const [onboardingInvites, setOnboardingInvites] = useState([]);
  /** The onboarding invite being called off, held until the question about it is answered. */
  const [pendingCancelOnboarding, setPendingCancelOnboarding] = useState(null);
  /*
   * The candidate being **read** in full, which is a different thing from the one being edited.
   *
   * Every table in the OS answers a double-click by showing the record and never by opening it for
   * editing: a double-click is too easy to trigger by accident - a slow second click on a row
   * somebody meant to select - for it to be the gesture that puts a live form on screen. This
   * screen was the one that did, and it is also what the ⋮'s View opens, exactly as the Employee
   * Repository's does.
   */
  const [viewCandidate, setViewCandidate] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /*
   * The screening-form dialog, and which screen it opens on: `{ mode: "list" }` from the ⋮, and
   * `{ mode: "create", candidate }` from the row menu or the record's own Send Screening Form.
   */
  const [inviteDialog, setInviteDialog] = useState(null);
  /*
   * Reopening the application a candidate has already sent, asked from their record.
   *
   * `{ candidate, invite }` while the confirmation is up, null while it is not. The invite travels
   * with it because the dialog shows the message HR is about to send - their own link and its new
   * deadline - and a dialog that fetched that on open would draw it a moment after everything else.
   */
  const [resendTarget, setResendTarget] = useState(null);
  const [resending, setResending] = useState(false);
  /*
   * The screening forms already raised, so a **row** can act on the one belonging to its candidate
   * rather than sending a second. Without this the row menu could only ever offer "Send" - and a
   * candidate sitting at Form Submission Pending is precisely the row somebody wants to copy the
   * link off, correct, chase or call off, which is the Employee Repository's own onboarding-pending
   * arrangement. Read once beside the register and re-read whenever a form changes.
   */
  const [pendingCancelInvite, setPendingCancelInvite] = useState(null);
  const [cancellingInvite, setCancellingInvite] = useState(false);
  const [invites, setInvites] = useState([]);
  /*
   * When that read happened, stamped by the reader rather than taken during render.
   *
   * Whether a form is still live is a question about the clock, and reading the clock while
   * rendering is impure - React may render again at any moment and get a different answer, which is
   * what `react-hooks/purity` refuses. So liveness is judged as of the moment the forms were
   * fetched, which is also the honest reading: the statuses in hand are that moment's. Every path
   * that changes a form re-reads, so the stamp moves with them.
   */
  const [invitesReadAt, setInvitesReadAt] = useState(0);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  /*
   * The candidates ticked, held here rather than inside the table: the action bar counts them, the
   * two things a selection does run against them, and both clear them afterwards - so a second copy
   * in the table would be two answers to the same question. Ids rather than rows, because the
   * register is re-read after every write and the rows that come back are new objects.
   */
  const [selection, setSelection] = useState(emptySelection);
  /** The selection being deleted together, while the question about it is up. */
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  /** Whether the stage dialog is open over the selection. */
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  /*
   * The forms, for the candidates named - or for the whole register when nothing is named.
   *
   * The register asks by name. It holds a page of a hundred candidates and uses the forms only to
   * decide what each row's menu offers, so reading every form the studio has ever raised was a
   * second pass over the whole register, paid on opening the screen and again after every write.
   * A page therefore asks for its own hundred and merges the answer over what it already has.
   *
   * The unnamed read is kept for the handful of actions that change one form and want the list put
   * straight afterwards; it is capped at the server.
   */
  const loadInvites = useCallback(async (ids = null) => {
    if (!canWrite) return;
    const asked = Array.isArray(ids) ? ids.filter(Boolean) : null;
    try {
      const result = await getApplicationInvites(asked);
      const page = Array.isArray(result?.data) ? result.data : [];
      setInvites((current) => {
        if (!asked?.length) return page;
        // Only the candidates asked about are replaced; everything already read stays, so scrolling
        // never drops the menus of the rows above.
        const touched = new Set(asked);
        return [...current.filter((invite) => !touched.has(invite?.candidateId)), ...page];
      });
      setInvitesReadAt(Date.now());
    } catch {
      if (!asked?.length) setInvites([]);
      setInvitesReadAt(Date.now());
    }
  }, [canWrite]);

  /*
   * A page of the register, or the next one.
   *
   * The screen used to ask for the whole table and filter it here, which is why it sat on "Loading
   * candidates..." - several thousand rows had to arrive before one could be drawn. It now reads a
   * hundred at a time, the CRM lead board's own size, and the stage is applied by the server so a
   * tab is a query rather than a filter over everything.
   *
   * `append` is the scroll asking for more and leaves the first page alone; a plain call re-reads
   * the first page, which is what every write on this screen does afterwards. A refresh deliberately
   * reads one page rather than everything scrolled in so far: re-reading fifty pages to show the
   * same rows is the fault this change exists to remove, and scrolling brings them back.
   */
  const load = useCallback(async ({ quiet = false, append = false, offset = 0 } = {}) => {
    if (append) setLoadingMore(true);
    else if (!quiet) setLoading(true);
    try {
      const result = await getCandidates(statusQueryFor(statusFilter), { offset: append ? offset : 0, appending: append, filters: appliedFilters });
      const page = Array.isArray(result?.data) ? result.data : [];
      /*
       * Appended through the updater rather than over a copy held here, and by id.
       *
       * Two reasons, and the second is the important one: the page is concatenated onto whatever
       * the screen holds at that moment, which stays right if a write refreshed the first page
       * while this request was in flight - and a row already on screen is never added twice, so a
       * scroll that manages to ask for the same offset twice costs a wasted request rather than a
       * duplicated candidate. That is what lets the guard below be state rather than a ref.
       */
      setCandidates((current) => {
        if (!append) return page;
        // By id, so a scroll that manages to ask for one offset twice costs a wasted request
        // rather than a duplicated candidate.
        const held = new Set(current.map((candidate) => candidate?.id));
        return [...current, ...page.filter((candidate) => !held.has(candidate?.id))];
      });
      // Left off an append, so the tabs and the footer keep the numbers they have rather than
      // blanking every time a page scrolls in.
      if (result?.total !== undefined) setTotalRows(Number(result.total) || 0);
      if (result?.counts) setServerCounts(result.counts);
      // The forms for the rows just read, and only those: what a row's menu offers is decided per
      // candidate, so a page needs its own hundred and nothing else.
      if (page.length) void loadInvites(page.map((candidate) => candidate?.id));
      setLastUpdated(new Date());
    } catch (loadError) {
      if (append) showError(errorMessage(loadError, "Unable to load more candidates."));
      else if (!quiet) {
        setCandidates([]);
        setTotalRows(0);
        showError(errorMessage(loadError, "Unable to load candidates."));
      }
    } finally {
      if (append) setLoadingMore(false);
      else if (!quiet) setLoading(false);
    }
  }, [showError, statusFilter, loadInvites, appliedFilters]);

  /*
   * The table has shown everything it holds; fetch the next page unless the set is exhausted.
   *
   * Rebuilt whenever the row count changes and handed to the table on every render, so the offset
   * it asks for is always the current one - which is why no ref is needed to carry it.
   */
  /*
   * How many rows are held, kept in a ref for the scroll handler to read.
   *
   * Written from an effect rather than during the fetch, so nothing on the render path touches a
   * ref - the import config carries `load` into JSX, and `react-hooks/refs` refuses a ref read
   * reachable from there.
   */
  useEffect(() => { heldRef.current = candidates.length; }, [candidates.length]);

  /*
   * The table is within 400px of the bottom; fetch the next page unless the set is exhausted or a
   * read is already running.
   *
   * The guard is a ref because a scroll fires many times a frame and state lags by one - without it
   * the screen starts a request per scroll event, each asking for the same offset. The CRM lead
   * board guards itself exactly this way.
   */
  const loadMore = useCallback(() => {
    if (loadingRef.current || heldRef.current >= totalRows) return;
    loadingRef.current = true;
    void load({ quiet: true, append: true, offset: heldRef.current })
      .finally(() => { loadingRef.current = false; });
  }, [load, totalRows]);

  /*
   * The forms raised, read quietly and never reported as a failure.
   *
   * The register is the screen; the forms only decide which entries a row's ⋮ offers. So a refused
   * or slow read leaves the menu offering **Send Screening Form**, which is the honest answer when
   * nothing is known about an existing form, rather than an error over a table that is working.
   */

  /*
   * The onboarding invites, read for the same reason the screening forms are: they decide what an
   * **Onboarded** row's ⋮ offers - where the link is, whether it can still be corrected or called
   * off. Quietly, and never reported as a failure: the register is the screen, and a refused read
   * leaves a menu with fewer entries rather than an error over a table that is working.
   */
  const loadOnboardingInvites = useCallback(async () => {
    // The list itself needs `HRM / Employee Management` READ; asking without it would report the
    // server's own refusal as an error on a screen that is working exactly as granted.
    if (!onboardingAccess.canRead) return;
    try {
      const result = await getOnboardingInvites();
      setOnboardingInvites(Array.isArray(result?.invites) ? result.invites : (Array.isArray(result?.data) ? result.data : []));
    } catch {
      setOnboardingInvites([]);
    }
  }, [onboardingAccess.canRead]);

  // Deferred a tick so the first render is not the one that flips the table into loading.
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const timer = window.setTimeout(() => void loadOnboardingInvites(), 0); return () => window.clearTimeout(timer); }, [loadOnboardingInvites]);

  // A linked sheet has just written rows: re-read quietly, without blanking the table.
  useEffect(() => {
    // `load` reads the first page and fetches that page's forms with it, so the forms need no
    // separate read here - and a second one would be the whole list again.
    const refresh = () => { void load({ quiet: true }); };
    window.addEventListener(REFRESH_EVENT, refresh);
    return () => window.removeEventListener(REFRESH_EVENT, refresh);
  }, [load, loadInvites]);

  /*
   * The pickers the forms draw from, fetched only for somebody who may open one. A read-only
   * viewer never opens the form, and firing the call anyway would report its own refusal as an
   * error on a screen that is working exactly as granted.
   */
  useEffect(() => {
    if (!canWrite) return undefined;
    const timer = window.setTimeout(() => {
      void getInterviewOptions()
        .then((result) => setOptions({ ...emptyOptions, ...(result?.data || {}) }))
        .catch(() => setOptions(emptyOptions));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canWrite]);

  const visibleCandidates = useMemo(() => candidatesForStatus(candidates, statusFilter), [candidates, statusFilter]);
  const statusCounts = useMemo(() => candidateStatusCounts(candidates, serverCounts), [candidates, serverCounts]);

  /*
   * The ticked candidates that are still on the register, which is what an action actually runs
   * against. A selection survives a re-read - the rows come back carrying the same ids - but not a
   * candidate deleted in the meantime, and handing those to a bulk route would count refusals nobody
   * caused. Read against the visible rows rather than the whole register so the count in the action
   * bar is the selection the reader can see.
   */
  /*
   * How many are selected, counted against what the **stage** holds rather than what is loaded.
   *
   * `totalRows` is the server's count for the tab, so ticking the header box over a hundred drawn
   * rows reads "5,769 selected" and means it - where before it read a hundred and meant a hundred.
   */
  const selectedCount = countSelected(selection, totalRows);
  const clearSelection = useCallback(() => setSelection(emptySelection()), []);

  /*
   * What the table draws, and what ticking does. Handed over as a model rather than a set, because
   * with `allMatching` the set holds the **exceptions** and only this page knows that.
   */
  const selectionModel = useMemo(() => ({
    isSelected: (id) => isSelected(selection, id),
    headerState: () => headerState(selection, totalRows),
    toggleAll: () => setSelection((current) => toggleAll(current, totalRows)),
    toggleRow: (id) => setSelection((current) => toggleOne(current, id)),
    // What the bar says, and it is not the number of rows drawn: with "all matching" the selection
    // covers pages nobody has scrolled to, so the stage's own total is the honest count.
    count: () => countSelected(selection, totalRows),
    clear: () => setSelection(emptySelection()),
  }), [selection, totalRows]);

  /*
   * The concrete ids a bulk action runs against.
   *
   * With `allMatching` the browser has seen only the pages it scrolled, so the full list is asked
   * of the server and the reader's own exceptions are taken out of it - the same thing the CRM
   * board does, and the only honest way to act on a selection nobody has drawn.
   */
  const resolveSelectedIds = useCallback(async () => {
    if (!selection.allMatching) return Array.from(selection.ids);
    const response = await getCandidateIds(statusFilter === ALL_CANDIDATE_STATUSES ? "" : statusFilter, appliedFilters);
    const all = Array.isArray(response?.data) ? response.data : [];
    if (response?.truncated) {
      throw Object.assign(new Error(`This stage holds more than ${Number(response.max || 0).toLocaleString()} candidates, which is more than one action may take at once. Narrow it with a tab or a filter first.`), { handled: true });
    }
    return all.filter((id) => !selection.ids.has(id));
  }, [selection, statusFilter, appliedFilters]);

  /*
   * Changing tab clears the selection.
   *
   * A tab is a different set of candidates, and ticks carried across it would be a selection acting
   * on rows nobody can see - which is the one thing a bulk delete must never be. Done where the tab
   * is actually changed rather than in an effect watching it: an effect would clear on the first
   * render too, and React refuses a setState in an effect body besides
   * (`react-hooks/set-state-in-effect`). A remembered tab restored on mount needs no clearing,
   * because nothing is ticked yet.
   */
  /*
   * A tab change drops the column filters with the selection.
   *
   * A stage is its own list of values - the position ticked on Rejected may hold nothing at all on
   * Selected - so a filter carried across a tab is an empty table over a stage that has rows, and
   * a filter the reader cannot see any reason for.
   */
  const changeTab = useCallback((next) => {
    clearSelection();
    setColumnFilters({});
    setAppliedFilters({});
    setStatusFilter(next);
  }, [clearSelection, setStatusFilter]);

  /*
   * Where each candidate stands with their screening form, which is what their ⋮ offers.
   *
   * Three answers, and each has one thing worth doing:
   *
   *   * **A form is out** - raised or opened, and not past its expiry. The question this row gets
   *     asked is where the link is, so: **Copy Link**.
   *   * **They have sent it back** - the form is Submitted. Nothing is waiting on the candidate,
   *     and what the row holds now is their own answers, so the entry is **Edit**, which the menu
   *     already carries. Sending is deliberately *not* offered: asking again somebody who has
   *     answered is the one thing nobody wants, and it was what this row offered before.
   *   * **Nothing is out** - never asked, or the last form lapsed or was called off. So: **Send
   *     Screening Form**.
   *
   * Correcting a form, emailing it again and cancelling one all live in **View All Invites**, which
   * lists every form with those three beside it. They are things somebody does while reading the
   * forms, not while reading the register.
   *
   * The latest form per candidate decides, because somebody asked twice is answered by their most
   * recent one. `now` is the moment the forms were read rather than a render's clock: reading the
   * clock during render is impure, which the React Compiler refuses, and the statuses in hand are
   * that read's anyway.
   */
  const candidateFormState = useMemo(() => {
    const latest = new Map();
    for (const invite of invites) {
      if (!invite?.candidateId) continue;
      const held = latest.get(invite.candidateId);
      if (!held || new Date(invite.createdAt) > new Date(held.createdAt)) latest.set(invite.candidateId, invite);
    }
    const state = new Map();
    for (const [candidateId, invite] of latest) {
      const live = (invite.status === "Created" || invite.status === "Verified")
        && (!invite.expiresAt || new Date(invite.expiresAt).getTime() > invitesReadAt);
      state.set(candidateId, { invite, live, submitted: invite.status === "Submitted" });
    }
    return state;
  }, [invites, invitesReadAt]);

  /**
   * Which onboarding invite belongs to which candidate.
   *
   * Matched on **email first, then phone**, because that is the pair the invite carries and the
   * register holds: the two records have no id between them - an onboarding invite is the Employee
   * Repository's, raised from here but never owned by here - so the match is on what a person is
   * identified by rather than on a key neither side stores.
   *
   * Newest wins where somebody has been invited twice, which is the same rule the screening forms
   * follow: somebody asked twice is answered by their most recent one.
   */
  const candidateOnboardingInvites = useMemo(() => {
    const byEmail = new Map();
    const byPhone = new Map();
    const digits = (value) => String(value || "").replace(/\D/g, "").slice(-10);
    const newer = (a, b) => (!a || new Date(b.createdAt || 0) > new Date(a.createdAt || 0) ? b : a);
    for (const invite of onboardingInvites) {
      const email = String(invite?.candidateEmail || "").trim().toLowerCase();
      const phone = digits(invite?.candidatePhone);
      if (email) byEmail.set(email, newer(byEmail.get(email), invite));
      if (phone) byPhone.set(phone, newer(byPhone.get(phone), invite));
    }
    return (candidate) => {
      const email = String(candidate?.email || "").trim().toLowerCase();
      if (email && byEmail.has(email)) return byEmail.get(email);
      const phone = digits(candidate?.phone);
      return (phone && byPhone.get(phone)) || null;
    };
  }, [onboardingInvites]);

  /** The onboarding link, on the clipboard - the short code's URL, which is what the email carries. */
  const copyOnboardingLink = useCallback(async (invite) => {
    const copied = await copyToClipboard(invite?.onboardingUrl || "");
    if (copied) showSuccess("Onboarding link copied.");
    // Not an error: the clipboard is refused over plain http and when the page is not focused, so
    // the answer is the link itself rather than a failure the reader can do nothing about.
    else showNotice(invite?.onboardingUrl || "There is no link to copy yet.", "error");
  }, [showNotice, showSuccess]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAppliedFilters((current) => (sameFilters(current, columnFilters) ? current : columnFilters)),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [columnFilters]);

  /*
   * What "the values this column holds" is a question *about* - the stage, and deliberately **not**
   * the other columns' filters.
   *
   * The filters are still *sent*, so a menu opened after another column has been filtered offers
   * what that filter leaves standing - the cascade. What they are not part of is the **key the
   * answer is cached under**, and that distinction is the whole of this comment.
   *
   * Keyed on the filters too, the cached answer was thrown away the moment anybody filtered
   * anything. With a single-select that would be invisible: picking a value closes the menu, and the
   * next open asks afresh. These are multi-selects, so the reader is still **in** the menu when the
   * filter changes - ticking the first value emptied the list under their hand, and after Select all
   * the menu read "No matches." over a filter of three. The CRM board hit this exactly and settled
   * the same way.
   *
   * So the list a reader is working in stays put, and re-narrows the next time it is opened. The
   * stage still changes the question and still asks it again.
   */
  const columnValuesKey = statusFilter;
  const filterValues = useMemo(() => ({
    // Which columns offer a list at all: the ones the server will answer for. Everything else keeps
    // the plain text box, which is the right control for a name somebody types part of.
    has: (column) => FILTERABLE_CANDIDATE_COLUMNS.includes(column),
    get: (column) => (columnValues.key === columnValuesKey ? columnValues.byColumn[column] : null),
    loading: loadingColumnValues,
    onOpen: (column) => {
      setColumnValues((current) => {
        const held = current.key === columnValuesKey ? current : { key: columnValuesKey, byColumn: {} };
        if (held.byColumn[column]) return held;
        setLoadingColumnValues(column);
        void getCandidateColumnValues(column, statusFilter === ALL_CANDIDATE_STATUSES ? "" : statusFilter, appliedFilters)
          .then((response) => {
            const values = Array.isArray(response?.data) ? response.data : [];
            // Against the key it was asked under: an answer that arrives after the reader has moved
            // to another tab describes the tab they left and must not be shown against this one.
            setColumnValues((latest) => (latest.key === columnValuesKey
              ? { key: latest.key, byColumn: { ...latest.byColumn, [column]: values } }
              : latest));
          })
          .catch(() => setColumnValues((latest) => (latest.key === columnValuesKey
            ? { key: latest.key, byColumn: { ...latest.byColumn, [column]: [] } }
            : latest)))
          .finally(() => setLoadingColumnValues((current) => (current === column ? "" : current)));
        return held;
      });
    },
  }), [columnValues, columnValuesKey, loadingColumnValues, statusFilter, appliedFilters]);

  /** The candidate's link, on the clipboard. The short code's URL, which is what the email carries. */
  /*
   * Moving a waiting candidate on to **Form Submitted** by hand.
   *
   * The screening form is one way answers arrive, not the only one: a candidate replies on
   * WhatsApp, emails a CV, or reads the questions out over the phone. Until now that row stayed at
   * Form Submission Pending until the link was used, so a candidate the studio had already heard
   * from sat on a tab meaning "waiting on them" - and HR's own note of what they said had nowhere
   * to be read from.
   *
   * No Why dialog: that is for Selected, On Hold and Rejected, which are decisions somebody has to
   * answer for. This is a stage moving forward, so it goes straight through, the same way sending
   * an onboarding invite moves a candidate to Onboarded.
   *
   * The form itself is left exactly as it is. A live link still works and the candidate can still
   * use it - Cancel Form is the entry for calling it off, and doing that silently here would take
   * the decision away from whoever is looking at the row.
   */
  const markFormSubmitted = useCallback(async (candidate) => {
    try {
      await setCandidateStatus(candidate.id, FORM_SUBMITTED_STATUS);
      showSuccess(`${candidate.name || "The candidate"} moved to ${FORM_SUBMITTED_STATUS}.`);
      await load({ quiet: true });
    } catch (error) {
      showError(errorMessage(error, `Unable to move ${candidate.name || "this candidate"} to ${FORM_SUBMITTED_STATUS}.`));
    }
  }, [load, showError, showSuccess]);

  const copyInviteLink = useCallback(async (invite) => {
    const copied = await copyToClipboard(invite?.applicationUrl || "");
    if (copied) showSuccess("Screening form link copied.");
    // Not an error: the clipboard is refused over plain http and when the page is not focused, so
    // the answer is the link itself rather than a failure the reader can do nothing about.
    else showNotice(invite?.applicationUrl || "There is no link to copy yet.", "error");
  }, [showNotice, showSuccess]);

  /*
   * There is no `moveStatus` here any more, and that is the point of the decision dialog.
   *
   * Selected, On Hold and Rejected used to move the stage on one click and offer **Undo**, on the
   * argument that a stage is a word on a row and the useful thing is to move it with a way back
   * rather than ask a question first. That argument held while there was no question to ask. There
   * is one now - *why* - and it is the answer the register was losing, so the three go through
   * `InterviewDecisionDialog`, which asks it before anything has happened. A dialog somebody opened
   * and typed a reason into is already the deliberate act Undo was standing in for.
   *
   * Everything else that moves a stage still does it the other way: the screening form's own
   * sending and cancelling move a candidate with no dialog at all, because those are consequences
   * of an act rather than decisions about a person.
   */

  /**
   * Sending a candidate's application back to them for edits.
   *
   * Confirmed first, unlike Reject beside it, and the difference is who it reaches: a stage is a word
   * on a row that moves back with one press, where this emails a person - and a mail that has gone
   * cannot be un-sent. The confirmation is also where the message HR is about to send is offered to
   * copy, so it is worth stopping at rather than something to press through.
   *
   * The register **and** the forms are re-read, because both change: the candidate moves back to
   * Form Submission Pending, and their form goes from Submitted to a live one - which is what decides
   * whether their record offers Resend Form or Send Screening Form the next time it is opened.
   *
   * The record panel closes with it. What was on screen was a submission to read, and it is the
   * candidate's again.
   */
  async function resendForm() {
    if (!resendTarget || resending) return;
    setResending(true);
    const finish = async () => {
      setResendTarget(null);
      setEditCandidate(null);
      await Promise.all([load({ quiet: true }), loadInvites()]);
    };
    try {
      await resendApplicationForm(resendTarget.candidate.id);
      await finish();
      showSuccess("Form sent again. The candidate has been emailed their own link to edit and resubmit.");
    } catch (requestError) {
      /*
       * A 502 means the form **was** reopened and only the email failed - the studio's mail quota is
       * spent, the candidate's inbox is full. The reopening happened, so this finishes exactly as a
       * success does and says in a notice that the message did not go. Whoever is sending it by hand
       * already holds it: the dialog offered it to copy before Resend Form was pressed.
       */
      if (requestError.status === 502) {
        await finish();
        showError(requestError.data?.warning
          ? `The form was reopened, but the email could not be sent: ${requestError.data.warning}. Send the message to them yourself.`
          : "The form was reopened, but the email could not be sent. Send the message to them yourself.");
      } else {
        showError(errorMessage(requestError, "Unable to resend this application form."));
        setResendTarget(null);
      }
    } finally {
      setResending(false);
    }
  }

  const defaultVisibility = useMemo(() => {
    const visibility = defaultVisibilityFor(candidateTableFields);
    for (const hidden of candidateDefaultHiddenColumns) visibility[hidden] = false;
    return visibility;
  }, []);

  const columns = useMemo(() => buildTableColumns({
    fields: candidateTableFields,
    startIndex: 0,
    /*
     * The stage dots and the mode dots in one map, which is what `buildTableColumns` takes: it
     * keys a `status` cell's colour by the cell's own value, and no stage is spelled like a mode,
     * so the two lists cannot collide. Merged here rather than in the config, so each stays a list
     * of one thing.
     */
    statusStyles: { ...candidateStatusStyles, ...candidateModeStyles },
    // Without `canWrite` the whole menu goes and the column with it, rather than a ⋮ that only ever
    // says "View" beside a row you can already click.
    renderActions: canWrite ? (candidate) => {
      // Where this candidate stands with their form; see `candidateFormState` for the three answers.
      const form = candidateFormState.get(candidate.id) || null;
      /*
       * A candidate waiting on their screening form has a menu of their own.
       *
       * At **Form Submission Pending** the row is one thing: somebody the studio is waiting on. So
       * the entries are the things there are to do about waiting - read them, hand them the link
       * again, correct what the form was raised on, turn them down, or call the form off - and Edit
       * and Delete are not among them, because neither is what this row is for. Every other stage
       * keeps the plain menu.
       */
      const waiting = candidate.status === FORM_PENDING_STATUS;
      /*
       * Turning a candidate down is offered at **every** stage, not only while a form is out.
       *
       * A candidate can be turned down after the form is read, after the interview, or off On Hold
       * weeks later, and each of those was a row whose menu had no way to say so - the stage had to
       * be changed by hand on the record. So Reject sits in both menus, just above the destructive
       * entry in each.
       *
       * The one row that does not get it is one already **Rejected**, where it would move the stage
       * to where it already is and offer an Undo back to itself.
       */
      const rejectable = candidate.status !== REJECTED_STATUS;
      const rejectItem = { label: "Reject", onSelect: () => setDecision({ candidate, status: REJECTED_STATUS }) };
      /*
       * Where the stage, the interview and the follow-ups are set now.
       *
       * They were the last section of the candidate's record, below four sections of their own
       * answers - so the one field anybody opens a candidate to change was the furthest thing from
       * the top of it. Offered on **every** row and in both menus, like Reject and On Hold beside
       * it: a candidate is scheduled, rescheduled or moved a stage at any point, including while a
       * screening form is still out. It reads first of the three, because it is the entry somebody
       * opens this menu *to* use - the other two are answers, this is the work.
       */
      /*
       * Scheduling, and what the row is actually asking for.
       *
       * A candidate nobody has called yet is **Schedule Interview**. One who has already been in is
       * **Schedule Next Round** - a second conversation is a new appointment, not a correction of
       * the first, and a menu that said "Schedule Interview" over an interview that had happened
       * invited exactly that mistake. **Edit Schedule** is the correction, and appears only where
       * there is something to correct: a date moved, a Meet link that changed, a mode that became a
       * phone call.
       *
       * Which round they are on is the server's own count, so the menu and the Round column cannot
       * disagree about whether this candidate has been seen.
       */
      const scheduled = Number(candidate.interviewRound) > 0;
      const scheduleItem = {
        label: scheduled ? "Schedule Next Round" : "Schedule Interview",
        onSelect: () => setScheduleCandidate({ candidate, mode: scheduled ? SCHEDULE_MODES.next : SCHEDULE_MODES.first }),
      };
      const editScheduleItem = scheduled
        ? { label: "Edit Schedule", onSelect: () => setScheduleCandidate({ candidate, mode: SCHEDULE_MODES.edit }) }
        : null;
      /*
       * Parking a candidate, offered wherever turning one down is and for the same reason.
       *
       * On Hold and Rejected are the two places a candidate stops, and only one of them could be
       * reached from a row: somebody the studio wants to keep but cannot place yet had to be
       * opened, edited and saved to say so, while turning the same person down was one press. That
       * made the easier answer the harsher one, which is the wrong way round in a register worked
       * through every morning - so both stages now sit together in every menu, at every stage, each
       * with the Undo that restores the stage it came from.
       *
       * The one row that does not get it is one already **On Hold**, where it would move the stage
       * to where it already is and offer an Undo back to itself - exactly as Rejected is left out
       * of Reject above. A rejected candidate *is* offered it: reconsidering somebody is a thing
       * the studio does, and parking them is how it is said.
       */
      const holdable = candidate.status !== ON_HOLD_STATUS;
      /*
       * The three decisions, each asked with its reason.
       *
       * They were a single click that changed the stage and recorded nothing about why: weeks later
       * nobody could say why a candidate was parked, and "we already spoke to them and said no" was
       * a thing the register could not tell you. Each now opens a dialog asking for a remark, which
       * is appended to the candidate's decisions rather than written over the last one.
       *
       * **Selected joins them**, where the stage could previously only be reached by opening the
       * record: the answer the whole register exists to arrive at was the one it did not offer.
       */
      const holdItem = { label: "Put On Hold", onSelect: () => setDecision({ candidate, status: ON_HOLD_STATUS }) };
      /*
       * **Chasing somebody**, which is the other half of what an untouched row is for.
       *
       * A candidate nobody has spoken to gets one of two things done to them: the screening form, or
       * a call. Only the first was a stage - the second was a remark, or nothing - so the register
       * could not tell "nobody has tried this person" from "we have called three times and they have
       * not answered", which are the two rows that need completely different work.
       *
       * Offered at **Yet to Connect and at Follow Up**, and nowhere else. Those are the two stages
       * where chasing *is* the work; everywhere further on, something has already happened that the
       * move would undo - a form out, a conversation in the diary, an answer given - and a register
       * that let a scheduled candidate be dropped back into the chase would lose the appointment.
       *
       * That a Follow Up row is offered it again is the point rather than an oversight: each press
       * records its own day and its own reason, so three unanswered calls read as three.
       */
      const followable = [DEFAULT_CANDIDATE_STATUS, FOLLOW_UP_STATUS].includes(candidate.status);
      /*
       * **On a row already at Follow Up the entry is named for what it does there.**
       *
       * Everywhere else in this menu, an entry naming a stage *moves* the candidate to it, and the
       * two that cannot are withheld: Reject is dropped from a rejected row, Put On Hold from one
       * already held, because there each would move the stage to where it already is and offer an
       * Undo back to itself. Read against that pattern, "Follow Up" sitting on a row that is already
       * at Follow Up looks like exactly the no-op those two are withheld for.
       *
       * It is not one. Chasing somebody is the one thing here that genuinely happens more than once,
       * and each attempt writes its own day and its own reason - so the entry has work to do on a
       * Follow Up row and only the word was wrong. **Log Another Follow-up** says the truth: not a
       * stage change, a second attempt recorded against the stage they are already on.
       */
      const chasing = candidate.status === FOLLOW_UP_STATUS;
      const followUpItem = {
        label: chasing ? "Log Another Follow-up" : "Follow Up",
        onSelect: () => setDecision({ candidate, status: FOLLOW_UP_STATUS }),
      };
      /*
       * A **Selected** candidate is a different row from the rest of the register.
       *
       * Every other stage is somewhere in a conversation; this one is finished, and the only things
       * left to do about the person are to take them on, read them, correct them, change the answer
       * or remove them. So the menu is those five and nothing else - no screening form to send to
       * somebody who has been offered the job, no round to schedule after the answer, no Mark
       * Selected on a row that already is. A menu that still offered all of that read as a register
       * that had not noticed it had decided.
       */
      const selectedStage = candidate.status === SELECTED_STATUS;
      const onboardingItem = { label: "Send Onboarding Invite", onSelect: () => setOnboarding(candidate) };
      // Raising, correcting or calling off an invite is `HRM / Employee Management` READ_WRITE.
      const mayInvite = onboardingAccess.canWrite;
      /*
       * An **Onboarded** candidate: the invite has gone out, so the row is about that invite.
       *
       * The same three questions a live screening form gets asked, about the onboarding one this
       * time - where the link is, correct what it was raised on, call it off - and then the four
       * that are true of any row. What it deliberately does **not** offer is everything about
       * deciding: there is no next round to schedule after somebody has been taken on, no stage to
       * mark them at, and nothing to put on hold. Reject stays, because a studio can still be told
       * no after the invite has gone.
       *
       * The three invite entries go together when there is no invite to act on - somebody moved to
       * this stage by hand, or by a sheet - rather than sitting there refusing.
       */
      /*
       * Correcting the record, offered once for the whole menu rather than written into each stage.
       *
       * It reads beside View because the two belong together - both are about the candidate rather
       * than about the hiring - and having it defined here keeps the four branches to the work that
       * is actually different between them.
       */
      /*
       * **Review**, not Edit, for a candidate whose form has come back.
       *
       * The two words ask different things of whoever presses them. *Edit* is "something on this
       * record is wrong"; a candidate at **Form Submitted** is not a record anybody is correcting,
       * they are an application waiting to be **read** - and the register's whole reason for that
       * tab is that somebody has to read it and decide. One word on the menu is what turns a row
       * from a thing to tidy into a thing to answer.
       *
       * The same panel opens either way: a submission is read by reading it, and the fields are the
       * fields. What changes is the footer - see `review` on `InterviewCandidateFormPanel`, which
       * ends a review with the four answers it can have rather than with a save.
       */
      const reviewing = candidate.status === FORM_SUBMITTED_STATUS;
      const editItem = { label: reviewing ? "Review" : "Edit", onSelect: () => setEditCandidate(candidate) };
      const onboardedStage = candidate.status === ONBOARDED_STATUS;
      const onboardingInvite = onboardedStage ? candidateOnboardingInvites(candidate) : null;
      /*
       * A **live** onboarding invite: one the candidate can still open, and one the server will
       * still let this screen act on.
       *
       * `!== "Cancelled"` was too generous in both directions - it offered **Cancel Invite** on an
       * invite already `Submitted`, which `cancelInvite` refuses with a 400, and on an `Expired`
       * one. The two statuses that are actually live are the two the screening form's own rule
       * names, and this now names the same pair rather than a different one.
       */
      const liveOnboarding = Boolean(onboardingInvite)
        && ["Created", "Verified"].includes(onboardingInvite.status)
        && mayInvite;
      /*
       * **Mark Selected, at every stage.**
       *
       * It used to appear only from Interview Scheduled onward, on the reasoning that nobody had
       * spoken to a candidate before then so "Selected" was not yet an answer. The studio asked for
       * it from **Yet to Connect**, and the reasoning does not survive the way hiring actually
       * happens here: somebody is taken on off a referral, or off a conversation that never became
       * a scheduled round, and the register has to be able to say so without walking the candidate
       * through stages nobody used. Every stage moves through the same Why dialog as Reject and On
       * Hold, so a selection made early still records the reason it was made.
       *
       * The one row that does not get it is one already Selected, where it would move the stage to
       * where it already is - the same rule Reject and On Hold each keep.
       */
      const selectable = candidate.status !== SELECTED_STATUS;
      const selectItem = { label: "Mark Selected", onSelect: () => setDecision({ candidate, status: SELECTED_STATUS }) };
      return <OptionsMenu
        ariaLabel={`Actions for ${candidate.candidateCode || "candidate"}`}
        menuClassName="w-52"
        items={[
          // Enabled, and it does what clicking the row does: opens the record beside the table. It
          // was greyed while it led nowhere the row did not; now it is the first thing a menu on a
          // row somebody is reading should offer.
          { label: "View", onSelect: () => setViewCandidate(candidate) },
          /*
           * **Reading and correcting, together at the top.**
           *
           * The two things somebody does to *the candidate* rather than to their hiring - open the
           * record, put a mistyped number right - and they were scattered: second on one stage,
           * fourth on another, below an invite's three entries on a third. Everything under them is
           * about the hiring itself, in the order that stage's work happens.
           *
           * Offered at **every** stage. It used to be withheld in two - a row waiting on its
           * screening form, and one at Yet to Connect that "held nothing anybody had learned yet" -
           * and both readings were wrong about what Edit is for. A number arrives mistyped from a
           * sheet, a name comes through in capitals, a position is filed against the wrong
           * department: those are corrections to what *arrived*, and they are most needed exactly
           * where nobody has touched the record yet. Withholding it there meant the one stage with
           * the most unchecked data was the one stage that could not be put right.
           *
           * It still reads **Review** rather than Edit on a submitted form, which is the same entry
           * saying what the row is for at that stage.
           */
          editItem,
          ...(onboardedStage ? [
            ...(liveOnboarding ? [
              onboardingInvite.onboardingUrl
                ? { label: "Copy Link", onSelect: () => void copyOnboardingLink(onboardingInvite) }
                : { label: "Copy Link", disabled: true, title: "This invite's link cannot be rebuilt. Cancel it and send a new one to get one." },
              { label: "Edit Invite", onSelect: () => setOnboarding({ ...candidate, editInvite: onboardingInvite }) },
            ] : []),
            ...(rejectable ? [rejectItem] : []),
            ...(liveOnboarding ? [
              { label: "Cancel Invite", tone: "danger", onSelect: () => setPendingCancelOnboarding({ invite: onboardingInvite, candidate }) },
            ] : []),
            { label: "Delete", tone: "danger", onSelect: () => setPendingDelete(candidate) },
          ] : selectedStage ? [
            /*
             * Taking them on, which is what this row is now for. It opens the Employee Repository's
             * own invite dialog rather than a second one of this module's: an onboarding invite is
             * the repository's record and always has been, and two screens raising the same invite
             * would be two places to fix when it changes.
             */
            ...(mayInvite ? [onboardingItem] : []),
            ...(rejectable ? [rejectItem] : []),
            { label: "Delete", tone: "danger", onSelect: () => setPendingDelete(candidate) },
          ] : waiting ? [
            /*
             * The form is out, so its link and its details are what this row is asked about. Both
             * go when there is nothing live to act on - a stage typed straight onto a row by a
             * sheet, say, with no form behind it - rather than sitting there refusing.
             */
            ...(form?.live ? [
              form.invite.applicationUrl
                ? { label: "Copy Link", onSelect: () => void copyInviteLink(form.invite) }
                : { label: "Copy Link", disabled: true, title: "This form's link cannot be rebuilt. Cancel it and send a new one to get one." },
              // The dialog's own Edit screen, opened straight onto this form. The link is kept,
              // which is the whole point of correcting one rather than cancelling and re-sending.
              { label: "Edit Invite", onSelect: () => setInviteDialog({ mode: "create", candidate, editInvite: form.invite }) },
            ] : []),
            /*
             * Turning them down. Not red, and not behind a confirmation: a stage is a word on a row
             * that can be moved back, and it is offered with **Undo** instead, which restores the
             * stage it came from. Cancel Form below is the red one because a cancelled link cannot
             * be revived - the token is stored hashed.
             *
             * Parking them reads first: a candidate whose form is still out can be put aside as
             * readily as turned down, and the gentler of the two answers comes before the harsher.
             */
            /*
             * **Mark Form Submitted** reads first: it is the thing that ends the waiting, and the
             * answers a form would have carried can arrive by any route - a WhatsApp reply, an
             * emailed CV, a phone call. Everything under it is what to do while the wait goes on.
             */
            { label: "Mark Form Submitted", onSelect: () => void markFormSubmitted(candidate) },
            /*
             * No scheduling here, and no Mark Selected.
             *
             * This row is one thing: somebody the studio is **waiting on**. A conversation is put in
             * the diary after their form has been read, not before it has arrived - a round booked
             * against answers nobody has is a round somebody has to move - and selecting them is
             * the same mistake one stage further on. Both are on the menu the moment the form comes
             * back. What is left is the waiting itself: hand them the link again, correct what the
             * form was raised on, park them, turn them down, or call the form off.
             */
            ...(holdable ? [holdItem] : []),
            ...(rejectable ? [rejectItem] : []),
            ...(form?.live ? [
              { label: "Cancel Form", tone: "danger", onSelect: () => setPendingCancelInvite({ invite: form.invite, candidate }) },
            ] : []),
          ] : [
            // Every other stage: the plain menu, which is the hiring itself in the order its work
            // happens - the screening form, the interview, then the answer.
            /*
             * One entry about the form, or none. A live form gets **Copy Link**; one already
             * **submitted** gets nothing, because Edit is the answer to a form that has arrived and
             * asking again somebody who has answered is the one thing nobody wants; anything else -
             * never asked, lapsed, called off - gets **Send Screening Form**.
             */
            ...(form?.live ? [
              form.invite.applicationUrl
                ? { label: "Copy Link", onSelect: () => void copyInviteLink(form.invite) }
                : { label: "Copy Link", disabled: true, title: "This form's link cannot be rebuilt. Cancel it and send a new one to get one." },
            ] : form?.submitted ? [] : [
              { label: "Send Screening Form", onSelect: () => setInviteDialog({ mode: "create", candidate }) },
            ]),
            // Beside the form, because those two are the whole of what an untouched row offers: send
            // them the form, or chase them. A Follow Up row gets the same pair again.
            ...(followable ? [followUpItem] : []),
            scheduleItem,
            ...(editScheduleItem ? [editScheduleItem] : []),
            // Above Delete, the way they sit above Cancel Form in the waiting menu: the stages that
            // can be undone first, the thing that cannot be after them.
            ...(selectable ? [selectItem] : []),
            ...(holdable ? [holdItem] : []),
            ...(rejectable ? [rejectItem] : []),
            { label: "Delete", tone: "danger", onSelect: () => setPendingDelete(candidate) },
          ]),
        ]}
      />;
    } : undefined,
  }), [canWrite, onboardingAccess.canWrite, candidateFormState, candidateOnboardingInvites, copyInviteLink, copyOnboardingLink, markFormSubmitted]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  function openInfoPanel(candidate) {
    setInfoCandidate(candidate);
    setInfoPanelState("expanded");
  }

  const toggleInfoPanel = () => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded");

  /**
   * Calling off the form a candidate is holding.
   *
   * Confirmed first, unlike Reject beside it, and the difference is whether there is a way back: a
   * stage moves back with one press, where a cancelled link cannot be revived - the token is stored
   * hashed, so sending again raises a new one. The server also moves a candidate at Form Submission
   * Pending back to Yet to Connect, which is why the register is re-read as well as the forms.
   */
  async function confirmCancelInvite() {
    if (!pendingCancelInvite || cancellingInvite) return;
    setCancellingInvite(true);
    try {
      await cancelApplicationInvite(pendingCancelInvite.invite.id);
      setPendingCancelInvite(null);
      showSuccess("Screening form cancelled.");
      await Promise.all([load({ quiet: true }), loadInvites()]);
    } catch (cancelError) {
      showError(errorMessage(cancelError, "Unable to cancel that screening form."));
    } finally {
      setCancellingInvite(false);
    }
  }

  /**
   * Deleting the candidate the confirmation names. A soft delete on the server, and one a linked
   * sheet will not undo: the row it came from is remembered as imported and stays out.
   */
  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteCandidate(pendingDelete.id);
      const code = pendingDelete.candidateCode || "That candidate";
      setEditCandidate((current) => current?.id === pendingDelete.id ? null : current);
      // The record being read closes too, or a deleted candidate stays on screen in full.
      setViewCandidate((current) => current?.id === pendingDelete.id ? null : current);
      setInfoCandidate((current) => current?.id === pendingDelete.id ? null : current);
      setPendingDelete(null);
      showSuccess(`${code} deleted.`);
      await load();
    } catch (deleteError) {
      showError(errorMessage(deleteError, "Unable to delete that candidate."));
    } finally {
      setDeleting(false);
    }
  }

  /**
   * The whole selection deleted together.
   *
   * A soft delete each, exactly as the row menu's own delete is, and the server names what it could
   * not find rather than refusing the lot - a candidate removed in another tab between the read and
   * the press is counted, not fatal. Everything on screen showing one of them closes for the reason
   * the single delete closes them: a deleted candidate left open in a panel is a record somebody
   * goes on editing.
   */
  async function confirmBulkDelete() {
    if (bulkDeleting || !selectedCount) return;
    setBulkDeleting(true);
    try {
      // With "all matching" this is the server's answer rather than a list the browser holds; see
      // `resolveSelectedIds`, which also refuses a stage too large for one action.
      const ids = await resolveSelectedIds();
      if (!ids.length) { setPendingBulkDelete(false); clearSelection(); return; }
      const response = await deleteCandidatesBulk(ids);
      const gone = new Set(response?.data?.deletedIds || ids);
      setEditCandidate((current) => current && gone.has(current.id) ? null : current);
      setViewCandidate((current) => current && gone.has(current.id) ? null : current);
      setInfoCandidate((current) => current && gone.has(current.id) ? null : current);
      setPendingBulkDelete(false);
      clearSelection();
      showSuccess(response?.message || `${gone.size} candidate${gone.size === 1 ? "" : "s"} deleted.`);
      await load();
    } catch (deleteError) {
      showError(errorMessage(deleteError, "Unable to delete the selected candidates."));
    } finally {
      setBulkDeleting(false);
    }
  }

  /** A candidate added or corrected: the screen that did it closes, and the register is re-read. */
  async function afterSave(saved, message) {
    setAddOpen(false);
    setEditCandidate(null);
    if (saved && infoCandidate?.id === saved.id) setInfoCandidate(saved);
    showSuccess(message);
    await load();
  }

  /**
   * Bulk Entry's batch, written.
   *
   * A batch where one candidate fails is not a batch that failed: the server writes the rest and
   * names the rows it could not, so the notice says both. The dialog closes either way - the rows
   * that landed are on the register behind it, and the ones that did not are named in the notice.
   */
  async function submitBulk(records) {
    try {
      const response = await createCandidatesBulk(records);
      const added = (response?.data || []).length;
      const failed = response?.errors || [];
      setBulkOpen(false);
      if (failed.length) {
        showError(`${added} candidate${added === 1 ? "" : "s"} added. ${failed.map((entry) => `Candidate ${entry.position}: ${entry.message}`).join(" · ")}`);
      } else {
        showSuccess(`${added} candidate${added === 1 ? "" : "s"} added to the register.`);
      }
      await load();
    } catch (bulkError) {
      /*
       * A batch refused for duplicates names its rows here and, through the rethrow below, on the
       * rows themselves. The message alone leaves somebody counting down a grid of twenty to find
       * which two lines were the problem, which is the whole of the work.
       */
      const clashes = Array.isArray(bulkError?.data?.errors) ? bulkError.data.errors : [];
      const rows = clashes.map((entry) => entry?.row).filter(Boolean);
      showError(rows.length
        ? `${errorMessage(bulkError, "Unable to add those candidates.")} Candidate${rows.length === 1 ? "" : "s"} ${rows.join(", ")}.`
        : errorMessage(bulkError, "Unable to add those candidates."));
      // Rethrown so the dialog - which stays open precisely so the batch can be corrected - can
      // mark the offending rows. It reports nothing itself; this line is the message.
      throw bulkError;
    }
  }

  /**
   * Import, defined once and offered in the header's ⋮ and in the table's own. A candidate's code
   * is minted from the studio's counter inside the create, so a file cannot bring one.
   */
  /*
   * Memoised rather than rebuilt each render, which it has to be now that `onImported` reaches a
   * reader that guards itself with a ref: an object literal carrying it is otherwise read as
   * touching that ref during render. It is a constant apart from the permission anyway, and the
   * table takes it as a prop, so rebuilding it per render only ever cost renders.
   */
  const importConfig = useMemo(() => (canWrite ? {
    prefix: "/api/hrm/interview",
    columns: INTERVIEW_IMPORT_COLUMNS,
    templateName: "interview-candidate-import-template",
    title: "Import Candidates",
    onImported: () => load(),
  } : undefined), [canWrite, load]);

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="Interview"
        tabs={CANDIDATE_STATUS_FILTERS.map((filter) => ({ id: filter.id, label: filter.label, count: statusCounts[filter.id] || 0 }))}
        tabValue={statusFilter}
        onTabChange={changeTab}
        tabsAriaLabel="Filter candidates by status"
        /*
         * The primary button and the ⋮ after it, which is where every header in the application
         * puts its quiet trigger - so the primary keeps the position the eye goes to and the three
         * other ways in are one press away rather than four buttons wide.
         */
        /*
         * **A selection takes the bar over**, which is the CRM board's own arrangement.
         *
         * While anything is ticked the two things a selection does stand where Add Application and
         * the ⋮ stand, and they go back the moment it is cleared. Two sets of buttons side by side
         * would put an action on thirty candidates next to one that adds a thirty-first, and the
         * primary position - the place the eye lands - would belong to neither.
         *
         * Delete is red and reads **first**, so the destructive one is never what the eye lands on:
         * the primary slot on the right stays with the stage change, which is the ordinary answer.
         * Both are absent rather than disabled for a role without Select All - it can hold no
         * selection to begin with, and the bulk routes refuse it besides.
         */
        /*
         * This page swaps its own actions on a selection, so the header must not stand them down
         * the way it does for every other screen - see `ownsSelectionActions` in `ModulePageHeader`.
         * Export and Clear arrive beside these two from the table itself.
         */
        ownsSelectionActions
        actions={!canWrite ? null : canSelectCandidates && selectedCount > 0 ? <>
          <Button type="button" variant="danger" onClick={() => setPendingBulkDelete(true)}>
            Delete ({selectedCount.toLocaleString()})
          </Button>
          <Button type="button" variant="primary" onClick={() => setBulkStageOpen(true)}>
            Change Stage ({selectedCount.toLocaleString()})
          </Button>
        </> : <>
          <Button type="button" variant="primary" onClick={() => setAddOpen(true)}>Add Application</Button>
          <OptionsMenu
            ariaLabel="More interview actions"
            menuClassName="w-48"
            items={[
              { label: "Bulk Entry", onSelect: () => setBulkOpen(true) },
              { label: "Import", onSelect: () => setImportOpen(true) },
              { label: "View All Invites", onSelect: () => setInviteDialog({ mode: "list" }) },
            ]}
          />
        </>}
      />

      <FloatingNotice notice={notice} onClose={clearNotice} />

      <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30">
        <span>Last updated: {updatedText}</span>
        {/* What is on screen against what the stage holds, so scrolling reads as progress through a
            known set rather than a number that grows out of nowhere. */}
        <span>{loadingMore ? "Loading more..." : `Showing ${candidates.length.toLocaleString()} of ${totalRows.toLocaleString()}`}</span>
      </TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              // Keyed on the status, so switching draws a fresh table rather than scrolling the
              // previous one's rows.
              key={statusFilter}
              columns={columns}
              data={visibleCandidates}
              importConfig={importConfig}
              density={density}
              loading={loading}
              loadingMessage="Loading candidates..."
              emptyMessage={statusFilter === ALL_CANDIDATE_STATUSES
                ? "No candidates yet. Add an application, or link a Google Sheet under Settings → Integrations → Interview."
                : "No candidates at that stage."}
              noMatchMessage="No matching candidates found."
              selectedRowId={infoCandidate?.id}
              onRowClick={openInfoPanel}
              // Reading, never editing - the gesture every other table in the OS answers the same
              // way. Editing is asked for by name, from the row's ⋮, which is also where the rules
              // about who may edit what already live.
              onRowDoubleClick={setViewCandidate}
              defaultColumnVisibility={defaultVisibility}
              onVisibleRowsChange={setInfiniteStats}
              ariaLabel="Interview candidates table"
              columnOrderKey="hrm-interview"
              features={{
                /*
                 * The column of tick boxes, and only for a role that holds `HRM / Interview Select
                 * All` as well as the screen's own write. `undefined` rather than a disabled column:
                 * a control a role may not use is absent, not there and refusing.
                 *
                 * The model is memoised rather than written inline, because the table rebuilds its
                 * columns whenever it changes - an inline object would rebuild them every render.
                 */
                selection: canWrite && canSelectCandidates ? {
                  // A model rather than a set: the register is paged, so "every row shown" is not
                  // the selection - see `selectionModel`.
                  model: selectionModel,
                  rowLabel: (candidate) => candidate?.name || candidate?.candidateCode || "this candidate",
                } : undefined,
                filtering: true,
                // The register is paged, so the filter menus ask the column rather than the rows
                // the browser happens to hold - see `filterValues`.
                filterValues,
                // Filtered by the server, over the stage rather than over the page in hand - so a
                // value the column holds finds its rows even when they have not been scrolled to.
                onColumnFilters: setColumnFilters,
                sorting: true,
                columnVisibility: true,
                columnResize: true,
                /*
                 * The page owns the paging, so every row fetched is drawn - see `serverPaged` in
                 * `DataTable`. Revealing them a second time meant two counters over the same rows:
                 * the footer read "500" over a table showing three hundred, because a fetch near the
                 * bottom ran ahead of a reveal that only advanced on a later scroll.
                 */
                infiniteScroll: { onEndReached: loadMore },
                csvExport: { enabled: true, fileName: "interview-candidates", onResult: (exported) => showNotice(exported ? "Interview CSV export downloaded." : "No rows available to export.") },
              }}
            />
          </div>
          <DataTableInfoPanel
            title="Info"
            entity={infoCandidate}
            sections={candidateInfoSections}
            formatters={interviewInfoFormatters}
            emptyText="Select a candidate to view details."
            state={infoPanelState}
            onToggle={toggleInfoPanel}
          />
        </div>
      </DataTableShell>

      {/* Add Lead's own dialog, asked of a candidate: the six things an arriving application
          carries. Everything else is on the record, which a row opens. */}
      {addOpen && <InterviewAddApplicationDialog
        options={options}
        onClose={() => setAddOpen(false)}
        onAdded={afterSave}
      />}

      {/* The full record, opened by the row menu and by a double-click - so it takes `canWrite` as
          a prop rather than relying on the control that opened it having been hidden. */}
      {onboarding && <OnboardingInviteDialog
        /*
         * The repository's own dialog, opened with the candidate's answers already in it: the four
         * questions it asks - who, their email, their number and the job - are four the register
         * has held since the application arrived, and retyping them here is how a number gets a
         * digit wrong between two screens that both already know it.
         */
        // Keyed per errand, so Edit Invite after Send does not open on the other one's values.
        key={onboarding.editInvite?.id || onboarding.id}
        /*
         * Correcting the invite this candidate already holds keeps its link, which is the whole
         * reason it is a correction rather than a second invite. `prefill` is for the other errand
         * - a **new** invite, filled from what the register already knows.
         */
        initialEditInvite={onboarding.editInvite || null}
        prefill={onboarding.editInvite ? null : {
          candidateName: onboarding.name || "",
          candidateEmail: onboarding.email || "",
          candidatePhone: onboarding.phone || "",
          intendedDesignation: onboarding.position || "",
        }}
        onClose={() => { setOnboarding(null); void loadOnboardingInvites(); }}
        onInviteSent={(message) => showSuccess(message || "Onboarding invite sent.")}
        onInviteCreated={() => {
          // Correcting an invite is not taking somebody on again: the stage is already Onboarded,
          // and moving it a second time would write a second "invite sent" into their decisions.
          if (onboarding.editInvite) { void loadOnboardingInvites(); return; }
          /*
           * The invite exists, so the candidate has been taken on: their stage moves to Onboarded
           * and they leave the Selected tab for it. Through the stage route with a note, so the
           * register says *why* it moved rather than appearing to have changed on its own.
           *
           * **The dialog is deliberately left open.** Creating an invite is not the end of the
           * errand: the dialog's own next screen is the hand-over - the link, and the studio's
           * wording from Settings → Employee Invite Template to paste into WhatsApp. Closing it
           * here, which is what this did, threw that screen away the moment it appeared and left
           * somebody holding an invite they had no way to send. The reader closes it.
           */
          const moved = onboarding;
          void setCandidateStatus(moved.id, ONBOARDED_STATUS, "Onboarding invite sent.")
            .then(() => load({ quiet: true }))
            // The invite was raised whatever happens here, so this reports the stage rather than
            // the invite: telling somebody the invite failed would be untrue and would have them
            // send a second one.
            .catch((error) => showError(errorMessage(error, `The invite was sent, but the candidate could not be moved to ${ONBOARDED_STATUS}.`)));
        }}
      />}

      {decision && <InterviewDecisionDialog
        candidate={decision.candidate}
        status={decision.status}
        canWrite={canWrite}
        onClose={() => setDecision(null)}
        onSaved={(message) => {
          setDecision(null);
          showSuccess(message);
          void load({ quiet: true });
        }}
      />}

      {scheduleCandidate && <InterviewScheduleDialog
        // Keyed per candidate and per errand, so opening Edit Schedule after Next Round does not
        // reuse the values the other one was drafted with.
        key={`${scheduleCandidate.candidate.id}-${scheduleCandidate.mode}`}
        candidate={scheduleCandidate.candidate}
        mode={scheduleCandidate.mode}
        options={options}
        canWrite={canWrite}
        onClose={() => setScheduleCandidate(null)}
        onSaved={(saved, message) => {
          setScheduleCandidate(null);
          showSuccess(message);
          void load({ quiet: true });
        }}
      />}

      {editCandidate && <InterviewCandidateFormPanel
        candidate={editCandidate}
        options={options}
        canWrite={canWrite}
        /*
         * Whether this is a **review** rather than a correction, off the stage the row carries: a
         * candidate at Form Submitted has an application waiting to be read. Read here rather than
         * inside the panel, because it is the same reading the row menu does to say **Review**, and
         * the menu and the footer it opens must not disagree about which errand this is.
         */
        review={editCandidate.status === FORM_SUBMITTED_STATUS}
        /*
         * Whether this candidate has already answered, off their latest form rather than off their
         * stage - a stage is not a form. It decides which of the two the footer offers: somebody who
         * has answered gets **Resend Form**, and only somebody who has not is asked for one.
         */
        formSubmitted={Boolean(candidateFormState.get(editCandidate.id)?.submitted)}
        onClose={() => setEditCandidate(null)}
        onSaved={afterSave}
        /*
         * Resend Form saves the record first too, so HR's own corrections are kept before the form
         * goes back - then asks the question, because this one emails a person.
         */
        onResendApplicationForm={(saved) => setResendTarget({
          candidate: saved || editCandidate,
          invite: candidateFormState.get(editCandidate.id)?.invite || null,
        })}
        /*
         * Send Screening Form saves the record first and then opens the invite dialog on it, so
         * the link is raised against the details somebody has just corrected and the form the
         * candidate fills in updates that row rather than creating a second one.
         */
        onSendApplicationForm={async (saved) => {
          setEditCandidate(null);
          await load();
          setInviteDialog({ mode: "create", candidate: saved });
        }}
        /*
         * The review's forward answer: the record is saved and the schedule dialog opens on what was
         * just saved, so the round is booked against the corrections rather than against the details
         * last written - the same arrangement Send Screening Form above uses, for the same reason.
         *
         * Which errand the dialog opens on is read from the saved candidate's own round count, not
         * from the row the panel was opened from: a review that has been sitting open while somebody
         * else scheduled a round would otherwise book a second Round 1 over the first.
         */
        onScheduleInterview={async (saved) => {
          setEditCandidate(null);
          await load();
          const target = saved || editCandidate;
          const alreadySeen = Number(target?.interviewRound) > 0;
          setScheduleCandidate({ candidate: target, mode: alreadySeen ? SCHEDULE_MODES.next : SCHEDULE_MODES.first });
        }}
      />}

      {resendTarget && <ResendApplicationFormDialog
        candidate={resendTarget.candidate}
        invite={resendTarget.invite}
        sending={resending}
        onCancel={() => setResendTarget(null)}
        onConfirm={() => void resendForm()}
      />}

      {bulkStageOpen && <InterviewBulkStageDialog
        resolveIds={resolveSelectedIds}
        count={selectedCount}
        canWrite={canWrite && canSelectCandidates}
        onClose={() => setBulkStageOpen(false)}
        onSaved={(message) => {
          setBulkStageOpen(false);
          clearSelection();
          showSuccess(message);
          void load({ quiet: true });
        }}
      />}

      {pendingBulkDelete && <ConfirmDialog
        open
        title={`Delete ${selectedCount} candidate${selectedCount === 1 ? "" : "s"}?`}
        /* Named as a count rather than as a list: a confirmation that prints thirty names is one
           nobody reads. The sentence is the single delete's, said of a set - what is lost, and that
           a linked sheet will not bring them back. */
        message={`They are removed from the register. A linked sheet will not bring them back; the rows they came from are remembered as imported.`}
        confirmLabel={`Delete ${selectedCount} Candidate${selectedCount === 1 ? "" : "s"}`}
        busyLabel="Deleting..."
        loading={bulkDeleting}
        layer="dialogOverPanel"
        onCancel={() => { if (!bulkDeleting) setPendingBulkDelete(false); }}
        onConfirm={() => void confirmBulkDelete()}
      />}

      {bulkOpen && <InterviewBulkEntryDialog
        options={options}
        onClose={() => setBulkOpen(false)}
        onSubmit={submitBulk}
      />}

      {/* Rendered only while open, so a reopened dialog is a fresh mount and the last file's
          verdict does not greet the next import. */}
      {importOpen && importConfig && <ImportDialog
        onClose={() => setImportOpen(false)}
        title={importConfig.title}
        columns={importConfig.columns}
        templateName={importConfig.templateName}
        onImportChunk={(chunk) => importTableRows(importConfig.prefix, chunk).then((answer) => answer?.data || answer)}
        onImported={importConfig.onImported}
      />}

      {inviteDialog && <InterviewApplicationInviteDialog
        // Keyed per form as well as per candidate, so Edit Invite on one row never opens showing
        // the boxes filled in from another.
        key={inviteDialog.editInvite?.id || inviteDialog.candidate?.id || inviteDialog.mode}
        initialMode={inviteDialog.mode}
        initialCandidate={inviteDialog.candidate || null}
        // Set by **Edit Invite** on a row, which opens the dialog straight onto that form rather
        // than on a blank one - the Employee Repository's own Edit Invite does exactly this.
        initialEditInvite={inviteDialog.editInvite || null}
        options={options}
        onClose={() => setInviteDialog(null)}
        /*
         * Raising, correcting or cancelling a form moves the candidate's stage, so the register is
         * re-read - and so is the list of forms, because it is what decides which entries a row's
         * ⋮ offers. Without the second read, a form just raised leaves its row still offering
         * "Send Screening Form" until the next reload.
         */
        onInviteCreated={() => { void load(); void loadInvites(); }}
        onInviteChanged={() => { void load(); void loadInvites(); }}
        onInviteSent={(message) => { showSuccess(message || "Screening form sent."); void load(); void loadInvites(); }}
        onInviteSendFailed={(reason) => { showError(`${reason}. Send the message to them yourself.`); void load(); void loadInvites(); }}
      />}

      {/* The record, read back in full and nothing more: no boxes, no Save, and a field the
          candidate has nothing to say for is dropped rather than shown as an empty line. */}
      {viewCandidate && <RecordViewPanel
        title={viewCandidate.name || viewCandidate.candidateCode || "Candidate"}
        description={viewCandidate.candidateCode || undefined}
        entity={viewCandidate}
        sections={candidateInfoSections}
        formatters={interviewInfoFormatters}
        sidebarAriaLabel="Candidate sections"
        onClose={() => setViewCandidate(null)}
      />}

      {pendingCancelInvite && <ConfirmDialog
        open
        title="Cancel this screening form?"
        message={`${pendingCancelInvite.candidate?.name || "This candidate"} can no longer open the link they were sent, and it cannot be revived — sending another raises a new one. They move back to ${DEFAULT_CANDIDATE_STATUS}.`}
        confirmLabel="Cancel Form"
        busyLabel="Cancelling..."
        cancelLabel="Keep It"
        loading={cancellingInvite}
        layer="dialogOverPanel"
        onCancel={() => { if (!cancellingInvite) setPendingCancelInvite(null); }}
        onConfirm={() => void confirmCancelInvite()}
      />}

      {pendingCancelOnboarding && <ConfirmDialog
        open
        title="Cancel this onboarding invite?"
        /* A cancelled link cannot be revived - the token is stored hashed - so this asks first, the
           way cancelling a screening form does. The candidate keeps their stage: they were taken
           on, and calling off the link is not the studio changing its mind about that. */
        message={`${pendingCancelOnboarding.candidate?.name || "This candidate"} can no longer open the onboarding link they were sent, and it cannot be revived — sending another raises a new one.`}
        confirmLabel="Cancel Invite"
        cancelLabel="Keep It"
        onCancel={() => setPendingCancelOnboarding(null)}
        onConfirm={() => {
          const held = pendingCancelOnboarding;
          setPendingCancelOnboarding(null);
          void cancelOnboardingInvite(held.invite.id)
            .then(() => { showSuccess("Onboarding invite cancelled."); return loadOnboardingInvites(); })
            .catch((error) => showError(errorMessage(error, "Unable to cancel that onboarding invite.")));
        }}
      />}

      {pendingDelete && <ConfirmDialog
        open
        title={`Delete ${pendingDelete.candidateCode || "this candidate"}?`}
        message={`${pendingDelete.name || "This candidate"} is removed from the register. A linked sheet will not bring them back; the row it came from is remembered as imported.`}
        confirmLabel="Delete Candidate"
        busyLabel="Deleting..."
        loading={deleting}
        layer="dialogOverPanel"
        onCancel={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />}
    </section>
  );
}
