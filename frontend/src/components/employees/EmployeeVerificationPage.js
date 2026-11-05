"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import { createPortal } from "react-dom";
import { createEmployee, deleteEmployee as deleteEmployeeRequest, getEmployees, reactivateEmployee as reactivateEmployeeRequest, sendBackOnboarding, updateEmployee } from "@/services/hrm/employees.service";
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
import EmployeeActionDialog, { ReactivateEmployeeDialog } from "./EmployeeActionDialog";
import CredentialsCreatedDialog from "./CredentialsCreatedDialog";
import SendBackDialog from "./SendBackDialog";
import EmployeeFormPanel from "./EmployeeFormPanel";
import SeparationFormPanel from "./SeparationFormPanel";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { employeeInfoSections, inviteInfoSections } from "@/constants/infoPanelConfig";
import EmployeeTable from "./EmployeeTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import OnboardingInviteDialog from "./OnboardingInviteDialog";
import EmployeeOrgChart from "./EmployeeOrgChart";
import { WORKING_STATUSES } from "@/lib/employmentStatus.mjs";

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
  // The same three every picker offers, so the tab and the dropdowns cannot disagree about who is
  // working here. See `workingEmployees`.
  { label: "Active", statuses: WORKING_STATUSES },
  { label: "Employee Submission Pending", statuses: ["Employee Submission Pending"] },
  { label: "HR Onboarding Pending", statuses: ["HR Onboarding Pending"] },
  { label: "InActive", statuses: ["Relieved", "Absconded", "Long Leave", "Fired"] },
];

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

