"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROGRESS_CHIP_CLASS, PROGRESS_COLORS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { projectSetupProblems } from "@/lib/projectSetupValidation.mjs";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { getActiveSalesEmployees } from "@/services/sales/employees.service";
import { getProjectActivity, getProjectPaymentSchedule, recordProjectStageUpdate, saveProjectPaymentSchedule } from "@/services/project-management/project-workflow.service";
import ProjectActivityTab from "./ProjectActivityTab";
import { scheduleFormRows, scheduleSavePayload, undatedPayments } from "@/lib/paymentSchedule.mjs";
import AddShootDialog from "./AddShootDialog";
import ProjectPaymentsView from "./ProjectPaymentsView";
import ProjectStageView from "./ProjectStageView";
import StageUpdateRemarkDialog from "./StageUpdateRemarkDialog";
import ProjectServiceCreationSection from "./ProjectServiceCreationSection";
import SchedulePaymentSection, { paymentScheduleDefaults, usePaymentCategories } from "./SchedulePaymentSection";
import useScheduleReceiver from "./useScheduleReceiver";
import ScheduledPaymentPanel from "@/components/accounts/ScheduledPaymentPanel";
import useProjectPlan from "./useProjectPlan";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import SharedDropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Checkbox from "@/components/shared/Checkbox";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SharedTextField from "@/components/shared/TextField";
import Tabs from "@/components/ui/Tabs";
import { verticalLabel } from "@/components/sales/whatsappGroupNameUtils";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";
import { isCompletedStatus, isInProgressStatus } from "@/lib/projectStatuses.mjs";

/*
 * The rail. The same five entries for everybody: this form plans a project, and the sale it was
 * sold at is shown at the top of it rather than edited there - see `SaleDetailsSection` below.
 */
const sections = [["sale-details", "Sale Details"], ["project-setup", "Project Setup"], ["sales-remarks", "Sales Remarks"], ["service-creation", "Service Creation"], ["schedule-payment", "Shedule Payment"]];
const crdOptions = ["Applicable", "Non Applicable"];
/*
 * What CRD Document reads as before anybody touches it.
 *
 * It is the one required answer on this form that used to open blank, and a blank one does more
 * than look unfinished: the column is what CRD Documents sorts projects by, and it reads null as
 * neither answer. A project saved without it therefore got no row on that screen — "Applicable" is
 * what puts one there with its Send Link — and could not be picked for a manual document either,
 * since Create CRD Document offers only the projects answered "Not Applicable". It fell between the
 * two and was collected from nobody.
 *
 * "Applicable" rather than the other, because the two are not equally wrong. Pre-selecting it and
 * being wrong leaves a row somebody can see and decide about; pre-selecting "Non Applicable" and
 * being wrong is silent — the document is never asked for and nothing on any screen says so.
 */
const CRD_DEFAULT = "Applicable";

function normalizeWelcomeGift(value) {
  if (value === "Non Applicable") return "Not Applicable";
  return value || "Not Applicable";
}

function normalizeCrdStatus(value) {
  if (value === "Not Applicable") return "Non Applicable";
  const map = { "Not yet received": "Not Yet Received", "Groom Side received": "Groom Side Received", "Bride Side received": "Bride side Received" };
  // A project stored with no answer opens on the default rather than on nothing, which is what
  // closes the gap described above for the records that are already in it.
  return map[value] || value || CRD_DEFAULT;
}

function crdStatusForPayload(value) {
  return value === "Non Applicable" ? "Not Applicable" : value;
}

// The product-wide progress palette: not-started bronze, in-progress blue, completed green —
// read from the one module that defines it, never restated as hexes here.
function statusChipStyle(status) {
  if (status === "Yet to Start") return progressChipStyle(PROGRESS_COLORS.notStarted);
  if (isCompletedStatus(status)) return progressChipStyle(PROGRESS_COLORS.completed);
  if (isInProgressStatus(status)) return progressChipStyle(PROGRESS_COLORS.inProgress);
  // Any other status wears amber, through the same chip so the dark themes lighten it too.
  return progressChipStyle("#B45309");
}

/**
 * The sale, stated rather than laid out as fields.
 *
 * One card of label-over-value pairs - the shape the application already states a record it is
 * acting on with, on the cash entry form and now here. It went through two wrong shapes first: a
 * one-line summary strip, which read as a footnote to the form rather than as the sale the plan
 * under it is being made against; and read-only text boxes, which look like fields somebody has
 * closed to you rather than like facts. Nothing here is a field. It is what the screen already
 * knows about the sale, and the plan below is what is being answered.
 *
 * Everything the project holds about its sale is in the one card, so there is no second place on
 * the screen saying part of it. What it converts at is the exception, and deliberately: that is
 * Shedule Payment's **Signed Quotation**, at the head of the section that schedules shares of it.
 */
