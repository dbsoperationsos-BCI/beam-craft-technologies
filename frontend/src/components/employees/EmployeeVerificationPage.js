"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import SideFilterList from "@/components/shared/SideFilterList";
import WorkHistoryFlow from "@/components/employees/WorkHistoryFlow";
import { createPortal } from "react-dom";
import { createEmployee, deleteEmployee as deleteEmployeeRequest, getEmployees, getPayslipDetailsSetting, reactivateEmployee as reactivateEmployeeRequest, sendBackOnboarding, updateEmployee } from "@/services/hrm/employees.service";
import { cancelOnboardingInvite, getOnboardingInvites } from "@/services/hrm/onboarding-invites.service";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportDialog from "@/components/data-table/ImportDialog";
import { importTableRows } from "@/services/api/tableImport.service";
import { EMPLOYEE_IMPORT_COLUMNS } from "@/constants/importColumns";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import AdministrationSwitch from "@/components/shared/AdministrationSwitch";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import IconButton from "@/components/shared/IconButton";
import { describeValidationError } from "@/lib/apiValidationError.mjs";
import EmployeeActionDialog, { ReactivateEmployeeDialog } from "./EmployeeActionDialog";
import CredentialsCreatedDialog from "./CredentialsCreatedDialog";
import SendBackDialog from "./SendBackDialog";
import EmployeeFormPanel from "./EmployeeFormPanel";
import SeparationFormPanel from "./SeparationFormPanel";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { employeeInfoSections, inviteInfoSections } from "@/constants/infoPanelConfig";
import EmployeeTable, { employeeRowActionItems, statusStyles as employmentStatusStyles } from "./EmployeeTable";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import useTableSelection from "@/components/data-table/useTableSelection";
import OnboardingInviteDialog from "./OnboardingInviteDialog";
import OffboardingInviteDialog from "./OffboardingInviteDialog";
import HandOverDialog from "./HandOverDialog";
import { getPendingWork, handOverPendingWork } from "@/services/hrm/separations.service";
import EmployeeOrgChart from "./EmployeeOrgChart";
import EmployeeCertificateDialog from "./EmployeeCertificateDialog";
import { INACTIVE_STATUSES, employmentStatusLabel, isOnboarding, isResignationPending, isReviewPending, isServingNotice, isWorking } from "@/lib/employmentStatus.mjs";
import { missingPayslipInfo } from "@/lib/payslipEmployeeDetails.mjs";
import { columnCount, columnNextWho, columnOldest, daysSince, expiresSoon } from "@/lib/kanbanSummary.mjs";
import { getBuiltInPayslipItems, getPayslipFields } from "@/services/hrm/payslipFields.service";

// One tab per employment status, so the bar reads as the statuses themselves rather than as
// groupings of them. The two onboarding statuses are two tabs for that reason: they are two
// different waits — one on the candidate, one on HR — and a single "Onboarding" tab hid which.
/*
 * Which rows of the repository the tick boxes belong on.
 *
 * Employees only. The table lists onboarding invites beside them - somebody who has been sent a
 * form and has not become an employee yet - and an invite is not a row of the employee register:
 * its id is `invite:<id>`, it is withdrawn through Cancel Invite rather than deleted, and sending
 * one to `/api/hrm/employees/bulk` could only ever be rejected. A row it excludes has no box at
 * all, rather than one that ticks and is then refused.
 *
 * Declared here rather than inline, so it is one function for the life of the module: it is read
 * while the tick-box column renders, and a new one each render would rebuild every column.
 */
const isEmployeeRow = (row) => row?.type !== "invite";

const tabs = [
  { label: "All", statuses: null },
  /*
   * Everything still waiting on somebody, in one place: whoever any of the pending kinds below holds
   * (`PENDING_KIND_LABELS`). Second, beside All, because it is where the day's work starts. It lists
   * each kind down its own side (`SideFilterList`) so the table beside it shows one kind or all of
   * them - and those kinds are reached only from here (`pendingOnly`), never from the bar as well.
   */
  { label: "Pending", filter: (row, payslipNeeds) => PENDING_KINDS.some((kind) => matchesTab(kind, row, payslipNeeds)) },
  // The same three every picker offers, so the tab and the dropdowns cannot disagree about who is
  // working here (see `workingEmployees`). Whoever is serving their notice is still working, so
  // they are counted here too - and also under their own tab next to it.
  { label: "Active", filter: isWorking },
  // Serving their notice: HR has approved their resignation. One still waiting for approval is under
  // Pending → HR Offboarding Pending until then, not here.
  { label: "Serving Notice", filter: isServingNotice },
  { label: "Employee Submission Pending", statuses: ["Employee Submission Pending"], pendingOnly: true },
  { label: "HR Onboarding Pending", statuses: ["HR Onboarding Pending"], pendingOnly: true },
  // A resignation form the employee has sent in (Submitted) and HR has not yet approved or rejected -
  // waiting on HR, unlike a form still Sent or Verified, which waits on the employee.
  { label: "HR Offboarding Pending", filter: isResignationPending, pendingOnly: true },
  /*
   * Working employees whose Payslip Info is missing something Edit Payslip asks for - a detail just
   * added there, most often - so HR can find them and fill it in. Asked of the payslip's own
   * requirements (`payslipNeeds`, read once the page opens), so it lists nobody until those are in.
   */
  { label: "Incomplete Profiles", filter: (row, payslipNeeds) => Boolean(payslipNeeds) && row?.type !== "invite" && isWorking(row) && missingPayslipInfo(row, payslipNeeds).length > 0 },
  /*
   * Not a status — an overlay over whichever the row already holds. A `filter` predicate rather
   * than a `statuses` list, so it can ask something other than "which employmentStatus is this",
   * and a row it matches still shows in its own status tab too (Active most often), instead of the
   * other tabs' either/or. See `isReviewPending`. Listed only down the Pending tab's side, not in
   * the tab bar - Pending already gathers it, and a second tab for it only repeated that.
   */
  { label: "Review Pending", filter: isReviewPending, pendingOnly: true },
  { label: "InActive", statuses: ["Relieved", "Absconded", "Long Leave", "Fired"] },
];

// What the Pending tab lists down its side, in the order of the tabs; "All Pending" first.
// Incomplete Profiles is a tab of its own in the bar, not one of these.
const PENDING_KIND_LABELS = ["Employee Submission Pending", "HR Onboarding Pending", "HR Offboarding Pending", "Review Pending"];
const PENDING_KINDS = tabs.filter((tab) => PENDING_KIND_LABELS.includes(tab.label));
// The tabs the bar shows; a `pendingOnly` one is reached through the Pending tab's side list.
const barTabs = tabs.filter((tab) => !tab.pendingOnly);
const ALL_PENDING = "All Pending";

/*
 * The Board's columns, in the order a person moves through them: invited (Employee Submission
 * Pending), form in (HR Onboarding Pending), working (Active), resigned and approved (Serving
 * Notice), gone (InActive) - not the tabs' order, which starts mid-way. Every one of the nine employment statuses
 * lands in exactly one of them, the same way the tabs count them. Every tab is offered on the Board
 * too: a status tab shows its own column alone, and an overlay (Incomplete Profiles, Pending and
 * each kind down its side) narrows the cards across all of them.
 */