function RepositoryMenu({ onViewInvites, onImport }) {
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
  return <div className="relative"><IconButton ref={triggerRef} onClick={() => { if (!open) updatePosition(); setOpen((current) => !current); }} label="Employee repository options">⋮</IconButton>{open && position && createPortal(<div ref={menuRef} className="themed-surface fixed z-[60] w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg" style={position}><button type="button" onClick={() => { setOpen(false); onViewInvites(); }} className={itemClassName}>View All Invites</button>{onImport && <button type="button" onClick={() => { setOpen(false); onImport(); }} className={itemClassName}>Import</button>}</div>, document.body)}</div>;
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
  const [activeTab, setActiveTab] = useStickyTab("employee-repository", "All", tabs.map((tab) => tab.label));
  const [loading, setLoading] = useState(true);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [freezeCount, setFreezeCount] = useState(3);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [formMode, setFormMode] = useState("add");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionEmployee, setActionEmployee] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Its own pair rather than sharing the delete dialog's: both confirmations can be reached from the
  // same menu, and one `actionEmployee` would make the row being deleted and the row being brought
  // back the same piece of state.
  const [reactivatingEmployee, setReactivatingEmployee] = useState(null);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [infoEmployee, setInfoEmployee] = useState(null);
  // Double-click reads the row in full. Editing, reviewing and offboarding are the ⋮ menu's own
  // entries, which is also where the rules about which of them a row is allowed already live.
  const [viewingRow, setViewingRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteDialogMode, setInviteDialogMode] = useState("create");
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
      showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to load Employee Repository data.");
    } finally {
      setLoading(false);
    }
  }, [loadAllEmployees, showError]);

  // Import, offered in the header's ⋮ and in the table's, defined once. Employee IDs are minted from
  // the studio's own counter inside the create transaction, so a file cannot bring one.
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
  const selectedTab = tabs.find((tab) => tab.label === activeTab) || tabs[0];
  const filteredRows = useMemo(() => {
    if (!selectedTab.statuses) return repositoryRows;
    return repositoryRows.filter((row) => selectedTab.statuses.includes(row.employmentStatus));
  }, [repositoryRows, selectedTab]);
  const tabCounts = useMemo(() => Object.fromEntries(tabs.map((tab) => [
    tab.label,
    tab.statuses ? repositoryRows.filter((row) => tab.statuses.includes(row.employmentStatus)).length : repositoryRows.length,
  ])), [repositoryRows]);
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

  function closeForm() {
    setFormOpen(false);
    setSavedForCredentials(null);
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
      setFormError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to save employee.");
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
      setFormError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Unable to save employee.");
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
      await reactivateEmployeeRequest(reactivatingEmployee.id, reason);
      if (infoEmployee?.id === reactivatingEmployee.id) setInfoEmployee(null);
      setReactivatingEmployee(null);
      showSuccess("Employee moved back to Active.");
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

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="Employee Repository"
        // The repository on the left, and the control that leaves it on the right.
        titleAccessory={<AdministrationSwitch current="/employees" />}
        tabs={tabs.map((tab) => ({ id: tab.label, label: tab.label, count: tabCounts[tab.label] || 0 }))}
        tabValue={activeTab}
        onTabChange={selectTab}
        tabsAriaLabel="Employee repository filters"
        /*
         * Two buttons, because they are two decisions HR has already made before reaching this
         * screen: either the person's details are in hand and are typed in, or they are not and
         * the candidate is sent a link to fill in themselves. A chooser asking which stood between
         * the button and the form without telling anybody anything they did not already know.
         *
         * Both still end on the same Login Credentials page - that is where the two flows meet,
         * and it is reached from Add's Save & Next and from Review's Approve & Next alike.
         */
        actions={!canWrite ? null : <>
          <Button type="button" onClick={openNew}>Add Employee</Button>
          <Button type="button" variant="primary" onClick={() => openInviteDialog("create")}>Create Onboarding Invite</Button>
          <RepositoryMenu onViewInvites={() => openInviteDialog("list")} onImport={employeeImportConfig ? () => setImportOpen(true) : undefined} />
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

      <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30"><span>Last updated: {updatedText}</span><span>Total rows: {infiniteStats.total}</span></TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <EmployeeTable key={activeTab} employees={filteredRows} selection={bulk.selection} density={density} loading={loading} freezeCount={freezeCount} onFreezeColumnsChange={setFreezeCount} selectedEmployeeId={infoEmployee?.id} onEdit={openEdit} onReview={openReview} onDelete={setActionEmployee} onSeparate={setSeparatingEmployee} onReactivate={setReactivatingEmployee} onCancelInvite={cancelInviteFromTable} onCopyInviteLink={copyInviteLink} onEditInvite={editInviteRow} onSendBack={setSendBackTarget} onRowClick={openInfoPanel} onRowDoubleClick={setViewingRow} onTableNotice={showNotice} onInfiniteStats={setInfiniteStats} onImported={loadEmployees} canWrite={canWrite} />
          </div>
          <DataTableInfoPanel title="Info" entity={infoEmployee} sections={infoEmployee?.type === "invite" ? inviteInfoSections : employeeInfoSections} emptyText="Select an employee row to view details." state={infoPanelState} onToggle={toggleInfoPanel} />
        </div>
      </DataTableShell>

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

      {formOpen && <EmployeeFormPanel employee={selectedEmployee} employees={employees} mode={formMode} onClose={closeForm} onSave={saveEmployee} onApprove={approveEmployee} onSendBack={setSendBackTarget} saving={saving} error={formError} savedForCredentials={savedForCredentials} onCredentialsCreated={finishOnboarding} onCredentialsUpdated={finishCredentialUpdate} onSaveDetails={saveEmployeeDetails} />}
      {/* Emp Chart is an extra tab rather than another section on the rail: the rail answers "where in
          this record", and who somebody reports to is not a field of their row — it is read from
          every other employee pointing at them. An invite has no employee row to draw a chart from,
          so it gets no tab and the panel reads exactly as it did before. */}
      {viewingRow && <RecordViewPanel title={viewingRow.employeeName || "Record"} entity={viewingRow} sections={viewingRow.type === "invite" ? inviteInfoSections : employeeInfoSections} extraTabs={viewingRow.type === "invite" ? [] : [{ id: "org-chart", label: "Org Chart", render: () => <EmployeeOrgChart employeeId={viewingRow.id} employeeName={viewingRow.employeeName} /> }]} sidebarAriaLabel={viewingRow.type === "invite" ? "Invite sections" : "Employee sections"} onClose={() => setViewingRow(null)} />}
      <EmployeeActionDialog employee={actionEmployee} loading={actionLoading} onCancel={() => { if (!actionLoading) setActionEmployee(null); }} onConfirm={deleteEmployee} />
      {/* Keyed by the row, so the reason typed for one employee is never carried into the next
          one's confirmation - the dialog would otherwise stay mounted between openings. */}
      <ReactivateEmployeeDialog key={reactivatingEmployee?.id || "none"} employee={reactivatingEmployee} loading={reactivateLoading} onCancel={() => { if (!reactivateLoading) setReactivatingEmployee(null); }} onConfirm={reactivateEmployee} />
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
      {inviteDialogOpen && <OnboardingInviteDialog key={editingInviteRow?.id || "new"} initialMode={inviteDialogMode} initialEditInvite={editingInviteRow} onClose={() => setInviteDialogOpen(false)} onInviteCreated={handleInviteCreated} onInviteCancelled={handleInviteCancelled} onInviteSent={(message) => showSuccess(message || "Onboarding invite sent.")}
        /* The reason the send was refused, said on the page rather than inside a dialog that is
           closing. The wording arrives already shaped by the server - "Unable to send onboarding
           invite email: the studio's mail account has reached its sending limit for today" - and the
           sentence after it says what to do about it, since the message is already on the clipboard
           of anybody who copied it before pressing Send. */
        onInviteSendFailed={(reason) => showError(`${reason}. Send the message to them yourself.`)} />}

    </section>
  );
}