function SaleDetailsSection({ project }) {
  const status = project?.projectStatus || "Yet to Start";
  const rows = [
    ["Project Status", <span key="status" className={`${PROGRESS_CHIP_CLASS} inline-flex rounded px-1.5 py-0.5 text-xs font-semibold leading-none`} style={statusChipStyle(status)}>{status}</span>],
    ["Event ID", project?.eventId],
    ["Enquiry ID", project?.enquiryId],
    ["Quotation", project?.quotationId],
    ["Client Main Number", project?.clientMainNumber],
    ["Source Branch", project?.sourceBranch],
    ["WhatsApp Group Name", project?.whatsappGroupName],
    // Stored as WED / QQ / CORP, read as the name the CRM uses. A project whose group name was
    // typed by hand has no vertical of its own; the server answers with the lead's instead.
    ["Vertical", verticalLabel(project?.vertical)],
    ["CRM Name", project?.crmName],
  ];

  return <SchemaFormSection id="sale-details" title="Sale Details">
    <RecordSummaryCard rows={rows} />
  </SchemaFormSection>;
}

const formFromProject = (project) => ({
  projectManager: project?.projectManager || "",
  projectManagerEmployeeId: project?.projectManagerEmployeeId || "",
  preProductionCoordinator: project?.preProductionCoordinator || "",
  preProductionCoordinatorEmployeeId: project?.preProductionCoordinatorEmployeeId || "",
  productionManager: project?.productionManager || "",
  productionManagerEmployeeId: project?.productionManagerEmployeeId || "",
  creativeManager: project?.creativeManager || "",
  creativeManagerEmployeeId: project?.creativeManagerEmployeeId || "",
  postProductionCoordinator: project?.postProductionCoordinator || "",
  postProductionCoordinatorEmployeeId: project?.postProductionCoordinatorEmployeeId || "",
  welcomeGift: normalizeWelcomeGift(project?.welcomeGift),
  welcomeGiftAssignee: project?.welcomeGiftAssignee || "",
  welcomeGiftEmployeeId: project?.welcomeGiftEmployeeId || "",
  shootCompletedGift: normalizeWelcomeGift(project?.shootCompletedGift),
  shootCompletedGiftAssignee: project?.shootCompletedGiftAssignee || "",
  shootCompletedGiftEmployeeId: project?.shootCompletedGiftEmployeeId || "",
  /*
   * Not a stored column, the same way the employee form's "same as the current address" is not.
   * One person usually handles both gifts, so the box is a shortcut for filling the second
   * dropdown from the first - it is derived from the two ids matching rather than remembered, so
   * it cannot end up ticked beside two different names.
   */
  giftAssigneesSame: Boolean(project?.welcomeGiftEmployeeId) && project?.welcomeGiftEmployeeId === project?.shootCompletedGiftEmployeeId,
  projectValidityMonths: project?.projectValidityMonths ?? "",
  storageNeeded: project?.storageNeeded || "No",
  crdDocumentStatus: normalizeCrdStatus(project?.crdDocumentStatus),
  salesPreProductionRemarks: project?.salesPreProductionRemarks === "NA" ? "" : project?.salesPreProductionRemarks || "",
  salesProductionRemarks: project?.salesProductionRemarks === "NA" ? "" : project?.salesProductionRemarks || "",
  salesPostProductionRemarks: project?.salesPostProductionRemarks === "NA" ? "" : project?.salesPostProductionRemarks || "",
  /*
   * What the project was signed for, held as a string because it is typed into a box.
   *
   * Kept as `""` rather than `0` where the project has none: the schedule below says "no figure has
   * been set" for one and schedules shares of zero for the other, and they are different sentences.
   */
  initialConvertedValue: project?.initialConvertedValue === null || project?.initialConvertedValue === undefined ? "" : String(project.initialConvertedValue),
});

function payloadFromForm(form) {
  // `giftAssigneesSame` is the checkbox's own state and not a fact about the project, so it never
  // leaves the form: what it did is already in the two assignee fields it copied.
  const { giftAssigneesSame, ...fields } = form;
  const signed = String(form.initialConvertedValue ?? "").trim();
  return {
    ...fields,
    crdDocumentStatus: crdStatusForPayload(form.crdDocumentStatus),
    projectValidityMonths: form.projectValidityMonths === "" ? null : Number(form.projectValidityMonths),
    /*
     * Left out entirely when the box is empty, rather than sent as null or 0.
     *
     * The server treats it as optional and ignores what is absent, which is what keeps Start Project
     * — where the field is never offered — from blanking a figure it never asked about, and what
     * stops the autosave writing a zero over it every time the form pauses mid-edit.
     */
    ...(signed === "" ? {} : { initialConvertedValue: Number(signed) }),
  };
}