const boardColumns = [
  { value: "Employee Submission Pending", className: `${employmentStatusStyles["Employee Submission Pending"]} text-white` },
  { value: "HR Onboarding Pending", className: `${employmentStatusStyles["HR Onboarding Pending"]} text-white` },
  { value: "Active", className: `${employmentStatusStyles.Active} text-white` },
  // No status of its own to borrow a colour from - somebody serving notice is still on a working
  // status - so the amber the table gives PIP, the other "working, with a caveat" status.
  { value: "Serving Notice", className: `${employmentStatusStyles.PIP} text-white` },
  { value: "InActive", className: `${employmentStatusStyles.Relieved} text-white` },
];
const joinedOn = (row) => {
  const time = new Date(row.dateOfJoining || row.createdAt || "").getTime();
  return Number.isNaN(time) ? null : time;
};
/*
 * The Pending tab's Board: a column for each kind of pending work, in the side list's order, rather
 * than the employment statuses - on Pending the question is "waiting on what", and a status column
 * of one card with four empty ones beside it answered nothing. A person in two kinds at once sits in
 * the first; pick a kind on the side and its own column shows alone.
 */
const PENDING_BOARD_COLUMNS = [
  { value: "Employee Submission Pending", className: `${employmentStatusStyles["Employee Submission Pending"]} text-white` },
  { value: "HR Onboarding Pending", className: `${employmentStatusStyles["HR Onboarding Pending"]} text-white` },
  { value: "HR Offboarding Pending", className: "bg-amber-600 text-white" },
  { value: "Review Pending", className: "bg-violet-500 text-white" },
];
/*
 * What each column says, in words HR reads at a glance - and on the cards it means, why.
 *
 * Employee Submission Pending: links about to run out first ("2 links expire in 2 days", each card
 * tagged "Expires 6 Nov"), else how long the oldest invite has gone unanswered. HR Onboarding
 * Pending: how long the oldest form has waited on HR. Active: reviews falling due this month, from
 * Next Review Date ("Review due 12 Nov" on the card). Serving Notice: who leaves next, by name.
 */