function EmployeeDropdown({ label, employeeId, employeeName, employees, loading, onChange, disabled = false, required = false, error = "", helperText = "" }) {
  const options = useMemo(() => employees.map((employee) => ({ label: `${employee.employeeName}${employee.designation || employee.department ? ` - ${[employee.designation, employee.department].filter(Boolean).join(" / ")}` : ""}`, value: String(employee.id), employee, avatar: avatarOf(employee) })), [employees]);
  return <SharedDropdown mode="input" label={label} required={required} error={error} helperText={helperText} placeholder={loading ? "Loading active employees..." : employeeName ? `Existing: ${employeeName}` : "Select active employee"} value={employeeId ? String(employeeId) : ""} onChange={(value, option) => onChange(option?.employee ? { id: option.employee.id, name: option.employee.employeeName } : { id: "", name: "" })} options={options} disabled={disabled || loading} />;
}

function TextAreaField({ label, helperText, value, onChange }) {
  return <label className="block text-xs font-semibold text-slate-600"><span>{label}<HelpTip text={helperText} /></span><textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 block min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>;
}

/**
 * Starting a project, and editing the plan a project is made of.
 *
 * One permission, one pair of endpoints: the plan - who is assigned, the project's own settings,
 * its shoots and their services - is `PROJECT / Projects`, written through the start-project
 * endpoints. The sale it was sold at heads the form as the read-only `SaleDetailsSection` above,
 * because it is `SALES / Sales Manager`'s and is settled before a plan is made against it: the
 * shoots and the services below are built on those figures, so changing one is a deliberate act on
 * the sale in Sales Manager's own Edit Sale Details rather than a side effect of planning.
 *
 * **Signed Quotation is the one exception, on Start and Edit Project alike.** It is a sale field like the
 * rest, and it is here because it is the figure Shedule Payment plans against - every amount in
 * that section is a share of it - so the person who finds out it is wrong is the person scheduling
 * against it. Sending them to another screen under another permission to correct one number is why
 * it went uncorrected. It rides on the start-project endpoints with everything else on this form,
 * which means **whoever may edit a started project may change what it was sold for**: the project
 * manager, a branch admin, or a super admin. That is a wider set than Sales Manager, and it is the
 * deliberate cost of putting the figure where it is read. The payload omits it entirely when the
 * box is empty, so neither Start Project nor the autosave can blank a figure by leaving it empty.
 * Every screen that shows the signed figure - the Payments tab's Initial and Total signed, CRM's
 * Converted Amount, the projects table, the payment receipt - reads this field, so a correction
 * here is what they all show from the next time they load.
 */
export default function StartProjectFormPanel({ project, mode = "start", editShootId = null, initialView = "details", onClose, onSaveDraft, onStart, onShootChange, showPayments = false, stageEditor = false, initialValues, onBack, onStageSaved }) {
  const projectId = project?.id;
  // Opened from the Status tab, the details start from the form the panel underneath holds, which
  // may be ahead of `project` by an autosave.
  const initialForm = useMemo(() => initialValues || formFromProject(project), [initialValues, project]);
  const [form, setForm] = useState(() => initialForm);
  const lastSavedDraftRef = useRef(JSON.stringify(payloadFromForm(initialForm)));
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  // Only the first read of the project, so a later refresh updates the sections in place instead of
  // replacing the whole form with a spinner.
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const { notice, showNotice, showSuccess, clearNotice } = useNotice();
  const [starting, setStarting] = useState(false);
  const [schedulePayments, setSchedulePayments] = useState(paymentScheduleDefaults);
  // The project's books as the schedule reads them: each payment's running balance and the Balance Amount.
  const [scheduleLedger, setScheduleLedger] = useState(null);
  // The schedule as last read or saved, so Receive can tell whether the one on screen has unsaved changes.
  const [loadedSchedule, setLoadedSchedule] = useState(paymentScheduleDefaults);
  const paymentCategories = usePaymentCategories();
  // Set by a save refused for an undated payment, so the section marks which ones.
  const [showScheduleDateErrors, setShowScheduleDateErrors] = useState(false);
  // "details" is the form exactly as it always was. Payments is offered when the caller says the
  // viewer may read the money, and Status on every saved project; the tab bar only
  // exists when there is more than Details to choose between.
  // `initialView` opens it on another tab - Payments, from the calendar's Update payment.
  const [activeView, setActiveView] = useState(initialView);
  /*
   * Nothing is marked until the button has been pressed once, the same way Add Employee behaves: a
   * form should not open covered in complaints about fields nobody has reached yet. After that the
   * marks follow the answers as they are typed, so a field clears itself as it is filled in.
   */
  const [showProblems, setShowProblems] = useState(false);
  const isEdit = mode === "edit";
  const title = stageEditor ? "Update Project Details" : isEdit ? "Edit Project" : "Start Project";
  const paymentsOpen = showPayments && activeView === "payments";
  // Status is which stage the project is at; a project not started yet shows it waiting at the first.
  const showStatus = Boolean(projectId) && !stageEditor;
  const statusOpen = showStatus && activeView === "status";
  // What was done to the project from here, newest first - after Overall Status, on a saved project.
  const activityOpen = showStatus && activeView === "activity";
  const loadActivity = useCallback(() => getProjectActivity(projectId), [projectId]);
  const viewTabs = [{ id: "details", label: "Identification" }, ...(showPayments ? [{ id: "payments", label: "Payments" }] : []), ...(showStatus ? [{ id: "status", label: "Overall Status" }, { id: "activity", label: "Activity" }] : [])];
  const sideViewOpen = paymentsOpen || statusOpen || activityOpen;

  /*
   * What the project is signed for, read off the project rather than recomputed from its services.
   *
   * It used to be the service and deliverable rows priced at a flat 2,000 and 1,000 - two constants
   * in this file - so Schedule Payment scheduled percentages of a figure the studio had never
   * quoted, moved every time somebody added a service to the plan, and disagreed with the Signed
   * Quotation card on the project's own Payments tab.
   *
   * `initialConvertedValue` is the quotation figure: Create Project fills it from the quotation
   * chosen for the enquiry, and it is the same field the Payments tab's summary calls
   * `totalQuotation`, so the two cards now name the same number by construction. It is stamped at
   * conversion, which is what a payment schedule needs - raising a new version of the quotation
   * afterwards must not silently reprice a schedule already agreed with the client.
   */
  const signedQuotationAmount = form.initialConvertedValue;
  const description = useMemo(() => `${project?.enquiryId || "—"} | ${project?.whatsappGroupName || "WhatsApp Group Name"}`, [project?.enquiryId, project?.whatsappGroupName]);
  /*
   * The project's plan - its shoots and their services and deliverables - and every write against
   * it. Shared with Sales Manager's Edit Sale Details so the two screens offer one Service Creation
   * section rather than two that drift.
   */
  /*
   * Project started, updated from the Status tab. Update there opens these details as a panel of
   * their own on top (`stageEditor`, rendered by this same component below), with the header's back
   * arrow, the way every other stage's editor opens. Anything changed in it - the form, or a shoot
   * of the plan - asks for a remark before going back or saving, kept in the stage's history; the
   * snapshot is the form as it was when it opened. Once it is done the panel underneath takes the
   * saved form (`onStageSaved`) and re-reads its plan, so neither side holds a stale copy.
   */
  const statusSnapshotRef = useRef(JSON.stringify(payloadFromForm(initialForm)));
  const planChangedRef = useRef(false);
  const [remarkFor, setRemarkFor] = useState(null);
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [remarkError, setRemarkError] = useState("");
  const [stageEditing, setStageEditing] = useState(false);
  // The form the stage editor saved, handed up before it closes.
  const stageSavedFormRef = useRef(null);
  // Remounts the Status tab after an update, so it reads the stage and its history afresh.
  const [statusKey, setStatusKey] = useState(0);
  const planChanged = useCallback(() => { planChangedRef.current = true; onShootChange?.(); }, [onShootChange]);
  // `editShootId`: opened from a shoot's row - that shoot's edit dialog opens once the plan is in.
  const plan = useProjectPlan(projectId, { onShootChange: planChanged, onError: setError, onNotice: showNotice, onSuccess: showSuccess, editShootId });
  const loading = plan.loading;

  const draftPayload = useMemo(() => payloadFromForm(form), [form]);
  /*
   * What Project Setup still wants, keyed by field so each problem can be shown on the input it
   * belongs to rather than summarised in one line at the top that points at nothing.
   *
   * The button is deliberately never disabled by this. A disabled button cannot submit, so the
   * message naming what is outstanding could never be reached — the form would refuse and decline
   * to say why, which is the trap Add Employee's own comment records having fallen into.
   */
  const problems = useMemo(() => projectSetupProblems(form), [form]);
  const fieldErrors = showProblems ? problems : {};
  // The top says only how many are left; each one is said under its own box, and the count follows the answers.
  const problemsSummary = markedFieldsMessage(Object.keys(fieldErrors).length);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  /*
   * The two gifts, kept consistent with each other.
   *
   * Turning a gift off clears the person named for it rather than leaving a stale assignee behind
   * a hidden field, and unticks the "same person" box, which no longer has two gifts to speak
   * about. Ticking that box copies the Welcome Gift's person onto the other and keeps them in step
   * while it stays ticked; unticking it leaves the copied name in place to be changed rather than
   * emptying a field the user has just been looking at.
   */
  const setGift = (gift, value) => setForm((current) => {
    const giftField = gift === "welcome" ? "welcomeGift" : "shootCompletedGift";
    const next = { ...current, [giftField]: value };
    if (value !== "Applicable") {
      next[`${giftField}Assignee`] = "";
      next[`${giftField}EmployeeId`] = "";
      next.giftAssigneesSame = false;
    }
    return next;
  });

  const setGiftAssignee = (gift, { id, name }) => setForm((current) => {
    const prefix = gift === "welcome" ? "welcomeGift" : "shootCompletedGift";
    const next = { ...current, [`${prefix}EmployeeId`]: id, [`${prefix}Assignee`]: name };
    if (gift === "welcome" && current.giftAssigneesSame) {
      next.shootCompletedGiftEmployeeId = id;
      next.shootCompletedGiftAssignee = name;
    }
    return next;
  });

  const copyGiftAssignee = (checked) => setForm((current) => ({
    ...current,
    giftAssigneesSame: checked,
    ...(checked ? { shootCompletedGiftEmployeeId: current.welcomeGiftEmployeeId, shootCompletedGiftAssignee: current.welcomeGiftAssignee } : {}),
  }));

  /*
   * The form's own data: who may be assigned to the project, and the form itself reset to what the
   * project holds. The plan below - shoots, services, deliverables - is loaded and written by
   * `useProjectPlan`, which Sales Manager's Edit Sale Details uses for the same section.
   */
  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoadingEmployees(true);
    setError("");
    clearNotice();
    setForm(initialForm);
    lastSavedDraftRef.current = JSON.stringify(payloadFromForm(initialForm));
    await plan.load();
    setInitialLoading(false);
    // The project's saved Schedule Payment, where it has one; a project without keeps the defaults.
    try {
      const saved = await getProjectPaymentSchedule(projectId);
      if (saved?.data?.length) {
        const loaded = scheduleFormRows(saved.data, initialForm.initialConvertedValue);
        setSchedulePayments(loaded);
        setLoadedSchedule(loaded);
      }
      setScheduleLedger(saved?.ledger || null);
    } catch (scheduleError) {
      setError((current) => current || scheduleError.message || "Unable to load the payment schedule.");
    }
    try {
      const employeeResult = await getActiveSalesEmployees();
      setActiveEmployees(Array.isArray(employeeResult?.data) ? employeeResult.data : []);
    } catch (employeeError) {
      setError((current) => current || employeeError.message || "Unable to load active employees.");
    } finally {
      setLoadingEmployees(false);
    }
    // `plan` is a fresh object each render; `plan.load` is the stable callback this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearNotice, initialForm, projectId, plan.load]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function payload() {
    return draftPayload;
  }

  const saveDraft = useCallback(async ({ notify = false } = {}) => {
    if (!onSaveDraft) return;
    setError("");
    try {
      await onSaveDraft(draftPayload);
      lastSavedDraftRef.current = JSON.stringify(draftPayload);
      if (notify) showSuccess("Draft saved successfully.");
    } catch (saveError) {
      setError(saveError.message || "Unable to save draft.");
    }
  }, [draftPayload, onSaveDraft, showSuccess]);

  useEffect(() => {
    if (!onSaveDraft || initialLoading || loading) return undefined;
    const serialized = JSON.stringify(draftPayload);
    if (serialized === lastSavedDraftRef.current) return undefined;
    const timer = window.setTimeout(() => { void saveDraft(); }, 900);
    return () => window.clearTimeout(timer);
  }, [draftPayload, initialLoading, loading, onSaveDraft, saveDraft]);

  const detailsChanged = () => planChangedRef.current || JSON.stringify(draftPayload) !== statusSnapshotRef.current;

  // The stage editor's way back: by way of the remark when something changed, straight back if not.
  const backToStatus = () => (detailsChanged() ? setRemarkFor("back") : onBack?.({ changed: false }));

  // What is on screen is written before it is described - the autosave waits for typing to pause.
  async function saveDetailsNow() {
    await saveSchedule();
    if (onSaveDraft && JSON.stringify(draftPayload) !== lastSavedDraftRef.current) {
      await onSaveDraft(draftPayload);
      lastSavedDraftRef.current = JSON.stringify(draftPayload);
    }
  }

  async function confirmRemark(remark) {
    setRemarkSaving(true);
    setRemarkError("");
    try {
      await saveDetailsNow();
      await recordProjectStageUpdate(projectId, { stage: "STARTED", remark });
      setRemarkFor(null);
      onStageSaved?.(form);
      onBack?.({ changed: true });
    } catch (remarkSaveError) {
      setRemarkError(remarkSaveError.message || "Unable to save the remark.");
    } finally {
      setRemarkSaving(false);
    }
  }

  // The stage editor closing over the Status tab: the panel underneath takes what was saved.
  function closeStageEditor({ changed }) {
    if (changed) {
      setForm(stageSavedFormRef.current || form);
      lastSavedDraftRef.current = JSON.stringify(payloadFromForm(stageSavedFormRef.current || form));
      void plan.load();
      setStatusKey((key) => key + 1);
      showSuccess("Project details updated and saved to the status history.");
    }
    stageSavedFormRef.current = null;
    setStageEditing(false);
  }

  // The Schedule Payment is written with the plan, never by the autosave: it is money Accounts works to.
  async function saveSchedule() {
    if (!projectId) return;
    const saved = await saveProjectPaymentSchedule(projectId, scheduleSavePayload(schedulePayments));
    if (saved?.data?.length) {
      const kept = scheduleFormRows(saved.data, form.initialConvertedValue);
      setSchedulePayments(kept);
      setLoadedSchedule(kept);
    }
  }

  /*
   * Receive on a payment records money in Accounts' own panel; the schedule and its balances are then
   * read again. Only while the schedule on screen has nothing unsaved (`useScheduleReceiver`).
   */
  const receiver = useScheduleReceiver({
    isDirty: () => JSON.stringify(scheduleSavePayload(schedulePayments)) !== JSON.stringify(scheduleSavePayload(loadedSchedule)),
    onRecorded: (message) => {
      if (message) showSuccess(message);
      void (async () => {
        try {
          const saved = await getProjectPaymentSchedule(projectId);
          if (saved?.data?.length) {
            const loaded = scheduleFormRows(saved.data, form.initialConvertedValue);
            setSchedulePayments(loaded);
            setLoadedSchedule(loaded);
          }
          setScheduleLedger(saved?.ledger || null);
        } catch (scheduleError) {
          setError(scheduleError.message || "Unable to load the payment schedule.");
        }
      })();
    },
    onError: setError,
  });

  async function save() {
    setStarting(true);
    setError("");
    try {
      await saveSchedule();
      await onStart(payload());
    } catch (startError) {
      setError(startError.message || `Unable to ${isEdit ? "save" : "start"} project.`);
    } finally {
      setStarting(false);
    }
  }

  /* One press, one write: the plan. The sale above it is read-only and has no endpoint here. */
  async function submit(event) {
    event.preventDefault();
    /*
     * Every required answer in Project Setup, checked in one place before anything is written.
     *
     * Project Validity and the assignee of an applicable gift were already refused here, each with
     * a sentence of its own; CRD Document was marked required and never checked at all, which is
     * how a project could be started with the one answer CRD Documents sorts by left unset. They
     * are now the same rule — `projectSetupProblems`, which the server asserts again — and each
     * marks the field it belongs to instead of naming itself in a notice.
     */
    if (Object.keys(problems).length) {
      setShowProblems(true);
      setError("");
      return;
    }
    // Every payment the schedule saves falls due on a day - except the one settling the balance.
    // The server refuses an undated one too.
    if (undatedPayments(schedulePayments, paymentCategories.settling).length) {
      setShowScheduleDateErrors(true);
      setError("Choose a date for every payment under Shedule Payment.");
      return;
    }
    // An applicable gift is somebody's job. Saving one with nobody named puts a row on Client Gifts
    // that nothing will ever move along, so it is refused here rather than chased later.
    const unassignedGift = form.welcomeGift === "Applicable" && !form.welcomeGiftEmployeeId ? "Welcome Gift"
      : form.shootCompletedGift === "Applicable" && !form.shootCompletedGiftEmployeeId ? "Shoot Completed Gift"
      : "";
    if (unassignedGift) {
      setError(`Assign an employee to take care of the ${unassignedGift}.`);
      return;
    }
    // Opened from the Status tab: Update is the remark (when anything changed) and the save, then
    // back to the status - it never closes the project the way the full panel's Update does.
    if (stageEditor) {
      if (detailsChanged()) setRemarkFor("submit");
      else onBack?.({ changed: false });
      return;
    }
    await save();
  }

  // Close, Discard, then the submit - one group at the right, which is where the panel's footer puts
  // whatever it is given (`SchemaFormPanel`). It was `justify-between` with Close pushed to the far
  // left, so this footer read as two sets of buttons with a gap in the middle.
  const footer = <div className="flex w-full flex-wrap items-center gap-3 sm:justify-end">
    <button type="button" disabled={starting} onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 max-sm:flex-1">Close</button>
    <button type="button" disabled={starting} onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-blue-700 disabled:opacity-60 max-sm:flex-1">{isEdit ? "Discard changes" : "Discard"}</button>
    {/* Only the submit itself disables this. The background draft save must not, or the button
        greys out and back every time typing pauses. */}
    <button disabled={starting} className="min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300 max-sm:flex-1">{starting ? "Saving..." : isEdit ? "Update" : "Start"}</button>
  </div>;

  const stageFooter = <div className="flex w-full flex-wrap items-center gap-3 sm:justify-end">
    <Button type="button" size="lg" className="max-sm:flex-1" disabled={remarkSaving} onClick={backToStatus}>Back</Button>
    <Button type="submit" size="lg" variant="primary" className="max-sm:flex-1" disabled={remarkSaving}>Update</Button>
  </div>;

  // Update and Discard act on the form, which is not on screen while Payments is — the money's own
  // actions live on the tab itself, so the footer keeps only the way back, as the record view does.
  const paymentsFooter = <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700">Close</button>;

  return <SchemaFormPanel
    title={title}
    titleAddon={<ProjectHoldBadge status={project?.projectStatus} holds={project?.holds} paymentsDue={project?.paymentsDue} />}
    description={description}
    tabs={viewTabs.length > 1 && <Tabs
      tabs={viewTabs}
      value={activeView}
      onChange={setActiveView}
      ariaLabel={`${title} sections`}
    />}
    sections={sideViewOpen ? [] : sections}
    sidebarAriaLabel="Project workflow sections"
    closeAriaLabel={stageEditor ? "Back to status" : `Close ${title}`}
    onClose={stageEditor ? backToStatus : onClose}
    onBack={stageEditor ? backToStatus : undefined}
    backAriaLabel="Back to status"
    onSubmit={submit}
    error={error || problemsSummary}
    footer={stageEditor ? stageFooter : sideViewOpen ? paymentsFooter : footer}
    loading={initialLoading}
    loadingLabel="Loading project details..."
  >
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* Full width, the way the record view draws the same tab: Payments is three columns side by
        side, and the form's own 1040px cap would leave a third of the screen empty beside it. */}
    {paymentsOpen && <div className="w-full px-4 py-4 sm:px-6 sm:py-5"><ProjectPaymentsView projectId={projectId} allowRaiseExtra={false} /></div>}
    {activityOpen && <div className="w-full"><ProjectActivityTab load={loadActivity} /></div>}
    {statusOpen && <div className="w-full px-4 py-4 sm:px-6 sm:py-5"><ProjectStageView key={statusKey} projectId={projectId} canUpdate={isEdit} onUpdateStarted={() => setStageEditing(true)} /></div>}
    {stageEditing && <StartProjectFormPanel
      project={project}
      mode="edit"
      stageEditor
      initialValues={form}
      onSaveDraft={onSaveDraft}
      onShootChange={onShootChange}
      onStageSaved={(saved) => { stageSavedFormRef.current = saved; }}
      onBack={closeStageEditor}
    />}
    {remarkFor && <StageUpdateRemarkDialog
      stageLabel="Project Initiation"
      saving={remarkSaving}
      error={remarkError}
      onCancel={() => { setRemarkFor(null); setRemarkError(""); }}
      onConfirm={confirmRemark}
    />}
    {!sideViewOpen && <>
    <SaleDetailsSection project={project} />
    <SchemaFormSection id="project-setup" title="Project Setup">
      <div className="grid gap-5 md:grid-cols-2">
        <EmployeeDropdown label="Project Manager" helperText="The active employee who owns this project from start to delivery." employeeId={form.projectManagerEmployeeId} employeeName={form.projectManager} employees={activeEmployees} loading={loadingEmployees} onChange={({ id, name }) => setForm((current) => ({ ...current, projectManagerEmployeeId: id, projectManager: name }))} />
        <EmployeeDropdown label="Pre Production Coordinator" helperText="The active employee who plans the shoots with the client." employeeId={form.preProductionCoordinatorEmployeeId} employeeName={form.preProductionCoordinator} employees={activeEmployees} loading={loadingEmployees} onChange={({ id, name }) => setForm((current) => ({ ...current, preProductionCoordinatorEmployeeId: id, preProductionCoordinator: name }))} />
        {/*
          * The fifth seat, asked for here with the other four rather than on Pre Production's
          * General panel, where it used to be the one field: who runs the shoots is settled when the
          * project is staffed, and splitting one question across two screens meant a studio that had
          * named everybody still had an empty seat to find. Naming somebody here is what raises the
          * project's production rows, exactly as it did from General.
          */}
        <EmployeeDropdown label="Production Manager" helperText="The active employee who runs the shoot days and the crew." employeeId={form.productionManagerEmployeeId} employeeName={form.productionManager} employees={activeEmployees} loading={loadingEmployees} onChange={({ id, name }) => setForm((current) => ({ ...current, productionManagerEmployeeId: id, productionManager: name }))} />
        <EmployeeDropdown label="Creative Manager" helperText="The active employee who leads the creative side of this project." employeeId={form.creativeManagerEmployeeId} employeeName={form.creativeManager} employees={activeEmployees} loading={loadingEmployees} onChange={({ id, name }) => setForm((current) => ({ ...current, creativeManagerEmployeeId: id, creativeManager: name }))} />
        <EmployeeDropdown label="Post Production Coordinator" helperText="The active employee who sees editing and deliverables through to delivery." employeeId={form.postProductionCoordinatorEmployeeId} employeeName={form.postProductionCoordinator} employees={activeEmployees} loading={loadingEmployees} onChange={({ id, name }) => setForm((current) => ({ ...current, postProductionCoordinatorEmployeeId: id, postProductionCoordinator: name }))} />
      </div>
      {/*
        * The two client gifts, side by side because they are the same question asked twice and are
        * usually answered the same way. Each asks who takes care of it only once it is Applicable:
        * a "Not Applicable" gift has nobody to assign, so the dropdown is absent rather than shown
        * disabled, and `setGift` clears the name when the answer turns to Not Applicable.
        */}
      <div className="mt-8 border-t border-slate-200 pt-6">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <RadioGroupField label="Welcome Gift" required helperText="Whether the client gets a welcome gift with this booking." error={fieldErrors.welcomeGift} value={form.welcomeGift} onChange={(value) => setGift("welcome", value)} options={["Applicable", "Not Applicable"]} variant="field" />
            {form.welcomeGift === "Applicable" && <EmployeeDropdown label="Welcome Gift Assigned To" required helperText="The employee who arranges and hands over the welcome gift." error={fieldErrors.welcomeGiftEmployeeId} employeeId={form.welcomeGiftEmployeeId} employeeName={form.welcomeGiftAssignee} employees={activeEmployees} loading={loadingEmployees} onChange={({ id, name }) => setGiftAssignee("welcome", { id, name })} />}
          </div>
          <div className="space-y-4">
            <RadioGroupField label="Shoot Completed Gift" required helperText="Whether the client gets a gift once the shoots are done." error={fieldErrors.shootCompletedGift} value={form.shootCompletedGift} onChange={(value) => setGift("shootCompleted", value)} options={["Applicable", "Not Applicable"]} variant="field" />
            {form.shootCompletedGift === "Applicable" && <EmployeeDropdown label="Shoot Completed Gift Assigned To" required helperText="The employee who arranges and hands over the shoot completed gift." error={fieldErrors.shootCompletedGiftEmployeeId} employeeId={form.shootCompletedGiftEmployeeId} employeeName={form.shootCompletedGiftAssignee} employees={activeEmployees} loading={loadingEmployees} disabled={form.giftAssigneesSame} onChange={({ id, name }) => setGiftAssignee("shootCompleted", { id, name })} />}
          </div>
        </div>
        {/* Offered only when both gifts are being given, because that is the only time there are
            two names to keep in step. Ticking it copies the first onto the second and holds it
            there, the same shortcut the employee form's permanent address has. */}
        {form.welcomeGift === "Applicable" && form.shootCompletedGift === "Applicable" && <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
          <Checkbox checked={form.giftAssigneesSame} onChange={copyGiftAssignee} ariaLabel="The same person takes care of both gifts" />
          <span>The same person takes care of both gifts</span>
        </label>}
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <SharedTextField type="number" min="1" step="1" label="Project Validity (In Months)" required helperText="How many months this project stays valid, in whole months." error={fieldErrors.projectValidityMonths} value={form.projectValidityMonths} onChange={(event) => update("projectValidityMonths", event.target.value)} />
          <RadioGroupField label="Storage Needed" required helperText="Yes when this project includes storing the client's files." error={fieldErrors.storageNeeded} value={form.storageNeeded} onChange={(value) => update("storageNeeded", value)} options={["Yes", "No"]} variant="field" />
          <RadioGroupField label="CRD Document" required helperText="Applicable when the client is to send a CRD for this project." error={fieldErrors.crdDocumentStatus} value={form.crdDocumentStatus} onChange={(value) => update("crdDocumentStatus", value)} options={crdOptions} variant="field" />
        </div>
      </div>
    </SchemaFormSection>
    <SchemaFormSection id="sales-remarks" title="Sales Remarks">
      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField label="Pre Production Remarks" helperText="Add If you have any remarks for Pre Production" value={form.salesPreProductionRemarks} onChange={(value) => update("salesPreProductionRemarks", value)} />
        <TextAreaField label="Production Remarks" helperText="Add If you have any remarks for Production" value={form.salesProductionRemarks} onChange={(value) => update("salesProductionRemarks", value)} />
        <TextAreaField label="Post Production Remarks" helperText="Add If you have any remarks for Post Production" value={form.salesPostProductionRemarks} onChange={(value) => update("salesPostProductionRemarks", value)} />
      </div>
    </SchemaFormSection>
    <SchemaFormSection id="service-creation" title="Service Creation">
      <ProjectServiceCreationSection {...plan.sectionProps} />
    </SchemaFormSection>
    {/* Editable on Start and Edit Project: the person scheduling against the figure is the one who
        finds out it is wrong. */}
    <SchedulePaymentSection
      categories={paymentCategories}
      showDateErrors={showScheduleDateErrors}
      shoots={plan.sectionProps.shoots || []}
      signedQuotation={signedQuotationAmount}
      onSignedQuotationChange={(value) => setForm((current) => ({ ...current, initialConvertedValue: value }))}
      rows={schedulePayments}
      onChange={setSchedulePayments}
      ledger={scheduleLedger}
      onReceive={receiver.canReceive && projectId ? receiver.open : null}
      receivingId={receiver.openingId}
    />
    {receiver.payment && <ScheduledPaymentPanel key={receiver.payment.id} {...receiver.panelProps} />}
    </>}
    {plan.shootDialog.open && <AddShootDialog initialShoot={plan.shootDialog.initialShoot} copyOf={plan.shootDialog.copyOf} existingShoots={plan.shootDialog.existingShoots} vertical={project?.groupType || project?.vertical} onClose={plan.shootDialog.onClose} onSave={plan.shootDialog.onSave} />}
  </SchemaFormPanel>;
}