const HR_WAIT_DAYS = 7;
const sentOn = (row) => row.inviteCreatedAt || row.createdAt;
const reviewDueThisMonth = (row) => {
  const due = row.type === "invite" ? null : new Date(row.nextReviewDate || "");
  const now = new Date();
  return Boolean(due) && !Number.isNaN(due.getTime()) && due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth();
};
const boardCardFlag = (row, column) => {
  if (column.value === "Employee Submission Pending") return expiresSoon(row.inviteExpiresAt);
  if (column.value === "HR Onboarding Pending") {
    const days = daysSince(row.createdAt);
    return days !== null && days > HR_WAIT_DAYS ? `Waiting ${days} days` : "";
  }
  if (column.value === "Active") return reviewDueThisMonth(row) ? `Review due ${new Date(row.nextReviewDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  return "";
};
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const boardColumnFigure = (rows, column) => {
  if (column.value === "Employee Submission Pending") {
    const expiring = rows.filter((row) => Boolean(expiresSoon(row.inviteExpiresAt))).length;
    if (expiring) return { label: "", text: `${plural(expiring, "link expires", "links expire")} in 2 days`, title: "Invite links running out by the end of the day after tomorrow - tagged on their cards" };
    return columnOldest(rows, sentOn, (days) => `Oldest invite sent ${plural(days, "day", "days")} ago`);
  }
  if (column.value === "HR Onboarding Pending") return columnOldest(rows, (row) => row.createdAt, (days) => `Oldest waiting ${plural(days, "day", "days")}`);
  if (column.value === "Active") return columnCount(rows, reviewDueThisMonth, "Reviews due this month", "Employees whose Next Review Date falls this month - tagged on their cards");
  if (column.value === "Serving Notice") return columnNextWho(rows, (row) => row.dateOfRelieving, (row) => row.employeeName, "Next to leave");
  return null;
};
const boardColumnOf = (row) => {
  if (isServingNotice(row)) return "Serving Notice";
  if (isWorking(row)) return "Active";
  if (isOnboarding(row)) return row.employmentStatus;
  return INACTIVE_STATUSES.includes(row.employmentStatus) ? "InActive" : null;
};
const boardCard = {
  title: (row) => row.employeeName,
  subtitle: (row) => [row.employeeId, row.designation].filter(Boolean).join(" · "),
  meta: (row) => [employmentStatusLabel(row), isResignationPending(row) ? "Resignation awaiting HR" : "", row.dateOfJoining ? `Joined ${String(row.dateOfJoining).slice(0, 10)}` : ""].filter(Boolean).join(" · "),
};

/** Whether a row belongs on a tab, however the tab asks the question. `payslipNeeds` - see Incomplete Profiles. */
// What the Info panel and the record view show: the row, its Employment Status read as the table
// reads it - "Active (Serving Notice)" while they serve notice.
const shownRecord = (row) => (row && row.type !== "invite" ? { ...row, employmentStatus: employmentStatusLabel(row) } : row);
const matchesTab = (tab, row, payslipNeeds) => (tab.filter ? tab.filter(row, payslipNeeds) : tab.statuses.includes(row.employmentStatus));

/**
 * The repository's own ⋮.
 *
 * The invite history, and the import. The module's option lists are deliberately not here: those
 * live in the application's Settings under Table Settings, and a second doorway to them would be a
 * second way into one screen. The referral amount was here too until it moved to the register it
 * governs — HRM → Employee Referral sets it from its own header, where the reader can see what the
 * figure produced.
 */
/*
 * The repository's one ⋮, at the end of the header.
 *
 * `onImport` is optional: it is offered only to a reader who may actually do it, and a menu that
 * listed an entry it would then refuse is worse than one that never showed it. Import lives here rather than in a ⋮ of its own beside the buttons - a header
 * carrying two identical ⋮ triggers gives the reader nothing to choose between, which is the same
 * conclusion Accounts came to.
 */
/*
 * The qualification and experience lists folded to one readable line each.
 *
 * The table and the info panel both show a record as values, and neither can draw a list of rows —
 * so rather than dropping the two from both, each row is written out the way somebody would say it
 * and the rows joined. The form remains where they are actually read and edited.
 */
const joinParts = (parts) => parts.filter((part) => String(part ?? "").trim()).join(" ");

function summariseQualifications(qualifications) {
  return (qualifications || [])
    .map((qualification) => joinParts([
      qualification.degree,
      qualification.branch && `(${qualification.branch})`,
      qualification.college && `— ${qualification.college}`,
      qualification.passedOutYear && `, ${qualification.passedOutYear}`,
    ]).replace(" ,", ","))
    .filter(Boolean)
    .join("; ");
}

function summariseExperience(experiences) {
  return (experiences || [])
    .map((experience) => joinParts([
      experience.role && `${experience.role} at`,
      experience.companyName,
      experience.companyLocation && `(${experience.companyLocation})`,
      experience.years && `— ${experience.years} yr`,
    ]))
    .filter(Boolean)
    .join("; ");
}

function RepositoryMenu({ onViewInvites, onImport, onViewOffboarding }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - 152, window.innerWidth - 160)) });
  }, []);

  useEffect(() => {
    const close = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const itemClassName = "block w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50";
  return <div className="relative"><IconButton ref={triggerRef} onClick={() => { if (!open) updatePosition(); setOpen((current) => !current); }} label="Employee repository options">⋮</IconButton>{open && position && createPortal(<div ref={menuRef} className="themed-surface fixed z-[60] w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg" style={position}><button type="button" onClick={() => { setOpen(false); onViewInvites(); }} className={itemClassName}>View All Invites</button>{/* The other end of the employment, in the same menu: the register of resignation forms, which raises a new one too. */}<button type="button" onClick={() => { setOpen(false); onViewOffboarding(); }} className={itemClassName}>HR Offboarding</button>{onImport && <button type="button" onClick={() => { setOpen(false); onImport(); }} className={itemClassName}>Import</button>}</div>, document.body)}</div>;
}

export default function EmployeeVerificationPage() {
  // HRM / Employee Management. Adding a person, inviting one and the invite history's settings all
  // write; reading the repository does not.
  const { canWrite } = useRouteAccess();
  const [importOpen, setImportOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [invites, setInvites] = useState([]);
  // The submission about to be sent back, held while the confirmation is up - sending back emails
  // the candidate and reopens their form, so it is asked before it is done.
  const [sendBackTarget, setSendBackTarget] = useState(null);
  const [sendingBack, setSendingBack] = useState(false);
  // Opens on All: this is the repository of everyone the studio has taken on, and arriving on a tab
  // that hid the onboarding and departed rows made the count read as the whole of it. The other tabs
  // are still one click away for the narrower question.
  const [activeTab, setActiveTab] = useStickyTab("employee-repository", "All", barTabs.map((tab) => tab.label));
  // Which kind of pending work the Pending tab shows, remembered like the tab itself.
  const [pendingKind, setPendingKind] = useStickyTab("employee-repository-pending", ALL_PENDING, [ALL_PENDING, ...PENDING_KIND_LABELS]);
  /*
   * What Payslip Info has to hold, for Incomplete Profiles: the payslip's own items Edit Payslip lists
   * and has on, the details added there, and whether the payslip carries the PF ones. Read once; a
   * refusal leaves the tab empty rather than the page broken.
   */
  const [payslipNeeds, setPayslipNeeds] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([getBuiltInPayslipItems(), getPayslipFields({ active: true }), getPayslipDetailsSetting()])
      .then(([builtIns, fields, setting]) => {
        if (!live) return;
        setPayslipNeeds({
          listed: new Set((builtIns?.data || []).filter((item) => item.shown && !item.deleted).map((item) => item.label)),
          fields: fields?.data || [],
          withPf: setting?.data?.details !== "PERSONAL",
        });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const [loading, setLoading] = useState(true);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [freezeCount, setFreezeCount] = useState(3);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [formMode, setFormMode] = useState("add");
  // Set only by "Start Review", so the panel knows to open the Add Review dialog on its own rather
  // than waiting on the reader to find Reviews and press Add Review — see `openStartReview`.
  const [startReviewOnOpen, setStartReviewOnOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionEmployee, setActionEmployee] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Its own pair rather than sharing the delete dialog's: both confirmations can be reached from the
  // same menu, and one `actionEmployee` would make the row being deleted and the row being brought
  // back the same piece of state.
  const [reactivatingEmployee, setReactivatingEmployee] = useState(null);
  // The certificate being generated - `{ employee, kind }` - while its dialog is open.
  const [certificateTarget, setCertificateTarget] = useState(null);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [infoEmployee, setInfoEmployee] = useState(null);
  // Double-click reads the row in full. Editing, reviewing and offboarding are the ⋮ menu's own
  // entries, which is also where the rules about which of them a row is allowed already live.
  const [viewingRow, setViewingRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteDialogMode, setInviteDialogMode] = useState("create");
  /*
   * The resignation forms dialog, and which screen it opens on: "create" from a row's Resignation
   * Form, "list" from the header menu's HR Offboarding. The header menu is one this page
   * draws only for a writer - the same gate the onboarding invite sits behind - and `canWrite`
   * goes to the dialog as well, so a deep-linked or re-opened list still decides its own actions.
   */
  const [offboarding, setOffboarding] = useState("");
  // The employee a row's Offboarding Form was pressed on, chosen in the form before it opens.
  const [offboardingEmployee, setOffboardingEmployee] = useState(null);
  // Stable, so the table's memoised columns are not rebuilt on every render of this page.
  const sendOffboardingForm = useCallback((employee) => { setOffboardingEmployee(employee); setOffboarding("create"); }, []);
  // A row whose resignation is in: the Offboarding Forms register, where HR reads and decides it.
  // Straight to that employee's Review, from their HR Offboarding Pending row.
  const reviewResignation = useCallback((employee) => { setOffboardingEmployee(employee); setOffboarding("review"); }, []);
  /*
   * Handing a leaver's work on, from their InActive row: `{ employee, pending }` once what they hold
   * has been read. Nothing is reassigned while somebody serves notice - the work is still theirs to
   * finish - so this is where it happens, and `HandOverDialog` is the same pop-up the immediate
   * offboardings ask through.
   */
  const [handOverTarget, setHandOverTarget] = useState(null);
  const [handingOver, setHandingOver] = useState(false);
  const [handOverError, setHandOverError] = useState("");
  // The invite the dialog was opened to correct, when it was opened from a row's Edit Invite.
  const [editingInviteRow, setEditingInviteRow] = useState(null);
  // The Login Credentials page of the same panel opens the moment Add's first Save or Review's
  // Approve & Next hands one of these back - EmployeeFormPanel moves itself on to it from here.
  const [savedForCredentials, setSavedForCredentials] = useState(null);
  // The account just created, shown for hand-over until it is dismissed. See `finishOnboarding`.
  const [createdCredentials, setCreatedCredentials] = useState(null);

  const [separatingEmployee, setSeparatingEmployee] = useState(null);

  const loadAllEmployees = useCallback(async () => {
    const firstPage = await getEmployees();
    const totalPages = Math.max(1, Number(firstPage?.meta?.totalPages) || 1);
    if (totalPages === 1) return firstPage?.data || [];
    const remainingPages = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => getEmployees({ page: index + 2 })));
    return [firstPage?.data || [], ...remainingPages.map((result) => result?.data || [])].flat();
  }, []);

  const loadEmployees = useCallback(async () => {
    setLoading(true);

    try {
      const [employeeRows, inviteResult] = await Promise.all([
        loadAllEmployees(),
        getOnboardingInvites(),
      ]);
      setEmployees(employeeRows);
      setInvites(inviteResult.data || []);
      setLastUpdated(new Date());
    } catch (requestError) {
      showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to load User Management data.");
    } finally {
      setLoading(false);
    }
  }, [loadAllEmployees, showError]);

  // Import, offered in the header's ⋮ and in the table's, defined once. Employee IDs are minted from
  // the studio's own counter inside the create transaction, so a file cannot bring one.
  /** Reads what they still hold, then asks who takes it. */
  async function openHandOver(employee) {
    try {
      const pending = (await getPendingWork(employee.id))?.data;
      if (!pending?.total) { showSuccess(`${employee.employeeName} has no pending work left on their name.`); return; }
      setHandOverError("");
      setHandOverTarget({ employee, pending });
    } catch (error) {
      showError(error?.data?.message || error?.message || "Unable to read this employee's pending work.");
    }
  }

  async function confirmHandOver(toEmployeeId) {
    setHandingOver(true);
    setHandOverError("");
    try {
      await handOverPendingWork(handOverTarget.employee.id, { toEmployeeId: Number(toEmployeeId) });
      setHandOverTarget(null);
      showSuccess(`${handOverTarget.employee.employeeName}'s pending work was reassigned.`);
      await loadEmployees();
    } catch (error) {
      setHandOverError(error?.data?.message || error?.message || "Unable to hand this work over.");
    } finally {
      setHandingOver(false);
    }
  }

  const employeeImportConfig = canWrite ? {
    prefix: "/api/hrm/employees",
    columns: EMPLOYEE_IMPORT_COLUMNS,
    templateName: "employee-import-template",
    title: "Import Employees",
    onImported: () => loadEmployees(),
  } : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEmployees();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEmployees]);

  useEffect(() => {
    window.__dbsEmployeeFreezeCount = freezeCount;
    const handleFreezeColumns = (event) => setFreezeCount(Number(event.detail));
    window.addEventListener("dbs:employee-table-freeze", handleFreezeColumns);
    return () => window.removeEventListener("dbs:employee-table-freeze", handleFreezeColumns);
  }, [freezeCount]);

  const repositoryRows = useMemo(() => {
    // The two repeating lists folded to one line each, because the table and the info panel show
    // values and neither can render a list of rows. The form is where they are actually read.
    const employeeRows = employees.map((employee) => ({
      ...employee,
      type: "employee",
      qualificationSummary: summariseQualifications(employee.qualifications),
      experienceSummary: summariseExperience(employee.experiences),
    }));
    const inviteRows = invites.filter((invite) => (invite.status === "Created" || invite.status === "Verified") && !invite.employeeId).map((invite) => ({
      id: `invite:${invite.id}`,
      inviteId: invite.id,
      type: "invite",
      employeeId: null,
      employeeName: invite.candidateName,
      employmentStatus: "Employee Submission Pending",
      contactNumber: invite.candidatePhone,
      emailId: invite.candidateEmail,
      designation: invite.intendedDesignation,
      inviteCreatedAt: invite.createdAt,
      inviteExpiresAt: invite.expiresAt,
      inviteStatus: invite.status,
      candidateSubmission: "Pending",
      // The server rebuilds the link from the invite's stored short code on every read, so
      // Copy Link works on any visit; only pre-short-code invites carry null here, by design.
      onboardingUrl: invite.onboardingUrl,
      createdAt: invite.createdAt,
    }));
    return [...employeeRows, ...inviteRows].sort((first, second) => new Date(second.createdAt || second.inviteCreatedAt).getTime() - new Date(first.createdAt || first.inviteCreatedAt).getTime());
  }, [employees, invites]);

  // Falls back to the same tab it opens on, so a label that no longer exists lands on All rather
  // than on a filter nobody chose.
  const [layout, setLayout] = useTableBoardLayout("employee-repository");
  const onBoard = layout === "board";
  const selectedTab = barTabs.find((tab) => tab.label === activeTab) || barTabs[0];
  const onPending = selectedTab.label === "Pending";
  // Which column a card sits in: its pending kind on Pending (the one picked, where one is), else its status.
  const boardStatusOf = useCallback((row) => {
    if (!onPending) return boardColumnOf(row);
    if (pendingKind !== ALL_PENDING) return pendingKind;
    return PENDING_KINDS.find((kind) => matchesTab(kind, row, payslipNeeds))?.label ?? null;
  }, [onPending, pendingKind, payslipNeeds]);
  const filteredRows = useMemo(() => {
    if (!selectedTab.statuses && !selectedTab.filter) return repositoryRows;
    // Inside Pending, one kind of it - or all of them.
    const kind = onPending && pendingKind !== ALL_PENDING ? PENDING_KINDS.find((tab) => tab.label === pendingKind) : null;
    return repositoryRows.filter((row) => matchesTab(kind || selectedTab, row, payslipNeeds));
  }, [repositoryRows, selectedTab, payslipNeeds, onPending, pendingKind]);
  // On the Board a status tab shows its own column - with any other a row of that tab sits in (Active
  // holds whoever is serving notice too, so their column comes with it); All and the overlays show
  // every column. Pending shows its kinds instead - all four, or the one picked on the side.
  const shownBoardColumns = useMemo(() => {
    if (onPending) return pendingKind === ALL_PENDING ? PENDING_BOARD_COLUMNS : PENDING_BOARD_COLUMNS.filter((column) => column.value === pendingKind);
    if (!boardColumns.some((column) => column.value === selectedTab.label)) return boardColumns;
    const held = new Set(filteredRows.map(boardColumnOf));
    return boardColumns.filter((column) => column.value === selectedTab.label || held.has(column.value));
  }, [filteredRows, onPending, pendingKind, selectedTab.label]);
  const tabCounts = useMemo(() => Object.fromEntries(tabs.map((tab) => [
    tab.label,
    tab.statuses || tab.filter ? repositoryRows.filter((row) => matchesTab(tab, row, payslipNeeds)).length : repositoryRows.length,
  ])), [repositoryRows, payslipNeeds]);
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * Deleting an employee is an archive with conditions on it, and the server applies every one per
   * row: somebody outside this reader's scope is missed, somebody still holding or managing an
   * asset is refused and named, and everybody archived has their login closed in the same
   * transaction. A selection over a whole tab therefore loses exactly the people it may, and leaves
   * the rest ticked with the reason.
   */
  const bulk = useTableSelection({
    prefix: "/api/hrm/employees",
    rows: filteredRows,
    canSelectRow: isEmployeeRow,
    noun: "employee",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => loadEmployees(),
  });

  /*
   * Dropping a card runs the row's own ⋮ entry for that move, and only where the ⋮ offers it:
   * Move to Active / Withdraw Notice and Review (which ends Active once credentials go out) onto
   * Active, Send Back onto Employee Submission Pending, and Start Offboarding onto Serving Notice or
   * InActive - whichever the offboarding's own dates then decide. Each opens the dialog or panel the
   * menu opens; nothing is written by the drop itself.
   */
  const canDropEmployeeAt = useCallback((row, to) => {
    if (!canWrite) return false;
    const invite = row.type === "invite";
    const offboarded = ["Relieved", "Absconded", "Fired"].includes(row.employmentStatus) || isServingNotice(row);
    if (to === "Active") return !invite && ((!isWorking(row) && !isOnboarding(row)) || isServingNotice(row) || row.employmentStatus === "HR Onboarding Pending");
    if (to === "Employee Submission Pending") return !invite && row.employmentStatus === "HR Onboarding Pending" && Boolean(row.hasOnboardingSubmission);
    if (to === "Serving Notice" || to === "InActive") return !offboarded;
    return false;
  }, [canWrite]);
  const dropEmployee = useCallback((row, to) => {
    if (to === "Active") return void (row.employmentStatus === "HR Onboarding Pending" ? openReview(row) : setReactivatingEmployee(row));
    if (to === "Employee Submission Pending") return void setSendBackTarget(row);
    return void setSeparatingEmployee(row);
  // openReview only sets state, so the first render's copy is as good as any later one.
  }, []);

  function selectTab(label) {
    setActiveTab(label);
  }

  function openNew() {
    setSelectedEmployee(null);
    setFormMode("add");
    setFormError("");
    setSavedForCredentials(null);
    setFormOpen(true);
  }

  function openEdit(employee) {
    setSelectedEmployee(employee);
    setFormMode("edit");
    setFormError("");
    setSavedForCredentials(null);
    setFormOpen(true);
  }

  function openReview(employee) {
    setSelectedEmployee(employee);
    setFormMode("review");
    setFormError("");
    setSavedForCredentials(null);
    setFormOpen(true);
  }

  /*
   * "Start Review", from the ⋮ menu on a row whose review is overdue (Pending → Review Pending).
   *
   * Opens the same Edit panel Edit does, with one difference: the panel opens the Add Review dialog
   * on its own, prefilled with the overdue date, instead of leaving the reader to scroll to Reviews
   * and press Add Review themselves — the row menu already told it what it was asked for.
   */
  function openStartReview(employee) {
    setSelectedEmployee(employee);
    setFormMode("edit");
    setFormError("");
    setSavedForCredentials(null);
    setStartReviewOnOpen(true);
    setFormOpen(true);
  }

  // "Add Review", from the ⋮ menu on any employee row: the same, whether or not a review is due.
  function openAddReview(employee) {
    setSelectedEmployee(employee);
    setFormMode("edit");
    setFormError("");
    setSavedForCredentials(null);
    setStartReviewOnOpen("add");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setSavedForCredentials(null);
    setStartReviewOnOpen(false);
  }

  /*
   * The end of onboarding: the login exists, the email has gone, and the person is Active.
   *
   * The panel closes here rather than staying open on a page whose only remaining control is
   * Close. There is nothing left to do on it — every field is spent, the employee has moved to the
   * Active tab behind it, and leaving it up made a finished job look unfinished.
   *
   * What that page said is not lost, it is said in the notice instead. An account created with no
   * roles can sign in and do nothing, which is worth knowing and would otherwise have gone with the
   * page it was written on. A failed credential email cannot reach here at all — the server deletes
   * the account and answers with an error, which `useCredentialForm` reports without calling this.
   */
  async function finishOnboarding(result, temporaryPassword) {
    const roles = result?.user?.roles || [];
    /*
     * Three things worth saying, and only one of them at a time.
     *
     * A refused email no longer undoes the account — the details are on screen with a copy of them,
     * and the person is Active. So it is not an error to report, it is a fact about the message: the
     * login exists and has to be handed over by hand. It leads, because it is the one that asks
     * something of whoever is reading.
     */
    if (result?.emailSent === false) {
      showError("Login credentials could not be sent. The account is created — copy the details and pass them on.");
    } else {
      showSuccess(roles.length
        ? (result?.message || "Login credentials created.")
        : "Login credentials created, but no roles were given — this account can sign in and nothing else until a role is added from Administration.");
    }
    /*
     * What was just made, held here rather than in the panel — the panel closes on the next line,
     * and this has to outlive it.
     *
     * It is the one moment the studio holds all three details together: the server never sends a
     * password back, so once this is dismissed the temporary one is not readable anywhere. That
     * matters most exactly when the email did not arrive, which is not rare — it is refused
     * outright whenever the studio's mail account has spent its daily quota.
     */
    setCreatedCredentials({
      // The record the login was made for, so the dialog can offer to send it on WhatsApp - the
      // server reads that employee's own number off it rather than taking one from here.
      employeeId: selectedEmployee?.id ?? savedForCredentials?.id ?? null,
      employeeName: result?.user?.name || selectedEmployee?.employeeName || savedForCredentials?.employeeName,
      username: result?.user?.username,
      loginEmail: result?.user?.email,
      temporaryPassword,
      sentTo: result?.sentTo,
      emailSent: result?.emailSent !== false,
      // Why it did not go, in the server's own words — "reached its sending limit for today" is
      // something to act on, where the dialog's own fallback is only "it could not be sent".
      warning: result?.warning,
    });
    setActiveTab("Active");
    closeForm();
    await loadEmployees();
  }

  /**
   * The Login Credentials page of an Edit, saved.
   *
   * Its own handler rather than `finishOnboarding`: nothing was created, no email was sent, and
   * nobody has just been taken on — so the message says what happened and the Active tab is left
   * where the reader had it. The list is still re-read, because roles and cover are shown on it.
   */
  async function finishCredentialUpdate() {
    // One press, one notice. `saveEmployeeDetails` stays silent so this speaks for both halves.
    showSuccess("Changes saved.");
    closeForm();
    await loadEmployees();
  }

  /**
   * The record written without closing the panel, for the press that saves both pages at once.
   *
   * Save Changes on Login Credentials writes the record first and the account second, so this must
   * not close or move anybody: the credential save that follows is what finishes the press, and a
   * panel closed here would take the half still to be written with it. Answers whether it saved,
   * because the caller stops on a refusal rather than carrying on to the account.
   *
   * Deliberately quiet on success too. One press is one thing to the person making it, and two
   * notices for it — "Employee updated", then "Login credentials updated" — read as two saves and
   * invite the question of which one failed if either had.
   */
  async function saveEmployeeDetails(payload, validationError) {
    if (!payload) {
      setFormError(validationError);
      return false;
    }
    setSaving(true);
    setFormError("");
    try {
      await updateEmployee(selectedEmployee.id, payload);
      return true;
    } catch (requestError) {
      setFormError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : describeValidationError(requestError, "Unable to save employee."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveEmployee(payload, validationError) {
    if (!payload) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      /*
       * Once Save & Next has already run once, `selectedEmployee` is still null - Add never gets
       * a row of its own to remember - but `savedForCredentials` now names the row it created.
       * Reading either is what stops going back to Review Employee Details and saving a further
       * correction from calling create a second time and leaving two employees behind for one Add.
       */
      const existingId = selectedEmployee?.id || savedForCredentials?.id;
      const result = existingId
        ? await updateEmployee(existingId, payload)
        : await createEmployee(payload);
      showSuccess(existingId ? "Employee updated successfully." : "Employee added successfully.");
      /*
       * Save and Next: a freshly added employee moves the panel on to its own Login Credentials
       * page rather than closing - adding somebody and then hunting for the row to give them a
       * login was two jobs where the second follows from the first, and HR already reviewed every
       * field on the way in, so there is nothing a separate Review step would catch that typing
       * the form itself did not. A later correction from the same Add - back on Review Employee
       * Details, Save & Next pressed again - refreshes the same page rather than leaving it on
       * what was true before the correction.
       *
       * Only for Add: an edit, and a plain Update while reviewing rather than Approve & Next, is a
       * correction rather than a claim that onboarding just finished, so both keep closing the way
       * they always have. Gated on the same statuses the server will actually create a login for -
       * Active or HR Onboarding Pending, the default for this form - so the page is never one
       * Create Login Credentials can only refuse.
       */
      if (formMode === "add" && ["Active", "HR Onboarding Pending"].includes(result?.data?.employmentStatus)) {
        setSavedForCredentials(result.data);
      } else {
        closeForm();
      }
      await loadEmployees();
    } catch (requestError) {
      setFormError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : describeValidationError(requestError, "Unable to save employee."));
    } finally {
      setSaving(false);
    }
  }

  async function approveEmployee(payload, validationError) {
    if (!payload) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      /*
       * Approval saves the reviewed details but does not yet make the person Active: onboarding
       * completes only when their login credentials are created and emailed, which the server
       * marks Active on its own. Until then the row stays on HR Onboarding Pending, and reopening
       * Review simply lands back on this same Login Credentials page.
       */
      const result = await updateEmployee(selectedEmployee.id, { ...payload, employmentStatus: "HR Onboarding Pending" });
      setSavedForCredentials(result.data || { ...selectedEmployee, ...payload });
      showSuccess("Details approved. Create and send login credentials to complete onboarding.");
      await loadEmployees();
    } catch (requestError) {
      setFormError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to approve employee.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Bringing somebody back from the InActive tab.
   *
   * The endpoint does the whole of it in one transaction - removes the offboarding, restores the
   * status they held before it, reopens their login - so there is nothing to sequence here. The
   * info panel is closed on the row being changed for the same reason the delete does it: what it
   * is showing is the record as it was a moment ago, and the status on it is exactly what changed.
   */
  async function reactivateEmployee(reason) {
    if (!reactivatingEmployee) return;

    setReactivateLoading(true);
    try {
      const result = await reactivateEmployeeRequest(reactivatingEmployee.id, reason);
      if (infoEmployee?.id === reactivatingEmployee.id) setInfoEmployee(null);
      const withdrawn = isServingNotice(reactivatingEmployee);
      setReactivatingEmployee(null);
      // A rejoin reopens the login on a new generated password. Shown for copying when the server
      // handed it back (the caller holds User Management); otherwise it went by email alone.
      const credentials = result?.credentials;
      if (credentials?.temporaryPassword) {
        setCreatedCredentials({ ...credentials, employeeId: reactivatingEmployee.id, employeeName: reactivatingEmployee.employeeName, title: "Rejoined - new login password" });
      } else if (credentials) {
        if (credentials.emailSent) showSuccess(`Employee moved back to Active. A new password was emailed to ${credentials.sentTo}.`);
        else showError(`Employee moved back to Active, but ${credentials.warning || "the new password could not be emailed."}`);
      } else {
        showSuccess(withdrawn ? `${reactivatingEmployee.employeeName}'s notice was withdrawn.` : "Employee moved back to Active.");
      }
      await loadEmployees();
    } catch (requestError) {
      showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to move this employee back to Active.");
    } finally {
      setReactivateLoading(false);
    }
  }

  async function deleteEmployee() {
    if (!actionEmployee) return;

    setActionLoading(true);
    try {
      await deleteEmployeeRequest(actionEmployee.id);
      if (infoEmployee?.id === actionEmployee.id) {
        setInfoEmployee(null);
      }
      setActionEmployee(null);
      showSuccess("Employee deleted successfully.");
      await loadEmployees();
    } catch (requestError) {
      showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to delete employee.");
    } finally {
      setActionLoading(false);
    }
  }

  function handleInviteCreated(invite) {
    setInvites((current) => [invite, ...current.filter((currentInvite) => currentInvite.id !== invite.id)]);
  }

  async function copyInviteLink(invite) {
    if (!invite?.onboardingUrl) return;
    try {
      await navigator.clipboard.writeText(invite.onboardingUrl);
      showSuccess("Onboarding link copied.");
    } catch {
      showError("Unable to copy the onboarding link.");
    }
  }

  function handleInviteCancelled(invite) {
    setInvites((current) => current.map((currentInvite) => currentInvite.id === invite.id ? invite : currentInvite));
    if (infoEmployee?.inviteId === invite.id) setInfoEmployee(null);
  }

  async function cancelInviteFromTable(invite) {
    try {
      const result = await cancelOnboardingInvite(invite.inviteId);
      handleInviteCancelled(result.invite);
      showSuccess("Onboarding invite cancelled.");
    } catch (requestError) {
      showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to cancel onboarding invite.");
    }
  }

  async function sendBack() {
    if (!sendBackTarget) return;
    setSendingBack(true);
    try {
      await sendBackOnboarding(sendBackTarget.id);
      setSendBackTarget(null);
      showSuccess("Sent back. The candidate has been emailed their onboarding link to edit and resubmit.");
      /*
       * The submission is the candidate's again, so there is nothing left to review: the panel
       * closes whether it was the panel or the row menu that asked. `closeForm` on a panel that was
       * never open costs nothing.
       *
       * The list is re-read with it. The row's status changes when a submission goes back, and
       * before this the screen behind kept showing what was true a moment ago — invisible while
       * this was only ever pressed from that row's own menu, and plain the moment the panel closes
       * onto it.
       */
      closeForm();
      await loadEmployees();
    } catch (requestError) {
      /*
       * A 502 means the submission *was* reopened and only the email failed - the studio's mail
       * quota is spent, the candidate's inbox is full. The send-back happened, so this closes and
       * finishes exactly as a success does, and says in a notice that the message did not go.
       *
       * It used to hold the dialog open on the strength of the message being the only way left to
       * tell the candidate. That is no longer true: the message is on the dialog *before* Send Back
       * is pressed, with its own Copy, so whoever is sending it by hand already has it. Keeping the
       * dialog up afterwards asked them to read the same wording a second time and dismiss it,
       * over a submission that had already moved on.
       */
      if (requestError.status === 502) {
        showError(requestError.data?.warning
          ? `Sent back, but the email could not be sent: ${requestError.data.warning}. Send the message to them yourself.`
          : "Sent back, but the email could not be sent. Send the message to them yourself.");
        setSendBackTarget(null);
        closeForm();
        await loadEmployees();
      } else {
        showError(requestError.message || "Unable to send this onboarding back.");
        setSendBackTarget(null);
      }
    } finally {
      setSendingBack(false);
    }
  }

  function openInfoPanel(employee) {
    setInfoEmployee(employee);
    setInfoPanelState("expanded");
  }

  function toggleInfoPanel() {
    setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded");
  }

  function openInviteDialog(mode = "create") {
    setInviteDialogMode(mode);
    setEditingInviteRow(null);
    setInviteDialogOpen(true);
  }

  /**
   * Correcting the details an invite was sent on, from the repository row rather than from the
   * list inside the dialog.
   *
   * The row already holds every answer the form asks for - it is built from the invite - so this
   * hands them straight over rather than fetching the invite again to read back what is on screen.
   */
  function editInviteRow(row) {
    setEditingInviteRow({
      id: row.inviteId,
      candidateName: row.employeeName,
      candidateEmail: row.emailId,
      candidatePhone: row.contactNumber,
      intendedDesignation: row.designation,
      expiresAt: row.inviteExpiresAt,
    });
    setInviteDialogMode("create");
    setInviteDialogOpen(true);
  }

  // What a row's ⋮ may do - handed to the table, and to the Board's cards through the same items.
  const rowMenu = { onEdit: openEdit, onReview: openReview, onStartReview: openStartReview, onAddReview: openAddReview, onSendOffboardingForm: canWrite ? sendOffboardingForm : undefined, onReviewResignation: reviewResignation, onDelete: setActionEmployee, onSeparate: setSeparatingEmployee, onReactivate: setReactivatingEmployee, onHandOverWork: canWrite ? openHandOver : undefined, onGenerateCertificate: (employee, kind) => setCertificateTarget({ employee, kind }), onCancelInvite: cancelInviteFromTable, onCopyInviteLink: copyInviteLink, onEditInvite: editInviteRow, onSendBack: setSendBackTarget, canWrite };

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="User Management"
        // The register on the left, and the control that leaves it on the right.
        titleAccessory={<AdministrationSwitch current="/employees" />}
        tabs={barTabs.map((tab) => ({ id: tab.label, label: tab.label, count: tabCounts[tab.label] || 0 }))}
        tabValue={selectedTab.label}
        onTabChange={selectTab}
        tabsAriaLabel="Employee repository filters"
        // The ⋮ in the header's own slot, so the row ends Nebula, then ⋮ - as every module header does.
        menu={canWrite ? <RepositoryMenu
          onViewInvites={() => openInviteDialog("list")}
          onViewOffboarding={() => { setOffboardingEmployee(null); setOffboarding("list"); }}
          onImport={employeeImportConfig ? () => setImportOpen(true) : undefined}
        /> : undefined}
        /*
         * Two buttons, because they are two decisions HR has already made before reaching this
         * screen: either the person's details are in hand and are typed in, or they are not and
         * the candidate is sent a link to fill in themselves. A chooser asking which stood between
         * the button and the form without telling anybody anything they did not already know.
         *
         * Both still end on the same Login Credentials page - that is where the two flows meet,
         * and it is reached from Add's Save & Next and from Review's Approve & Next alike.
         */
        /*
         * On a phone the two buttons share one full-width row beside Nebula and the ⋮, rather than
         * wrapping into an uneven second line - and the invite reads "Invite" there, the full name
         * being wider than half a phone. From `sm` up both are as they were.
         */
        stretchActionsOnPhone
        actions={<>
          <TableBoardSwitch value={layout} onChange={setLayout} />
          {canWrite && <>
          {/* "Add" on a phone, as the invite reads "Invite": with the Table / Board switch beside
              them the full names no longer share one phone-width row. */}
          <Button type="button" onClick={openNew} className="max-sm:flex-1">
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add Employee</span>
          </Button>
          {/* No `aria-label`: the header's stylesheet squares any button carrying one into a 36px
              icon button. The words themselves name it - "Invite" on a phone. */}
          <Button type="button" variant="primary" onClick={() => openInviteDialog("create")} className="max-sm:flex-1">
            <span className="sm:hidden">Invite</span>
            <span className="hidden sm:inline">Create Onboarding Invite</span>
          </Button>
          </>}
        </>}
      />

      {importOpen && employeeImportConfig && <ImportDialog
        onClose={() => setImportOpen(false)}
        title={employeeImportConfig.title}
        columns={employeeImportConfig.columns}
        templateName={employeeImportConfig.templateName}
        onImportChunk={(chunk) => importTableRows(employeeImportConfig.prefix, chunk).then((answer) => answer?.data || answer)}
        onImported={employeeImportConfig.onImported}
      />}

      <FloatingNotice notice={notice} onClose={clearNotice} />

      {onBoard ? <div className={`flex min-h-0 min-w-0 flex-1 ${onPending ? "flex-col md:flex-row" : ""}`}>
        {/* Pending on the Board too: each kind of it down the side, the cards narrowed to the one chosen. */}
        {onPending && <SideFilterList
          ariaLabel="Kinds of pending work"
          value={pendingKind}
          onChange={setPendingKind}
          items={[ALL_PENDING, ...PENDING_KIND_LABELS].map((label) => ({ id: label, label, count: tabCounts[label === ALL_PENDING ? "Pending" : label] || 0 }))}
        />}
        <KanbanBoard
        rows={filteredRows}
        columns={shownBoardColumns}
        statusOf={boardStatusOf}
        // Under a column (either board): invite links expiring within 2 days, forms waiting on HR over 7
        // days, Active reviews due this month, or who on notice leaves next - nothing elsewhere.
        // Each counted card carries a tag saying which rule picked it.
        columnAmount={boardColumnFigure}
        cardFlag={boardCardFlag}
        // The trend counts people by when they joined (an invite, by when it was sent).
        dateOf={joinedOn}
        card={boardCard}
        onOpen={setViewingRow}
        // The card's ⋮ is the row's ⋮: the table's own item list, with the same handlers.
        cardActions={(row) => employeeRowActionItems(row, { ...rowMenu, onView: setViewingRow })}
        // A pending kind is not something a card is moved into - it is decided on the row itself.
        canDropAt={onPending ? undefined : canDropEmployeeAt}
        onDrop={dropEmployee}
        loading={loading}
        noun="employees"
        filtered={Boolean(selectedTab.filter)}
        ariaLabel="Employee board"
      /></div> : <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30"><span>Last updated: {updatedText}</span><span>Total rows: {infiniteStats.total}</span></TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className={`flex min-h-0 min-w-0 flex-1 ${onPending ? "flex-col md:flex-row" : ""}`}>
            {/* Pending: each kind of it down the side, the table beside it showing the one chosen. */}
            {onPending && <SideFilterList
              ariaLabel="Kinds of pending work"
              value={pendingKind}
              onChange={setPendingKind}
              items={[ALL_PENDING, ...PENDING_KIND_LABELS].map((label) => ({ id: label, label, count: tabCounts[label === ALL_PENDING ? "Pending" : label] || 0 }))}
            />}
            <EmployeeTable key={onPending ? `Pending:${pendingKind}` : activeTab} employees={filteredRows} selection={bulk.selection} density={density} loading={loading} freezeCount={freezeCount} onFreezeColumnsChange={setFreezeCount} selectedEmployeeId={infoEmployee?.id} {...rowMenu} onRowClick={openInfoPanel} onRowDoubleClick={setViewingRow} onTableNotice={showNotice} onInfiniteStats={setInfiniteStats} onImported={loadEmployees} />
          </div>
          <DataTableInfoPanel title="Info" entity={shownRecord(infoEmployee)} sections={infoEmployee?.type === "invite" ? inviteInfoSections : employeeInfoSections} emptyText="Select an employee row to view details." state={infoPanelState} onToggle={toggleInfoPanel} />
        </div>
      </DataTableShell>}

      {/* The page already holds every employee, so the Reports To picker is filled from it rather
          than fetching the same list again — the same reason the Alternative pickers below are. */}
      {/* Add and Review both carry a second page of their own, Login Credentials, that Save & Next
          or Approve & Next moves the panel on to — the page already holds every employee, so the
          Alternative and Leave Approver pickers on it are filled from the same list rather than
          fetching it again. */}
      {/* The login just handed out, said in full with a copy of it — the same shape an onboarding
          invite takes when it is created. It outlives the panel deliberately: the panel closes the
          moment onboarding finishes, and this is the only place the temporary password is legible. */}
      {createdCredentials && <CredentialsCreatedDialog {...createdCredentials} onClose={() => setCreatedCredentials(null)} />}

      {formOpen && <EmployeeFormPanel employee={selectedEmployee} employees={employees} mode={formMode} onClose={closeForm} onSave={saveEmployee} onApprove={approveEmployee} onSendBack={setSendBackTarget} saving={saving} error={formError} savedForCredentials={savedForCredentials} onCredentialsCreated={finishOnboarding} onCredentialsUpdated={finishCredentialUpdate} onSaveDetails={saveEmployeeDetails} autoOpenReview={startReviewOnOpen} />}
      {/* Emp Chart is an extra tab rather than another section on the rail: the rail answers "where in
          this record", and who somebody reports to is not a field of their row — it is read from
          every other employee pointing at them. An invite has no employee row to draw a chart from,
          so it gets no tab and the panel reads exactly as it did before. */}
      {viewingRow && <RecordViewPanel title={viewingRow.employeeName || "Record"} entity={shownRecord(viewingRow)} sections={viewingRow.type === "invite" ? inviteInfoSections : employeeInfoSections} extraTabs={viewingRow.type === "invite" ? [] : [{ id: "work-history", label: "Work History", render: () => <WorkHistoryFlow employee={viewingRow} /> }, { id: "org-chart", label: "Org Chart", render: () => <EmployeeOrgChart employeeId={viewingRow.id} employeeName={viewingRow.employeeName} /> }]} sidebarAriaLabel={viewingRow.type === "invite" ? "Invite sections" : "Employee sections"} onClose={() => setViewingRow(null)} />}
      <EmployeeActionDialog employee={actionEmployee} loading={actionLoading} onCancel={() => { if (!actionLoading) setActionEmployee(null); }} onConfirm={deleteEmployee} />
      {/* Keyed by the row, so the reason typed for one employee is never carried into the next
          one's confirmation - the dialog would otherwise stay mounted between openings. */}
      <ReactivateEmployeeDialog key={reactivatingEmployee?.id || "none"} employee={reactivatingEmployee} loading={reactivateLoading} onCancel={() => { if (!reactivateLoading) setReactivatingEmployee(null); }} onConfirm={reactivateEmployee} />
      {/* Keyed by the row and the certificate, so one employee's summary of duties is never carried into the next's. */}
      {certificateTarget && <EmployeeCertificateDialog key={`${certificateTarget.employee.id}-${certificateTarget.kind}`} employee={certificateTarget.employee} kind={certificateTarget.kind} onClose={() => setCertificateTarget(null)} onNotice={showSuccess} />}
      {/*
       * Sending back emails the candidate and reopens their form, so it is asked before it is done -
       * and asked alongside the message it is about, which is copyable before anything is sent.
       *
       * Rendered by the page rather than by the review panel, because the panel closes as part of
       * answering it and so cannot be the thing that asks. That is also why the dialog names its own
       * layer: at the default one it sat at z-100 underneath the panel's z-110, so pressing Send
       * Back inside a review dimmed the screen and showed nothing.
       */}
      {sendBackTarget && <SendBackDialog
        employee={sendBackTarget}
        sending={sendingBack}
        onCancel={() => { if (!sendingBack) setSendBackTarget(null); }}
        onConfirm={() => void sendBack()}
      />}
      {separatingEmployee && <SeparationFormPanel employee={separatingEmployee} onClose={() => setSeparatingEmployee(null)} onSaved={async (message) => { setSeparatingEmployee(null); showSuccess(message); await loadEmployees(); }} />}
      {/* Both modes of this dialog are opened from the header - Create from its own button, the
          history from the ⋮ beside it - so neither has anywhere to hand the reader back to. */}
      {/* `onInviteSent` closes the dialog and says so out here: sending the link is the last thing it
          is open for, and the snackbar has to be rendered by this page because the dialog that would
          otherwise have shown it is the thing being closed. */}
      {/*
        * What a leaver still held, moved on. Read first, so the pop-up names the work rather than
        * asking for a receiver in the abstract - and a leaver holding nothing says so instead of
        * opening a dialog with an empty list.
        */}
      {handOverTarget && <HandOverDialog
        employee={handOverTarget.employee}
        pending={handOverTarget.pending}
        saving={handingOver}
        error={handOverError}
        onClose={() => { setHandOverTarget(null); setHandOverError(""); }}
        onConfirm={confirmHandOver}
      />}

      {inviteDialogOpen && <OnboardingInviteDialog key={editingInviteRow?.id || "new"} initialMode={inviteDialogMode} initialEditInvite={editingInviteRow} onClose={() => setInviteDialogOpen(false)} onInviteCreated={handleInviteCreated} onInviteCancelled={handleInviteCancelled} onInviteSent={(message) => showSuccess(message || "Onboarding invite sent.")}
        /* The reason the send was refused, said on the page rather than inside a dialog that is
           closing. The wording arrives already shaped by the server - "Unable to send onboarding
           invite email: the studio's mail account has reached its sending limit for today" - and the
           sentence after it says what to do about it, since the message is already on the clipboard
           of anybody who copied it before pressing Send. */
        onInviteSendFailed={(reason) => showError(`${reason}. Send the message to them yourself.`)} />}

      {/*
        * Offboarding forms. A reload of the repository on every change, because approving one puts
        * somebody on Serving Notice - which is a row on this very table, under a different tab.
        */}
      {offboarding && <OffboardingInviteDialog
        mode={offboarding}
        employee={offboardingEmployee}
        canWrite={canWrite}
        onClose={() => { setOffboarding(""); setOffboardingEmployee(null); }}
        onNotice={showSuccess}
        onError={showError}
        onChanged={() => void loadEmployees()}
      />}

    </section>
  );
}
