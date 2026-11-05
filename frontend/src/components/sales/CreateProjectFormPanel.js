"use client";

import SharedTextAreaField from "@/components/shared/TextAreaField";
import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddShootDialog from "@/components/project-management/AddShootDialog";
import SchedulePaymentSection, { paymentScheduleDefaults, usePaymentCategories } from "@/components/project-management/SchedulePaymentSection";
import useScheduleReceiver from "@/components/project-management/useScheduleReceiver";
import ScheduledPaymentPanel from "@/components/accounts/ScheduledPaymentPanel";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { amountForPercentage, scheduleFormRows, scheduleSavePayload, undatedPayments } from "@/lib/paymentSchedule.mjs";
import useProjectPlan from "@/components/project-management/useProjectPlan";
import ProjectServiceCreationSection from "@/components/project-management/ProjectServiceCreationSection";
import { reorderShoots, shootListOrder } from "@/lib/shootOrder.mjs";
import usePendingShootLines, { deliverablePayload, normalizePendingDeliverable, normalizePendingService, servicePayload } from "@/components/project-management/usePendingShootLines";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import SaleExtrasSection from "./SaleExtrasSection";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import SaleDetailsSection, { saleFieldProblems, saleFieldsFromProject } from "@/components/sales/SaleDetailsSection";
import useFormErrors from "@/components/shared/useFormErrors";
import ClientCredentialsSection from "@/components/sales/ClientCredentialsSection";
import ExistingClientLogin from "@/components/sales/ExistingClientLogin";
import ClientLoginEditSection from "@/components/sales/ClientLoginEditSection";
import { getProjectPaymentSchedule } from "@/services/project-management/project-workflow.service";
import { clientLoginPayload, clientLoginProblems, clientUsernameFor, emptyClientLogin } from "@/lib/clientLogin.mjs";
import { getClientLoginByNumber } from "@/services/sales/projects.service";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import {
  OTHER_HANDLER,
  bookingSchedulePrefix,
  settleChange,
  settleNotes,
  withSettledPayment,
  cashEntryPayload,
  cashEntryProblems,
  projectAdvanceFormSections,
  projectAdvanceInitialValues,
} from "@/constants/accountsConfig";
import usePaymentModes from "@/components/accounts/usePaymentModes";
import { createProjectDeliverableAllocation, createProjectServiceAllocation, getProjectDeliverableDefinitions, getProjectServiceDefinitions, saveProjectShoots } from "@/services/project-management/project-workflow.service";
import { projectLinesAmount } from "@/lib/projectLinePricing.mjs";
import { deliverableVariantPayload } from "@/lib/deliverableBrands.mjs";
import { getSalesQuotation, getProjectAdvanceOptions } from "@/services/sales/projects.service";
import { planFromQuotation, readyToBringPlan, unplannedPart } from "@/components/sales/quotationProjectPlan";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { draftKeptUntil, draftSavedOn } from "@/components/sales/ProjectDraftsDialog";
import { draftDropsFiles, projectDraftSnapshot } from "@/lib/projectDrafts.mjs";

/*
 * Service Creation and Shedule Payment are named here exactly as Start / Edit Project names them,
 * and render the same two components: what a project is being sold is one section of the OS, not
 * one per form. "Event Planning" was this form's own word for the first of them.
 *
 * Payment Received sits last, after the schedule, because it is the only section that records money
 * rather than describing the sale - and the money can only be judged against what the project is
 * signed for and how that was scheduled. Asking for the advance third, before the shoots were
 * planned and before the schedule said what the advance is a share of, put the one irreversible
 * answer on the form ahead of everything it depends on.
 */
const projectSectionLinks = [["project-details", "Project Details"], ["sales-remarks", "Sales Remarks"], ["service-creation", "Service Creation"], ["sale-extras", "Extra"], ["schedule-payment", "Shedule Payment"], ["payment-received", "Payment Received"]];
/*
 * The rail: the project's own sections under one **Project** group, then **Client Credentials** -
 * the client's sign-in, which is about who may log in rather than about the sale.
 *
 * Editing a sale shows the same flow as creating one, minus Payment Received: the advance is
 * recorded once, when the project is created, and corrected afterwards in Accounts or on the
 * project's Payments tab - showing it here would write a second cash entry on every save. Client
 * Credentials is there in both: made with the project on Create, shown - or made for a project
 * booked without one - on Edit.
 */
const CLIENT_CREDENTIALS_LINK = ["client-credentials", "Client Credentials"];

function initialForm(project) {
  return {
    ...saleFieldsFromProject(project),
    /*
     * The quotation's own row id, where the caller supplied one.
     *
     * `saleFieldsFromProject` blanks it deliberately: a *stored project* names the version it
     * converted at but must not re-apply that quotation's shoots every time it is reopened, months
     * of adjustments later. A prefill is the opposite case - Create Project opened from a quotation
     * is asking for exactly that - and it is not a stored project, so an id passed in is honoured
     * and the quoted plan comes across.
     */
    quotationRowId: project?.quotationRowId || "",
    salesPreProductionRemarks: project?.salesPreProductionRemarks === "NA" ? "" : project?.salesPreProductionRemarks || "",
    salesProductionRemarks: project?.salesProductionRemarks === "NA" ? "" : project?.salesProductionRemarks || "",
    salesPostProductionRemarks: project?.salesPostProductionRemarks === "NA" ? "" : project?.salesPostProductionRemarks || "",
    shoots: [],
  };
}

function hasChanged(form, originalForm) {
  return Object.keys(form).some((key) => JSON.stringify(form[key] ?? "") !== JSON.stringify(originalForm[key] ?? ""));
}

function TextAreaField({ label, helperText, value, onChange }) {
  return <SharedTextAreaField label={label} helperText={helperText} value={value} onChange={(event) => onChange(event.target.value)} inputClassName="min-h-24" />;
}


/*
 * `draft` is a Create Project put aside with Save Draft (`lib/projectDrafts.mjs`): the form as it was
 * left, its pending plan, payment schedule and advance. It reopens through the same seeding a
 * duplicate uses, so its rows are matched against today's master data. `onSaveDraft` puts the form
 * aside and is offered only when creating - an edit writes to a project that already exists.
 *
 * `onReturnToProjects` is passed only for a project Projects sent back, and turns the footer into
 * Discard, Save Draft and Update to Project: Save Draft saves the sale and leaves it under Sent Back
 * (`onSave(..., { draft: true })`), Update to Project saves it and returns it to Projects → Yet to
 * Start - or, with nothing on the form changed, only returns it (`onReturnToProjects`).
 *
 * `findDraft(enquiryId)` and `onUseDraft(draft)` are how the form asks, the moment an enquiry is
 * chosen - picked, or arriving with a converted lead or a quotation - whether to carry on with the
 * draft already saved for it or start this one new. `draftId` is the draft this form was opened on,
 * which is never offered back to itself.
 */
export default function CreateProjectFormPanel({ editShootId = null, onClose, onSave, groupNames = [], isLoadingGroupNames = false, project = null, mode = "create", canEditSchedule = false, prefillPlan: duplicatePlan = null, draft = null, draftId = "", findDraft, onUseDraft, onSaveDraft, onReturnToProjects }) {
  // A draft's plan is laid down exactly as a duplicate's is.
  const prefillPlan = duplicatePlan || draft?.plan || null;
  /*
   * Locked only when there is an enquiry to show, which is what `enquiryLocked` means - and kept
   * locked on a draft of such a booking, which carries the answer it was saved with.
   */
  const enquiryLocked = Boolean(project?.enquiryId || draft?.enquiryLocked);
  /*
   * Payment Received is shown to whoever may book a project.
   *
   * It used to answer to `ACCOUNTS / Cash Management`, because the advance is a cash entry - and
   * that was the wrong question to ask of this form. The person booking a project is typing what the
   * client just handed over, against the project they are creating; holding that behind the whole
   * cash book meant either giving a project creator the studio's books or booking the project with
   * the advance left off for somebody else to type in later.
   *
   * The act keeps its own guard rather than losing one: the advance now posts to
   * `POST /api/sales/projects/:id/advance`, which answers to the same `SALES / Sales Manager` that
   * created the project, writes through the Accounts module's own recorder, and is money-in only.
   * Nothing about `ACCOUNTS / Cash Management` moved - it still guards the cash book itself.
   */
  // Laid over a blank form, so a field added since the draft was saved still starts with its default.
  const [originalForm] = useState(() => (draft?.form ? { ...initialForm(null), ...draft.form } : initialForm(project)));
  const [form, setForm] = useState(() => originalForm);
  // Read as `formState` inside `submit`, which saves the form with the Signed Quotation on screen.
  const formState = form;
  const [error, setError] = useState("");
  // The sale fields' red, each under its own box; the banner says only how many.
  const saleFields = useFormErrors();
  const [isSaving, setIsSaving] = useState(false);
  /*
   * The Schedule Payment rows. Creating a project sends them with it (`ProjectBookingPanel`); editing
   * a sale **reads the project's own** below, because the schedule is the project's and showing the
   * defaults over it read as "the rows I entered were not saved".
   *
   * Changing one answers to `PROJECT / Projects`, not to the sale's permission - so the section is a
   * form for somebody who may (`canEditSchedule`) and read-only for everybody else, rather than a
   * form whose save would be refused.
   */
  const [schedulePayments, setSchedulePayments] = useState(() => draft?.schedulePayments || paymentScheduleDefaults);
  /*
   * Edit Sale Details opens the schedule ready to edit for somebody who may change it
   * (`canEditSchedule`), and read-only for everybody else. `loadedSchedule` is the schedule as it
   * opened, so a change to it alone is still saved.
   */
  const scheduleReadOnly = mode === "edit" && !canEditSchedule;
  const [loadedSchedule, setLoadedSchedule] = useState(() => draft?.schedulePayments || paymentScheduleDefaults);
  const paymentCategories = usePaymentCategories();
  // Set by a save refused for an undated payment, so the section marks which ones.
  const [showScheduleDateErrors, setShowScheduleDateErrors] = useState(false);
  /*
   * Editing a sale edits a project that already exists, so its plan is read from the server and
   * every change is written straight back - the same hook, the same endpoints and the same careful
   * shoot deletion Start / Edit Project uses. Creating one has no project to write against yet, so
   * that path keeps its pending rows and sends them with the project.
   */
  // `editShootId`: opened from a shoot's row - that shoot's edit dialog opens once the plan is in.
  const plan = useProjectPlan(mode === "edit" ? project?.id : null, { onError: setError, editShootId: mode === "edit" ? editShootId : null });
  // The published Net Extra the Extra section reads, shown under Shedule Payment's Signed Quotation.
  const [publishedExtra, setPublishedExtra] = useState(null);
  // The saved project's books as the schedule reads them - each payment's running balance and the
  // Balance Amount (`GET …/payment-schedule`'s `ledger`). Edit only: a project being created has none.
  const [scheduleLedger, setScheduleLedger] = useState(null);
  // Amounts typed in the Extra section and not yet saved there: closing or saving the panel asks first.
  const extrasUnsaved = useRef(false);
  const markExtrasUnsaved = useCallback((unsaved) => { extrasUnsaved.current = unsaved; }, []);
  const extrasGuard = useUnsavedGuard(() => extrasUnsaved.current, {
    title: "Continue without the Extra amounts?",
    message: "Amounts or remarks typed in Extra – Additional & Removed Items are not published yet, and will be lost - the rest of the sale is not affected. Go back and click Publish Updated Quotation there to keep them.",
    confirmLabel: "Continue without them",
  });
  const closePanel = () => extrasGuard.guard(onClose);
  // A sent-back project's footer: Discard, Save Draft, Update to Project (`onReturnToProjects`).
  const sentBack = mode === "edit" && Boolean(project?.sentBackAt) && Boolean(onReturnToProjects);
  const [savingDraft, setSavingDraft] = useState(false);
  // Discard throws away whatever is typed and not saved - asked first when there is any. Shoots,
  // services and payments saved through their own dialogs are already saved and stay so.
  const discardGuard = useUnsavedGuard(() => hasChanged({ ...form, initialConvertedValue: signedQuotation }, originalForm), {
    title: "Discard your changes?",
    message: "Everything changed on this form since it was last saved is lost, and the project stays under Sent Back. Shoots, services and payments saved through their own dialogs stay saved.",
    confirmLabel: "Discard",
  });
  const discardChanges = () => discardGuard.guard(closePanel);
  // While the Extra section has something to publish - its Publish Updated Quotation open - the sale is
  // not updated: Update Project is held, and Enter in a field of the form does not save it either.
  // Publishing there (or undoing the change) opens it again. `submit` itself is unchanged.
  const [extrasPublishPending, setExtrasPublishPending] = useState(false);
  const EXTRAS_PENDING = "Publish Updated Quotation in Extra – Additional & Removed Items first, then update the project.";
  const guardedSubmit = (event) => {
    event.preventDefault();
    if (extrasPublishPending) { setError(EXTRAS_PENDING); return; }
    void submit(event);
  };
  // Save Draft on a sent-back project: the same checks and the same save, left under Sent Back.
  const saveSentBackDraft = () => {
    if (extrasPublishPending) { setError(EXTRAS_PENDING); return; }
    void submit(null, { draft: true });
  };

  // Changes whenever Service Creation changes a row, so the Extra section re-reads what it records.
  const planSignature = useMemo(() => JSON.stringify([
    (plan.shoots || []).map((shoot) => shoot.id),
    Object.values(plan.servicesByShoot || {}).flat().map((row) => [row.id, row.quantity, row.sessionOptionId, row.durationHours, row.durationMinutes, row.workDays, row.timingMinutes, row.sizeOptionValueId]),
    Object.values(plan.deliverablesByShoot || {}).flat().map((row) => [row.id, row.quantity, row.numberOfPhotos, row.size, row.sizeOptionValueId, row.deliverableVariantId]),
  ]), [plan.shoots, plan.servicesByShoot, plan.deliverablesByShoot]);

  /*
   * The project's saved schedule, once, when a sale is opened for editing. A project that has none -
   * booked before the schedule was kept - keeps the defaults, so the section is never empty.
   */
  const savedScheduleFor = project?.initialConvertedValue;
  /*
   * Receive on a payment records money in Accounts' own panel; once it has, the schedule and its
   * balances are read again so the row shows Cleared (or the payment a part payment split off) and
   * Received and the Balance Amount move. Only while the schedule on screen has nothing unsaved -
   * `useScheduleReceiver` asks for Update Project first otherwise - so nothing typed is lost.
   */
  const { notice, showSuccess, clearNotice } = useNotice();
  const reloadSchedule = useCallback(async () => {
    if (!project?.id) return;
    try {
      const saved = await getProjectPaymentSchedule(project.id);
      if (saved?.data?.length) {
        const loaded = scheduleFormRows(saved.data, savedScheduleFor);
        setSchedulePayments(loaded);
        setLoadedSchedule(loaded);
      }
      setScheduleLedger(saved?.ledger || null);
    } catch (scheduleError) {
      setError(scheduleError.message || "Unable to load the payment schedule.");
    }
  }, [project?.id, savedScheduleFor]);
  const receiver = useScheduleReceiver({
    isDirty: () => JSON.stringify(scheduleSavePayload(schedulePayments)) !== JSON.stringify(scheduleSavePayload(loadedSchedule)),
    onRecorded: (message) => {
      if (message) showSuccess(message);
      void reloadSchedule();
    },
    onError: setError,
  });
  useEffect(() => {
    if (mode !== "edit" || !project?.id) return undefined;
    let current = true;
    getProjectPaymentSchedule(project.id)
      .then((saved) => {
        if (current && saved?.data?.length) {
          const loaded = scheduleFormRows(saved.data, savedScheduleFor);
          setSchedulePayments(loaded);
          setLoadedSchedule(loaded);
        }
        if (current) setScheduleLedger(saved?.ledger || null);
      })
      .catch((scheduleError) => {
        if (current) setError((existing) => existing || scheduleError.message || "Unable to load the payment schedule.");
      });
    return () => { current = false; };
  }, [mode, project?.id, savedScheduleFor]);
  /*
   * The Balance Amount beside the schedule is the server's reading of the books, and publishing a
   * Sale Extra here changes its Updated Total Amount - so it is read again when the published net
   * moves (the rows are left alone: they may be mid-edit). The first value is the one just loaded.
   */
  const publishedNet = publishedExtra ? publishedExtra.net : null;
  const ledgerNetRef = useRef(publishedNet);
  useEffect(() => {
    if (mode !== "edit" || !project?.id || ledgerNetRef.current === publishedNet) return undefined;
    ledgerNetRef.current = publishedNet;
    let current = true;
    getProjectPaymentSchedule(project.id)
      .then((saved) => { if (current) setScheduleLedger(saved?.ledger || null); })
      .catch(() => {});
    return () => { current = false; };
  }, [mode, project?.id, publishedNet]);
  useEffect(() => {
    if (mode !== "edit") return;
    void plan.load();
    // `plan.load` is the stable callback; `plan` itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, plan.load]);
  const [serviceDefinitions, setServiceDefinitions] = useState([]);
  const [deliverableDefinitions, setDeliverableDefinitions] = useState([]);
  const [serviceDefinitionsError, setServiceDefinitionsError] = useState("");
  const [deliverableDefinitionsError, setDeliverableDefinitionsError] = useState("");
  const [isLoadingMasterData, setIsLoadingMasterData] = useState(mode === "create");
  // A new project's services and deliverables, held here until Create Project saves them.
  const pendingLines = usePendingShootLines({ serviceDefinitions, deliverableDefinitions });
  const { serviceAllocations, deliverableAllocations, serviceAllocationsRef, deliverableAllocationsRef, servicesByShoot, deliverablesByShoot } = pendingLines;
  const [isShootDialogOpen, setIsShootDialogOpen] = useState(false);
  const [editingShoot, setEditingShoot] = useState(null);
  // The shoot a Duplicate copies, while its dialog is open; Save adds the copy as a new shoot.
  const [copyingShoot, setCopyingShoot] = useState(null);
  const [loadingQuotedPlan, setLoadingQuotedPlan] = useState(false);
  /*
   * The quotation whose plan has already been brought in, so it is brought in once.
   *
   * Seeded with the project's own quotation when editing: reopening a project must not re-add the
   * shoots it was created from, which by then carry their own allocations, payments and edits.
   * Picking a *different* quotation is a different id and does apply.
   *
   * Not seeded when a row id came with it, and that is the whole difference between the two things
   * a prefilled quotation can mean. A saved project states the quotation it was sold on by its
   * number and nothing else, so seeding is right there; a form opened from a quotation's own
   * Create Project carries the row to read, and seeding would mark it applied before it had been
   * read - the panel would open naming the quotation and showing none of its shoots.
   */
  // A draft's quotation was brought in before it was saved - its shoots are in the draft - so it is
  // not brought in a second time over them.
  const appliedQuotationRef = useRef(draft ? draft.form?.quotationId || "" : project?.quotationRowId ? "" : project?.quotationId || "");
  // The advance handed over when the booking was confirmed, recorded against the project the moment
  // it exists. Its own state rather than part of `form`: it is a cash entry, saved through Accounts'
  // own endpoint, and it must not reach the sales payload.
  /*
   * The copied plan is laid down once, and this is what says it has been.
   *
   * Not a piece of state, because seeding sets three others and re-running on their renders would
   * put the shoots back the moment one was deleted - a Service Creation section that refuses to be
   * edited, which is the opposite of what a duplicate is for.
   */
  const seededDuplicateRef = useRef(false);
  const [advance, setAdvance] = useState(() => (draft?.advance ? { ...projectAdvanceInitialValues, ...draft.advance } : projectAdvanceInitialValues));
  const [cashOptions, setCashOptions] = useState(null);
  const showAdvance = mode === "create";
  /*
   * The advance, required in full wherever the section is shown.
   *
   * **Optional as a whole, required once begun.** Start the section and every field it shows has to
   * be answered; leave it untouched and the project is created with no payment against it, the money
   * recorded later on its Payments tab.
   *
   * It was briefly required in full - but only for the people who could see it, and the note at the
   * foot of this comment used to read "somebody without ACCOUNTS / Cash Management never sees the
   * section, so none of this applies". That was the escape: those readers booked the project and
   * Accounts recorded the money afterwards. Showing the section to everybody who may book a project
   * closed the escape without revisiting the rule, and the two together meant **no project could be
   * created at all without a complete cash entry** - including the many that are booked before any
   * money has changed hands.
   *
   * Keyed by field rather than taken as one sentence, so each outstanding answer is marked on the
   * box it belongs to. Read against `advanceContext`, because which fields the section is even
   * showing depends on it — a UPI payment asks for a transaction ID and cash asks for neither
   * that nor an account, and a field that is not on screen must never be required.
   *
   * Everybody who may book a project sees the section now, so "not started" is what carries the case
   * that used to be carried by not being allowed to see it.
   */
  /*
   * Nothing is marked until Save has been pressed once, the way Add Employee behaves — a form
   * should not open covered in complaints about fields nobody has reached yet.
   */
  const [showProblems, setShowProblems] = useState(false);
  /*
   * Client Credentials, on the same permission as the booking it belongs to.
   *
   * It asked for `ADMIN / User Management`, on the reading that making an account is User
   * Management's act. That is true of a *staff* account; a client login reaches one project's
   * portal and nothing else, and making it is the last step of booking that project. The section
   * was hidden from the very people whose booking it is - and it took the form's left rail with
   * it, since the rail then had one entry left to show.
   *
   * Asked here the way the server asks it: whoever may book the project may give its client a
   * login, and the server's own checks were brought to the same line (`clientLoginFor`).
   */
  const { canWrite: salesManagerWrite } = useModuleAccess("SALES", "Sales Manager");
  const { canWrite: projectsWrite } = useModuleAccess("PROJECT", "Projects");
  const { canWrite: showAllProjectsWrite } = useModuleAccess("PROJECT", "Show All Projects");
  const mayCreateClientLogin = salesManagerWrite || projectsWrite || showAllProjectsWrite;
  const [clientLogin, setClientLogin] = useState(emptyClientLogin);
  const [showClientLoginProblems, setShowClientLoginProblems] = useState(false);
  // The client's username: their mobile number, from Client Main Number - followed as it is typed.
  const clientUsername = clientUsernameFor(form.clientMainNumber);
  // The server's refusal of a number that already has a login, shown on the Username for as long as
  // the number is still that one.
  const [clientLoginTaken, setClientLoginTaken] = useState(null);
  // A returning client: the login their number already has. Then no new one is made - this project
  // shows in their app through the number - and the section says so instead of asking for a password.
  // Kept with the number it was asked for, so a changed number never shows another client's answer.
  const [loginLookup, setLoginLookup] = useState({ username: "", login: null });
  useEffect(() => {
    if (mode !== "create" || !clientUsername) return undefined;
    let active = true;
    getClientLoginByNumber(clientUsername)
      .then((response) => { if (active) setLoginLookup({ username: clientUsername, login: response?.data || null }); })
      .catch(() => { if (active) setLoginLookup({ username: clientUsername, login: null }); });
    return () => { active = false; };
  }, [mode, clientUsername]);
  const existingClientLogin = mode === "create" && clientUsername && loginLookup.username === clientUsername ? loginLookup.login : null;
  const clientLoginErrors = useMemo(
    () => ({
      ...(showClientLoginProblems ? clientLoginProblems(clientLogin, { clientMainNumber: form.clientMainNumber }) : {}),
      ...(clientLoginTaken && clientLoginTaken.username === clientUsername ? { username: clientLoginTaken.message } : {}),
    }),
    [clientLogin, clientLoginTaken, clientUsername, form.clientMainNumber, showClientLoginProblems],
  );
  const updateClientLogin = useCallback((field, value) => {
    setClientLogin((current) => ({ ...current, [field]: value }));
  }, []);
  // The section sits last on a long form, so a problem in it is scrolled to rather than only named.
  const showClientCredentials = () => document.getElementById("client-credentials")?.scrollIntoView({ behavior: "smooth", block: "start" });
  /*
   * The draft already saved for the chosen enquiry, offered until it is answered.
   *
   * Worked out from the enquiry rather than set by an effect: `form.enquiryId` only changes when an
   * enquiry is picked, never per keystroke, so the question comes up exactly once per choice.
   * "Create new" is remembered for that enquiry so it is not asked again; the old draft is left
   * where it is and is deleted when this project is saved.
   */
  const [declinedDraftFor, setDeclinedDraftFor] = useState([]);
  const chosenEnquiry = String(form.enquiryId || "").trim();
  const draftOffer = useMemo(() => {
    if (mode !== "create" || !findDraft || !onUseDraft || !chosenEnquiry || declinedDraftFor.includes(chosenEnquiry)) return null;
    const existing = findDraft(chosenEnquiry);
    return existing && existing.id !== draftId ? existing : null;
  }, [mode, findDraft, onUseDraft, chosenEnquiry, declinedDraftFor, draftId]);
  const startNewOverDraft = () => setDeclinedDraftFor((current) => [...current, chosenEnquiry]);
  /*
   * Nothing greys the button out. It is blue whenever the form is open, and pressing it always
   * runs `submit`, which is the only thing that refuses and the only thing that can say why.
   *
   * It used to grey out while the sale was incomplete, the advance unfinished, or an edit
   * unchanged — three different reasons wearing one disabled state, none of them named. A disabled
   * button cannot submit, so the marks on the outstanding fields and the message above them could
   * never be reached: the form said no and declined to explain, which reads as the button being
   * broken or the user being barred rather than as three fields still wanting an answer.
   *
   * `isSaving` is the one thing that still stops a press, and only to keep a save in flight from
   * being sent twice. It stays blue for it — dimmed and labelled "Saving...", which reads as work
   * in progress rather than as permission withheld.
   */
  // The rail lists what is actually on screen, so a form with no Payment Received section has no
  // entry pointing at one.
  const sections = useMemo(() => [
    // Extra lists what changed after booking, so it exists only once there is a project to change.
    ["project", "Project", projectSectionLinks.filter(([id]) => (id !== "payment-received" || (mode === "create" && showAdvance)) && (id !== "sale-extras" || mode === "edit"))],
    ...(mayCreateClientLogin ? [CLIENT_CREDENTIALS_LINK] : []),
  ], [mayCreateClientLogin, mode, showAdvance]);

  const update = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  /*
   * Signed Quotation, where no quotation answers it, follows what the lines come to.
   *
   * A project line stores no price, so a project booked without a quotation - from nothing, from a
   * CRM lead, from a duplicate, or edited on Edit Sale Details - had Signed Quotation at ₹0 however
   * many services and deliverables it held, and every Schedule Payment row a share of nothing. The
   * lines are now priced at their Settings prices (`projectLinesAmount`, the generator's own
   * totals) and, where the form opened with no figure, the figure follows them as they change.
   *
   * Never over an answer somebody gave. A figure the form opened with - a saved project's, a lead's,
   * a duplicate's, a draft's - stands, and the note beside it says what the lines come to instead;
   * typing a figure stops it following, and clearing the box hands it back to the lines. A linked
   * quotation's figure is that document's, read-only, and is never touched. Nothing follows while the
   * lines or their Settings are still loading, or could not be loaded.
   */
  const linesOpen = mode === "edit"
    ? !plan.loading && !plan.loadingMasterData && !plan.sectionProps.serviceDefinitionsError && !plan.sectionProps.deliverableDefinitionsError
    : !isLoadingMasterData && !loadingQuotedPlan && !serviceDefinitionsError && !deliverableDefinitionsError;
  const lines = mode === "edit" ? plan.sectionProps : { shoots: form.shoots, servicesByShoot, deliverablesByShoot, serviceDefinitions, deliverableDefinitions };
  const linesPricing = useMemo(() => projectLinesAmount({
    services: Object.values(lines.servicesByShoot || {}).flat(),
    deliverables: Object.values(lines.deliverablesByShoot || {}).flat(),
    serviceDefinitions: lines.serviceDefinitions || [],
    deliverableDefinitions: lines.deliverableDefinitions || [],
    shoots: lines.shoots || [],
  }), [lines.servicesByShoot, lines.deliverablesByShoot, lines.serviceDefinitions, lines.deliverableDefinitions, lines.shoots]);
  const quotationLinked = Boolean(String(form.quotationId || "").trim());
  const [signedFollowsLines, setSignedFollowsLines] = useState(() => !(Number(form.initialConvertedValue) > 0));
  /*
   * Worked out rather than written back by an effect: the figure shown, validated and saved is the
   * lines' sum while the form follows them, and the box's own value otherwise. A sum of nothing is
   * not followed - an empty box stays empty, a saved ₹0 stays ₹0.
   */
  const followingLines = linesOpen && !quotationLinked && signedFollowsLines && (linesPricing.amount > 0 || Number(form.initialConvertedValue) > 0);
  const signedQuotation = followingLines ? String(linesPricing.amount) : form.initialConvertedValue;
  const linesRupees = `₹${linesPricing.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const unpricedWords = linesPricing.unpriced ? ` ${linesPricing.unpriced} ${linesPricing.unpriced === 1 ? "line has" : "lines have"} no price in Settings and ${linesPricing.unpriced === 1 ? "counts" : "count"} ₹0.` : "";
  const signedQuotationNote = quotationLinked || !linesOpen || !linesPricing.amount
    ? ""
    : followingLines
      ? `What the services and deliverables come to at their Settings prices.${unpricedWords} Type over it to set your own.`
      : Number(signedQuotation) === linesPricing.amount
        ? ""
        : `The services and deliverables come to ${linesRupees} at their Settings prices.${unpricedWords} Clear the box to use that figure.`;

  /*
   * The payments this booking's own Schedule Payment lays down, for the advance's "Settles Payment":
   * none is saved yet, so each is named by its place among the rows the save keeps, and the booking
   * panel names the saved payment once the schedule is written (`ProjectBookingPanel`).
   */
  const bookingPayments = useMemo(() => (mode === "create" ? scheduleSavePayload(schedulePayments) : [])
    .map((row, index) => ({ id: `${bookingSchedulePrefix}${index}`, category: row.category, dueDate: row.date || null, pending: amountForPercentage(row.percentage, signedQuotation) }))
    .filter((payment) => payment.pending > 0), [mode, schedulePayments, signedQuotation]);

  /*
   * The advance is the schedule's first payment unless said otherwise: until Settles Payment is
   * answered by hand (None included), it reads as that payment, so an advance taken at booking clears
   * or part-pays it rather than leaving it to turn Overdue. Only what was typed counts as starting
   * the section (`advanceStarted`), so the default never makes the advance required.
   */
  const [advanceSettleChosen, setAdvanceSettleChosen] = useState(false);
  const advanceShown = useMemo(() => withSettledPayment(
    !advanceSettleChosen && !advance.settlesPayment && bookingPayments.length ? { ...advance, settlesPayment: bookingPayments[0].id } : advance,
    bookingPayments,
  ), [advance, advanceSettleChosen, bookingPayments]);

  const updateAdvance = useCallback((field, value) => {
    if (field === "settlesPayment") setAdvanceSettleChosen(true);
    // Against the payment as drawn, the first one included while it is still the default.
    setAdvance((current) => settleChange(
      !advanceSettleChosen && !current.settlesPayment && bookingPayments.length ? { ...current, settlesPayment: bookingPayments[0].id } : current,
      field,
      value,
      bookingPayments,
    ));
  }, [advanceSettleChosen, bookingPayments]);

  /** Creating: the quoted rows leave, and whatever was added by hand stays. */
  function clearQuotedPlanFromForm() {
    replaceQuotedPlanInForm({ shoots: [], services: [], deliverables: [] });
  }

  /**
   * Creating: the quotation's rows become the pending plan, replacing the last quotation's.
   *
   * Only the rows a quotation put there are replaced. A shoot somebody added by hand - which is
   * only possible while the chosen quotation carried none - is theirs and survives the switch,
   * along with its services and deliverables.
   *
   * `fromQuotation` is what marks the difference, and is also what closes the shoot controls: a
   * shoot the client agreed to pay for is not the booking clerk's to rewrite on the way in. It goes to
   * the server as `fromQuotation`, which makes the shoot Sale Extras' baseline - where a row came from.
   */
  function replaceQuotedPlanInForm(quoted) {
    const quotedShoots = quoted.shoots.map((shoot) => ({ ...shoot, fromQuotation: true }));
    /*
     * The ids that survive, read from this render rather than from inside the updater below.
     * An updater runs when React chooses to and must stay pure, so a value assigned inside one is
     * not a value the next two lines can use.
     */
    const keptShootIds = new Set(form.shoots.filter((shoot) => !shoot.fromQuotation).map((shoot) => shoot.id));
    setForm((current) => ({ ...current, shoots: shootListOrder([...current.shoots.filter((shoot) => !shoot.fromQuotation), ...quotedShoots]) }));
    // The allocations follow their shoots: the ones belonging to rows just dropped go with them,
    // and the new quotation's arrive priced and named.
    const survives = (row) => keptShootIds.has(row.shootId);
    pendingLines.replaceServices([...serviceAllocationsRef.current.filter(survives), ...quoted.services.map((row) => normalizePendingService(row, serviceDefinitions))]);
    pendingLines.replaceDeliverables([...deliverableAllocationsRef.current.filter(survives), ...quoted.deliverables.map((row) => normalizePendingDeliverable(row, deliverableDefinitions))]);
  }

  /*
   * Editing: the project exists, so the rows are written to it the way the section writes them.
   *
   * The shoots go first and in one call, because each needs the server-issued id its allocations
   * hang off. An allocation that will not save is skipped rather than abandoning the rest - a
   * retired service definition should cost its own row, not the whole plan - and the section is
   * re-read at the end so what is on screen is what the server actually holds.
   */
  async function writeQuotedPlanToProject(quoted) {
    const response = await saveProjectShoots(project.id, quoted.shoots.map(({ id, clientKey, ...shoot }) => shoot));
    const created = Array.isArray(response?.data) ? response.data : [];
    // Paired by position: the shoots come back in the order they were sent.
    for (const [index, quotedShoot] of quoted.shoots.entries()) {
      const shoot = created[index];
      if (!shoot) continue;
      for (const row of quoted.services.filter((service) => service.shootId === quotedShoot.id)) {
        if (!row.serviceDefinitionId) continue;
        try {
          await createProjectServiceAllocation(project.id, shoot.id, {
            serviceDefinitionId: row.serviceDefinitionId,
            quantity: row.quantity === "" ? null : Number(row.quantity),
            sessionOptionId: row.sessionOptionId || null,
            durationHours: row.durationHours === "" ? null : Number(row.durationHours),
            durationMinutes: row.durationMinutes === "" ? null : Number(row.durationMinutes),
            workDays: row.workDays === "" ? null : Number(row.workDays),
            timingMinutes: row.timingMinutes === "" ? null : Number(row.timingMinutes),
            sizeOptionValueId: row.sizeOptionValueId || null,
            remarks: row.remarks || null,
          });
        } catch {
          // Skipped, and the refresh below shows what did land.
        }
      }
      for (const row of quoted.deliverables.filter((deliverable) => deliverable.shootId === quotedShoot.id)) {
        if (!row.deliverableDefinitionId) continue;
        try {
          await createProjectDeliverableAllocation(project.id, shoot.id, {
            deliverableDefinitionId: row.deliverableDefinitionId,
            quantity: Number(row.quantity || 1),
            numberOfPhotos: row.numberOfPhotos === "" ? null : Number(row.numberOfPhotos),
            sizeOptionValueId: row.sizeOptionValueId || null,
            size: row.size || null,
            remarks: row.remarks || null,
            variant: deliverableVariantPayload(row),
          });
        } catch {
          // As above.
        }
      }
    }
    await plan.load();
  }

  /*
   * The shoots, services and deliverables the chosen quotation was priced on.
   *
   * A quotation is built in this same Service Creation section, so what was quoted is already the
   * plan the project starts from - and the studio was retyping it, which is a chance to plan
   * something other than what the client agreed to pay for. Picking a quotation brings it across
   * instead; every row stays editable afterwards.
   *
   * Additive, never destructive, in both modes. A shoot the project already has - matched on name,
   * day and place rather than on an id neither side shares - is left exactly as it is, adjustments
   * and all. That is a safety rule on an edit: a project shoot carries cash entries, payment
   * request expenses and client storage records, and its deliverables go with it under
   * `ON DELETE CASCADE`, so replacing a live project's shoots with a quotation's would take real
   * money records with them.
   *
   * Waits for the service and deliverable definitions, so rows arrive named and priced rather than
   * as bare ids the section cannot render.
   */
  useEffect(() => {
    const quotationId = String(form.quotationId || "").trim();
    if (!quotationId) {
      appliedQuotationRef.current = "";
      /*
       * No quotation, no quoted shoots.
       *
       * Choosing a different enquiry clears the quotation - the two belong together - and the
       * shoots priced under the old one would otherwise stay on the form and be booked against the
       * new enquiry. Only the rows a quotation put there go; anything added by hand is kept.
       *
       * Guarded on there being something to drop, so the first render of an empty form does not
       * set state for the sake of removing nothing.
       */
      if (mode === "create" && form.shoots.some((shoot) => shoot.fromQuotation)) clearQuotedPlanFromForm();
      return undefined;
    }
    const rowId = String(form.quotationRowId || "").trim();
    /*
     * The flag that belongs to this mode, and only that one.
     *
     * `plan` is `useProjectPlan(null)` while creating, and its `loadingMasterData` starts `true`
     * and is only cleared by a `load()` that returns early without a project - so consulting it
     * here left the guard permanently closed and no quotation ever reached a new project.
     */
    const masterDataLoading = mode === "edit" ? plan.loading : isLoadingMasterData;
    if (!readyToBringPlan({ quotationId, quotationRowId: rowId, appliedQuotationId: appliedQuotationRef.current, masterDataLoading })) return undefined;

    let active = true;
    async function bringQuotedPlan() {
      // Inside the async function rather than in the effect body: a setState run synchronously as
      // the effect commits cascades a render before this has asked the server anything.
      setLoadingQuotedPlan(true);
      try {
        const response = await getSalesQuotation(rowId);
        if (!active) return;
        const makeKey = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        const quoted = planFromQuotation(response?.data?.payload, makeKey);
        // Marked applied whatever came back, so a quotation carrying no shoots is not re-fetched
        // on every render for the sake of finding nothing again.
        appliedQuotationRef.current = quotationId;
        /*
         * Creating: the pending plan *is* the chosen quotation's, so changing the quotation changes
         * the shoots.
         *
         * It used to add what was missing and keep everything already there, which read as the
         * right thing on one reading - nothing is ever lost - and was wrong on the screen: picking
         * a second quotation left the first one's shoots sitting above it, and the project was
         * booked against a plan that was neither quotation. Nothing here is saved yet, so there is
         * nothing to protect: the rows are replaced.
         *
         * Editing stays additive, and that is a safety rule rather than an inconsistency. A project
         * shoot carries cash entries, payment request expenses and client storage records, and its
         * deliverables go with it under `ON DELETE CASCADE` - replacing a live project's shoots
         * with a quotation's would take real money records with them.
         */
        if (mode === "edit") {
          const missing = unplannedPart(quoted, plan.shoots);
          if (!missing.shoots.length) return;
          await writeQuotedPlanToProject(missing);
          return;
        }
        replaceQuotedPlanInForm(quoted);
      } catch (quotationError) {
        // Left unmarked, so re-picking the quotation tries again. The plan is still built by hand
        // as it always was; failing to read a quotation must not stop a project being booked.
        setError(quotationError.message || "Unable to read the shoots from that quotation.");
      } finally {
        if (active) setLoadingQuotedPlan(false);
      }
    }
    void bringQuotedPlan();
    return () => { active = false; };
    // `plan.shoots` and `form.shoots` are read to decide what is replaced or still missing, not
    // depended on: a shoot added by hand must not re-run this and bring the quotation in again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.quotationId, form.quotationRowId, isLoadingMasterData, plan.loading, mode]);

  /*
   * Booking a duplicate: the source project's plan is laid down as this form's own pending rows.
   *
   * Deliberately not marked `fromQuotation`. That flag closes every control in Service Creation,
   * which is right for a plan the client has agreed to pay for and wrong for this one - a duplicate
   * is the same package being sold to somebody else, and the dates, the venue and the quantities are
   * exactly what the person is here to change. Everything arrives editable.
   *
   * Waits for the definitions, because a row is normalised against them: seeded before they land,
   * every service would render as a bare id with no name, no price and no session options.
   *
   * A definition that has since been retired is dropped rather than carried. The create endpoint
   * refuses the whole project over one ("Select a valid active service."), so carrying it would turn
   * a copy into a form that cannot be saved and does not say why; the section is left short by that
   * row instead, and `droppedFromDuplicate` below says so above the shoots it was dropped from.
   */
  useEffect(() => {
    if (mode !== "create" || !prefillPlan || seededDuplicateRef.current || isLoadingMasterData) return;
    seededDuplicateRef.current = true;
    const serviceIds = new Set(serviceDefinitions.map((definition) => definition.id));
    const deliverableIds = new Set(deliverableDefinitions.map((definition) => definition.id));
    const services = (prefillPlan.services || []).filter((row) => serviceIds.has(row.serviceDefinitionId));
    const deliverables = (prefillPlan.deliverables || []).filter((row) => deliverableIds.has(row.deliverableDefinitionId));
    setForm((current) => ({ ...current, shoots: shootListOrder(prefillPlan.shoots || []) }));
    pendingLines.replaceServices(services.map((row) => normalizePendingService(row, serviceDefinitions)));
    pendingLines.replaceDeliverables(deliverables.map((row) => normalizePendingDeliverable(row, deliverableDefinitions)));
    // Seeded once, guarded by the ref above; the definitions are read at that moment rather than
    // depended on, so a later refresh of them does not lay the plan down a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prefillPlan, isLoadingMasterData]);

  /*
   * The studio accounts and the employees the advance can be credited to.
   *
   * Read from the projects module's own endpoint, not Accounts'. Accounts' options sit behind
   * `ACCOUNTS / Cash Management` - the permission the person booking a project deliberately does not
   * need - so once this section was shown to them the Receiver dropdown came back empty for exactly
   * those people. A required field with nothing in it, which stopped the project being created at
   * all: worse than not showing them the section in the first place.
   *
   * Fetched only while the section is on screen, and an unreachable list still leaves the dropdowns
   * empty saying so, which is what Accounts' own form does.
   */
  useEffect(() => {
    if (!showAdvance) return undefined;
    let alive = true;
    getProjectAdvanceOptions()
      .then((response) => { if (alive) setCashOptions(response?.data || {}); })
      .catch(() => { if (alive) setCashOptions({}); });
    return () => { alive = false; };
  }, [showAdvance]);

  /**
   * The advance's field list reads its dropdowns from here, the same shape Accounts' form builds.
   *
   * No project, shoot or branch among them: the entry is filed against the project being created,
   * and the branch is that project's Source Branch, read on the server when it is saved.
   */
  /*
   * Read even when the section is hidden, which costs one small request: the hook cannot be called
   * conditionally, and Payment Received appears the moment somebody holds ACCOUNTS / Cash
   * Management. `cashOptions.paymentModes` is the same list read on the server, and stands in
   * while Field Settings is being read.
   */
  const paymentModeOptions = usePaymentModes(cashOptions?.paymentModes);

  const advanceContext = useMemo(() => ({
    /*
     * What each payment mode asks for. Without these the follow-up fields fell back to the arrays
     * compiled into `accountsConfig`, so a mode the studio added asked for nothing and a mode it
     * renamed stopped asking - the same drift Cash Received was fixed for.
     */
    modesWithTransactionId: paymentModeOptions.modesWithTransactionId,
    modesWithAccount: paymentModeOptions.modesWithAccount,
    modesWithDetails: paymentModeOptions.modesWithDetails,
    // The schedule being booked, as the payments the advance may settle.
    openPayments: bookingPayments,
    options: {
      /*
       * The studio's own payment modes, the same list and the same fallbacks Cash Received offers.
       *
       * This context was built by hand and this key was simply missing, so the field config's
       * `options: "paymentModes"` resolved to nothing: the **Payment Mode** dropdown opened empty,
       * and since the advance is required in full, a project could not be created at all by anyone
       * who could see the section.
       */
      paymentModes: paymentModeOptions.paymentModes,
      accounts: cashOptions?.accounts || [],
      handlers: [
        ...(cashOptions?.employees || []).map((employee) => ({
          value: String(employee.id),
          label: `${employee.employeeName}${employee.employeeId ? ` · ${employee.employeeId}` : ""}`,
          avatar: avatarOf(employee),
        })),
        { value: OTHER_HANDLER, label: "Other" },
      ],
    },
  }), [bookingPayments, cashOptions, paymentModeOptions]);

  /*
   * What the advance still wants, keyed by field so each outstanding answer is marked on the box it
   * belongs to. Below `advanceContext` because it is read against it: which fields the section is
   * showing depends on the answers so far — a UPI payment asks for a transaction ID, cash asks for
   * neither that nor an account — and a field that is not on screen must never be required.
   */
  /*
   * Whether anybody has begun filling the advance in.
   *
   * Compared against the values the section opens with rather than testing fields by name, so a
   * field added to it is counted without this having to be told. A section nobody has touched asks
   * for nothing; one touched anywhere is answered in full, because half a cash entry is not a
   * payment anybody can reconcile.
   */
  const advanceStarted = showAdvance && Object.entries(projectAdvanceInitialValues)
    .some(([field, blank]) => String(advance?.[field] ?? "") !== String(blank ?? ""));
  const advanceProblems = advanceStarted ? cashEntryProblems(advanceShown, { requireLink: false, sections: projectAdvanceFormSections, context: advanceContext }) : {};
  const advanceErrors = showProblems ? advanceProblems : {};

  useEffect(() => {
    if (mode !== "create") return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      setIsLoadingMasterData(true);
      setServiceDefinitionsError("");
      setDeliverableDefinitionsError("");
      Promise.allSettled([getProjectServiceDefinitions(), getProjectDeliverableDefinitions()]).then(([serviceResult, deliverableResult]) => {
        if (!alive) return;
        if (serviceResult.status === "fulfilled") setServiceDefinitions(Array.isArray(serviceResult.value?.data) ? serviceResult.value.data : []);
        else setServiceDefinitionsError(serviceResult.reason?.message || "Unable to load service definitions.");
        if (deliverableResult.status === "fulfilled") setDeliverableDefinitions(Array.isArray(deliverableResult.value?.data) ? deliverableResult.value.data : []);
        else setDeliverableDefinitionsError(deliverableResult.reason?.message || "Unable to load deliverable definitions.");
      }).finally(() => {
        if (alive) setIsLoadingMasterData(false);
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [mode]);

  /*
   * Whether the quotation brought the shoots, which is what decides the shoot controls.
   *
   * A project is booked against what the client agreed to pay for, so the whole quoted plan is
   * shown and not edited: no Add Shoot, no edit or delete on a shoot, and no adding, changing or
   * removing the services and deliverables underneath it either. The quotation priced those rows,
   * and a project that leaves this form with different ones is a project that no longer matches
   * what the client agreed to - quietly, since nothing afterwards compares the two.
   *
   * The exception is the quotation that carried no shoots at all - a price agreed before the days
   * were settled. There is nothing to plan against then, so the section is fully open: Add Shoot is
   * offered, and what is added by hand stays editable.
   */
  const shootsFromQuotation = form.shoots.some((shoot) => shoot.fromQuotation);
  /*
   * How much of a copied plan could not come across, counted rather than remembered.
   *
   * Derived from the same two lists the seeding effect filters on, so it cannot fall out of step
   * with what was actually laid down - and so that saying it costs no state and no second render.
   */
  const droppedFromDuplicate = useMemo(() => {
    if (!prefillPlan || isLoadingMasterData) return 0;
    const serviceIds = new Set(serviceDefinitions.map((definition) => definition.id));
    const deliverableIds = new Set(deliverableDefinitions.map((definition) => definition.id));
    return (prefillPlan.services || []).filter((row) => !serviceIds.has(row.serviceDefinitionId)).length
      + (prefillPlan.deliverables || []).filter((row) => !deliverableIds.has(row.deliverableDefinitionId)).length;
  }, [prefillPlan, isLoadingMasterData, serviceDefinitions, deliverableDefinitions]);

  async function addShoots(rows) {
    const makeKey = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setForm((current) => {
      const hasNewMainEvent = rows.some((row) => row.isMainEvent);
      // In date order, undated last - the order the project will list them in once it is saved.
      return { ...current, shoots: shootListOrder([...(hasNewMainEvent ? current.shoots.map((shoot) => ({ ...shoot, isMainEvent: false })) : current.shoots), ...rows.map((row) => {
      const clientKey = makeKey();
      return { ...row, dateCreated: row.dateCreated, id: clientKey, clientKey };
    })]) };
    });
    setIsShootDialogOpen(false);
  }

  async function saveShootDialog(rows) {
    if (editingShoot) {
      await savePendingShootEdit(editingShoot.shoot, editingShoot.index, rows[0]);
      setEditingShoot(null);
      setIsShootDialogOpen(false);
      return;
    }
    await addShoots(rows);
    setCopyingShoot(null);
  }

  function openAddShootDialog() {
    setEditingShoot(null);
    setCopyingShoot(null);
    setIsShootDialogOpen(true);
  }

  function openDuplicateShootDialog(shoot) {
    setEditingShoot(null);
    // The pending row's own keys stay behind: the copy is given its own when it is added.
    const { id: _id, clientKey: _clientKey, shootId: _shootId, ...values } = shoot;
    setCopyingShoot(values);
    setIsShootDialogOpen(true);
  }

  function openEditShootDialog(shoot, index) {
    setCopyingShoot(null);
    setEditingShoot({ shoot, index });
    setIsShootDialogOpen(true);
  }

  async function savePendingShootEdit(shoot, index, nextShoot) {
    // The edit lands on the row by its place, then the list is put back in date order: a re-dated shoot moves.
    setForm((current) => ({ ...current, shoots: shootListOrder(current.shoots.map((row, rowIndex) => {
      // The dialog's date as given - none when Shoot Date Known is No, never the row's old one.
      if (rowIndex === index) return { ...row, ...nextShoot, shootId: row.shootId, dateCreated: nextShoot.dateCreated || null };
      return nextShoot.isMainEvent ? { ...row, isMainEvent: false } : row;
    })) }));
  }

  async function deletePendingShoot(shoot) {
    setForm((current) => ({ ...current, shoots: current.shoots.filter((row) => row.id !== shoot.id) }));
    pendingLines.removeShootLines(shoot.id);
  }


  /*
   * A new project's shoots have no ids until it is saved, so a payment that follows one names it by
   * its place in the list sent (`dueShootIndex`); the booking panel swaps that for the id the save
   * hands back (`ProjectBookingPanel`).
   */
  function createScheduleWithShootPlaces() {
    return scheduleSavePayload(schedulePayments).map(({ dueShootId, ...row }) => {
      const index = dueShootId ? form.shoots.findIndex((shoot) => shoot.id === dueShootId) : -1;
      return { ...row, dueShootId: null, ...(index >= 0 ? { dueShootIndex: index } : {}) };
    });
  }

  function shootsPayload() {
    return form.shoots.map(({ id, clientKey, shootId, fromQuotation, ...shoot }) => ({
      ...shoot,
      // Sale Extras: a shoot the finalized quotation laid down is the project's baseline; one added
      // by hand is an extra from the start (`backend/.../sale-extras/booking.js`).
      ...(fromQuotation ? { fromQuotation: true } : {}),
      services: (servicesByShoot[id] || []).map(servicePayload),
      deliverables: (deliverablesByShoot[id] || []).map(deliverablePayload),
    }));
  }

  /*
   * Puts the form aside as it stands - nothing is checked, a draft is allowed to be half-finished.
   * The host stores it and closes the panel; a refusal (the browser's storage full) is said here,
   * with the form still open and nothing lost.
   */
  async function saveDraft() {
    setError("");
    try {
      await onSaveDraft(
        projectDraftSnapshot({ form, services: serviceAllocations, deliverables: deliverableAllocations, schedulePayments, advance, enquiryLocked }),
        { droppedFiles: draftDropsFiles(advance) },
      );
    } catch (draftError) {
      setError(draftError.message);
    }
  }

  async function submit(event, { draft = false } = {}) {
    event?.preventDefault();
    // The Signed Quotation on screen - the lines' sum while the form follows them - is the one saved.
    const form = { ...formState, initialConvertedValue: signedQuotation };
    /*
     * An edit that changed nothing closes rather than saves, and says nothing about it.
     *
     * This was the button's job until the button stopped refusing, and it is not cosmetic: the
     * PATCH claims the WhatsApp group name, and the generator row it claims from was already
     * consumed by the save before it — so re-sending an untouched sale can come back 409, "no
     * longer available", about a name the project has held all along. Closing is also what the
     * reader means by pressing Update on a form they have not touched.
     */
    if (mode === "edit" && !hasChanged(form, originalForm)) {
      /*
       * Only the schedule changed (opened with Edit): it is saved on its own, the sale is not sent
       * again - re-sending an untouched sale is what this branch exists to avoid. The same date check
       * the full save makes, and a sent-back project's Update to Project still returns it.
       */
      const scheduleChanged = canEditSchedule && JSON.stringify(scheduleSavePayload(schedulePayments)) !== JSON.stringify(scheduleSavePayload(loadedSchedule));
      if (scheduleChanged) {
        if (undatedPayments(schedulePayments, paymentCategories.settling).length) {
          setShowScheduleDateErrors(true);
          setError("Choose a date for every payment under Shedule Payment.");
          return;
        }
        setError("");
        setIsSaving(true);
        setSavingDraft(draft);
        try {
          await onSave(form, null, scheduleSavePayload(schedulePayments), { draft, scheduleOnly: true });
        } catch (saveError) {
          setError(saveError.message || "Unable to save the payment schedule.");
        } finally {
          setIsSaving(false);
          setSavingDraft(false);
        }
        return;
      }
      // A sent-back project's Update to Project still has its return to make - nothing else to save.
      if (sentBack && !draft) {
        setError("");
        setIsSaving(true);
        try {
          await onReturnToProjects();
        } catch (returnError) {
          setError(returnError.message || "Unable to return the project to Projects.");
        } finally {
          setIsSaving(false);
        }
        return;
      }
      onClose();
      return;
    }
    if (!saleFields.check(saleFieldProblems(form))) {
      setError("");
      return;
    }
    // Named where it now lives, so the message points at the box somebody has to go and fix rather
    // than at a field that used to be in Project Details.
    if (!Number.isFinite(Number(form.initialConvertedValue)) || Number(form.initialConvertedValue) < 0) {
      setError("Signed Quotation, under Shedule Payment, must be zero or a positive amount.");
      return;
    }
    // Every payment the schedule saves falls due on a day - except the one settling the balance.
    // Asked only where this save writes the schedule; the server refuses an undated one too.
    if ((mode === "create" || canEditSchedule) && undatedPayments(schedulePayments, paymentCategories.settling).length) {
      setShowScheduleDateErrors(true);
      setError("Choose a date for every payment under Shedule Payment.");
      return;
    }
    // A payment following a shoot taken off the list since: asked again rather than moved silently.
    if (mode === "create" && schedulePayments.some((row) => row.dateKnown === false && row.shootKey && !form.shoots.some((shoot) => shoot.id === row.shootKey))) {
      setError("A payment under Shedule Payment follows a shoot that was removed. Pick its shoot again.");
      return;
    }
    // Every answer the advance wants, marked where it sits rather than named one at a time. It
    // carries no project id — the project it belongs to does not exist yet, so the caller fills
    // that in once it does.
    if (Object.keys(advanceProblems).length) {
      setShowProblems(true);
      setError("Fill in the required fields in Payment Received before creating the project.");
      return;
    }
    // Every project made by somebody who may make a client login is made with one.
    // Except a returning client's: their number already has a login, which reaches this project too.
    const sendingClientLogin = mode === "create" && mayCreateClientLogin && !existingClientLogin;
    if (sendingClientLogin && Object.keys(clientLoginProblems(clientLogin, { clientMainNumber: form.clientMainNumber })).length) {
      setShowClientLoginProblems(true);
      setError("Complete the client's login under Client Credentials.");
      showClientCredentials();
      return;
    }
    setError("");
    setIsSaving(true);
    setSavingDraft(draft);
    try {
      // Only when there is one. An untouched section is a project booked with no advance, which is
      // ordinary - not an empty cash entry to be filed against it.
      const payment = advanceStarted ? cashEntryPayload(advanceShown, { projectId: null }, { openPayments: bookingPayments }) : null;
      // The client's login goes with the project; the message that hands it over is shown, once
      // both exist, by Client Login Ready (`ProjectBookingPanel`).
      await onSave({ ...form, shoots: mode === "create" ? shootsPayload() : undefined, clientLogin: sendingClientLogin ? clientLoginPayload(clientLogin, { clientMainNumber: form.clientMainNumber }) : null }, payment, mode === "create" ? createScheduleWithShootPlaces() : canEditSchedule ? scheduleSavePayload(schedulePayments) : null, { draft });
    } catch (saveError) {
      const message = saveError.message || "Unable to save project.";
      const onUsername = /^Client Credentials/.test(message) && /username|mobile number/i.test(message);
      // Said once: on the Username when it is about the number, otherwise above the form.
      setError(onUsername ? "Check the Username under Client Credentials." : message);
      // "Client Credentials: The mobile number … already has a client login …" - put it on the Username.
      if (onUsername) {
        setClientLoginTaken({ username: clientUsername, message: message.replace(/^Client Credentials[^:]*:\s*/, "") });
        showClientCredentials();
      }
    } finally {
      setIsSaving(false);
      setSavingDraft(false);
    }
  }

  return <SchemaFormPanel
    title={mode === "edit" ? "Edit Sale Details" : "Create Project"}
    sections={sections}
    sidebarAriaLabel="Project form sections"
    closeAriaLabel="Close project form"
    onClose={closePanel}
    onSubmit={guardedSubmit}
    error={(error === EXTRAS_PENDING && !extrasPublishPending ? "" : error) || saleFields.summary}
    zIndexClassName="z-[110]"
    footer={sentBack ? <>{extrasPublishPending && <p className="text-xs text-slate-500 max-sm:w-full sm:max-w-xs">Publish the Extra changes first.</p>}<Button type="button" variant="secondary" disabled={isSaving} onClick={discardChanges} className="max-sm:w-full">Discard</Button><Button type="button" variant="secondary" disabled={isSaving || extrasPublishPending} title={extrasPublishPending ? EXTRAS_PENDING : "Save the changes and keep the project under Sent Back"} onClick={saveSentBackDraft} className="max-sm:flex-1">{savingDraft ? "Saving..." : "Save Draft"}</Button><Button type="submit" variant="primary" disabled={isSaving || extrasPublishPending} title={extrasPublishPending ? EXTRAS_PENDING : "Save the changes and send the project to Projects → Yet to Start"} className="max-sm:flex-1">{isSaving && !savingDraft ? "Saving..." : "Update to Project"}</Button></> : <>{extrasPublishPending && <p className="text-xs text-slate-500 max-sm:w-full sm:max-w-xs">Publish the Extra changes first.</p>}<button type="button" disabled={isSaving} onClick={closePanel} className="min-h-10 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 max-sm:w-full">Discard Changes</button>{/* Held while a quotation's shoots are still arriving: saved then, the draft would name the
       quotation as brought in and never carry its shoots. */}{mode === "create" && onSaveDraft && <Button type="button" disabled={isSaving || loadingQuotedPlan} onClick={() => void saveDraft()} className="max-sm:flex-1">Save Draft</Button>}<button disabled={isSaving || extrasPublishPending} title={extrasPublishPending ? EXTRAS_PENDING : undefined} className={`min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-70 max-sm:flex-1 ${extrasPublishPending ? "disabled:cursor-not-allowed" : "disabled:cursor-wait"}`}>{isSaving ? "Saving..." : mode === "edit" ? "Update Project" : "Save Project"}</button></>}
  >
    <SchemaFormSection id="project-details" title="Project Details">
      {/*
        * Locked only when there is an enquiry to show, which is what `enquiryLocked` means.
        *
        * It asked `Boolean(project)`, and `project` on this panel is not only a booking being
        * edited - it is *whatever the form was opened with*: a converted lead, a quotation, or a
        * duplicate. The first two arrive naming their enquiry, so locking them was right by
        * accident. A duplicate deliberately arrives without one, because the whole point is to sell
        * the same package to somebody else - and it drew the picker as a settled value around an
        * empty string, so the one field the person had to answer was the one they could not reach.
        */}
      <SaleDetailsSection form={form} setForm={setForm} groupNames={groupNames} isLoadingGroupNames={isLoadingGroupNames} initialGroupNameMode={project || (draft && !draft.form?.whatsappGroupNameId) ? "manual" : "saved"} enquiryLocked={enquiryLocked} savedQuotationId={mode === "edit" ? project?.quotationId || "" : ""} errors={saleFields.errors} onFieldChange={saleFields.clear} />
    </SchemaFormSection>
    <SchemaFormSection id="sales-remarks" title="Sales Remarks"><div className="grid gap-4 md:grid-cols-2"><TextAreaField label="Pre Production Remarks" helperText="Add If you have any remarks for Pre Production" value={form.salesPreProductionRemarks} onChange={(value) => update("salesPreProductionRemarks", value)} /><TextAreaField label="Production Remarks" helperText="Add If you have any remarks for Production" value={form.salesProductionRemarks} onChange={(value) => update("salesProductionRemarks", value)} /><TextAreaField label="Post Production Remarks" helperText="Add If you have any remarks for Post Production" value={form.salesPostProductionRemarks} onChange={(value) => update("salesPostProductionRemarks", value)} /></div></SchemaFormSection>
    {/* Creating holds its shoots pending until the project exists; editing writes each change
        against the project it already has, through the shared plan editor. */}
    <SchemaFormSection id="service-creation" title="Service Creation"><div className="space-y-5">
      {/* Said out loud: rows appearing on their own is otherwise indistinguishable from the form
          having been left half-planned by somebody else. */}
      {loadingQuotedPlan && <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">Bringing in the shoots this quotation was priced on...</p>}
      {mode === "create"
        ? <ProjectServiceCreationSection
          shoots={form.shoots}
          loading={false}
          loadingMasterData={isLoadingMasterData}
          serviceDefinitionsError={serviceDefinitionsError}
          deliverableDefinitionsError={deliverableDefinitionsError}
          serviceDefinitions={serviceDefinitions}
          deliverableDefinitions={deliverableDefinitions}
          servicesByShoot={servicesByShoot}
          deliverablesByShoot={deliverablesByShoot}
          deliverableVariants
          sessionTimingColumn={false}
          shootListHint={shootsFromQuotation
            ? "The shoots this quotation was priced on. They are what the client agreed to, so they are shown here rather than edited."
            : droppedFromDuplicate
              ? `${draft ? "Restored from your draft." : "Copied from the project being duplicated."} ${droppedFromDuplicate} ${droppedFromDuplicate === 1 ? "row" : "rows"} could not be copied because the service or deliverable is no longer active — add what this project needs.`
              : duplicatePlan
                ? "Copied from the project being duplicated. Every shoot, service and deliverable here can be changed."
                : "Add one or more Shoots for this Project"}
          /* Absent, not disabled: with the shoots settled by the quotation there is nothing here
             for anybody to do, and a greyed-out row of controls only invites the question. */
          onAddShoot={shootsFromQuotation ? undefined : openAddShootDialog}
          onDeleteShoot={shootsFromQuotation ? undefined : deletePendingShoot}
          onRequestEditShoot={shootsFromQuotation ? undefined : openEditShootDialog}
          onDuplicateShoot={shootsFromQuotation ? undefined : openDuplicateShootDialog}
          /* Dragged into an order of its own, each draft shoot carries its place (`sortOrder`), and the
             project is created with the shoots in that order. Not on quoted shoots, like the rest. */
          onReorderShoots={shootsFromQuotation ? undefined : (keys) => setForm((current) => ({ ...current, shoots: reorderShoots(current.shoots, keys) }))}
          /* The rows the quotation priced, on the same rule as the shoots above them: shown, and
             not the booking clerk's to change. Without a quotation's shoots the section is the plan
             being built by hand, and all six come back. */
          onAddService={shootsFromQuotation ? undefined : pendingLines.addService}
          onUpdateService={shootsFromQuotation ? undefined : pendingLines.updateService}
          onDeleteService={shootsFromQuotation ? undefined : pendingLines.deleteService}
          onAddDeliverable={shootsFromQuotation ? undefined : pendingLines.addDeliverable}
          onUpdateDeliverable={shootsFromQuotation ? undefined : pendingLines.updateDeliverable}
          onDeleteDeliverable={shootsFromQuotation ? undefined : pendingLines.deleteDeliverable}
          onReorderServices={shootsFromQuotation ? undefined : pendingLines.reorderServices}
          onReorderDeliverables={shootsFromQuotation ? undefined : pendingLines.reorderDeliverables}
        />
        : <ProjectServiceCreationSection {...plan.sectionProps} sessionTimingColumn={false} />}
    </div></SchemaFormSection>
    {/* What changed on the plan since the finalized quotation was booked, priced by hand and published
        onto the client's quotation - above the schedule it never changes. */}
    {mode === "edit" && project?.id && <SchemaFormSection id="sale-extras" title="Extra – Additional & Removed Items">
      <SaleExtrasSection projectId={project.id} planSignature={planSignature} canWrite={mayCreateClientLogin} onPublishedChange={setPublishedExtra} onUnsavedChange={markExtrasUnsaved} onPublishPendingChange={setExtrasPublishPending} onPlanChanged={() => void plan.load()} />
      <ConfirmDialog {...extrasGuard.confirmProps} />
      <ConfirmDialog {...discardGuard.confirmProps} />
    </SchemaFormSection>}
    {/* The schedule is a share of what the project is signed for, which on this form is being typed
        as it goes - so it follows Initial Converted Value live rather than waiting for a save. */}
    {/* The figure the schedule is shares of, and the one place it is answered: it arrives from the
        chosen quotation and is corrected here rather than in a box up in the sale's own fields. */}
    <SchedulePaymentSection
      publishedExtra={mode === "edit" ? publishedExtra : null}
      ledger={mode === "edit" ? scheduleLedger : null}
      categories={paymentCategories}
      showDateErrors={showScheduleDateErrors}
      shoots={lines.shoots || []}
      readOnly={scheduleReadOnly}
      offerNewRow={mode === "edit" && canEditSchedule}
      signedQuotation={signedQuotation}
      /*
       * Offered only where no quotation answered it — the same rule the sale's own fields keep in
       * `setByQuotation`, and it decides on the quotation rather than on which job this panel is
       * doing.
       *
       * **A quotation was chosen**: the figure is that document's, and what the client was sent. It
       * is shown and not offered, on Create Project and on Edit Sale Details alike — retyping it
       * would leave the project and the quotation it converted at disagreeing, with nothing to say
       * which is right, and it was Edit Sale Details offering that box that let the amount be
       * changed by somebody the Projects permission was never meant to reach. Changing the quotation
       * changes the figure, which is the honest way to change it.
       *
       * **No quotation**: nobody has written the number down anywhere, so this is the box it gets
       * written in. New Project from nothing, a CRM lead that named no budget and a duplicate all
       * book this way, and closing the field for them left the money unrecordable — the project was
       * booked at zero with no way to say otherwise.
       *
       * Correcting it later is Project Management's, on Projects → Edit Project, where whoever is
       * scheduling against the figure is the one who finds out it is wrong.
       */
      onSignedQuotationChange={quotationLinked ? undefined : (value) => { setSignedFollowsLines(value === ""); update("initialConvertedValue", value); }}
      signedQuotationNote={signedQuotationNote}
      rows={schedulePayments}
      onChange={setSchedulePayments}
      onReceive={mode === "edit" && receiver.canReceive ? receiver.open : null}
      receivingId={receiver.openingId}
    />
    {receiver.payment && <ScheduledPaymentPanel key={receiver.payment.id} {...receiver.panelProps} />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {showAdvance && <SchemaFormSection id="payment-received" title="Payment Received">
      {/* Required in full: a project is created with the advance against it, not beside a promise
          of one. The section says none of this on screen — the fields are the same ones Accounts
          records money in with, each carrying its own asterisk, and a paragraph above them
          explaining the rule would be answering a question the heading has not raised. */}
      <div className="grid gap-4 md:grid-cols-2">
        {projectAdvanceFormSections.flatMap((section) => visibleFields(section.fields, advanceShown, advanceContext))
          .map((field) => <SchemaFormField key={field.name} field={field} values={advanceShown} onChange={updateAdvance} errors={advanceErrors} notes={settleNotes(advanceShown, advanceContext)} context={advanceContext} />)}
      </div>
    </SchemaFormSection>}
    {mayCreateClientLogin && <SchemaFormSection id="client-credentials" title="Client Credentials">
      {/* Made with the project on Create Project; on Edit Sale Details, shown - or made now, for a
          project booked without one. */}
      {mode === "create"
        ? existingClientLogin
          ? <ExistingClientLogin login={existingClientLogin} />
          : <ClientCredentialsSection value={clientLogin} username={clientUsername} onChange={updateClientLogin} errors={clientLoginErrors} disabled={isSaving} />
        : <ClientLoginEditSection projectId={project?.id} projectName={project?.whatsappGroupName} clientMainNumber={project?.clientMainNumber} />}
    </SchemaFormSection>}
    {/* The group name's own group type - "Dum Dum", "Qua Qua", "Corp" - which is what decides
        whether a shoot is asked who it is for. */}
    {mode === "create" && isShootDialogOpen && <AddShootDialog initialShoot={editingShoot?.shoot} copyOf={copyingShoot} existingShoots={form.shoots} vertical={form.groupType || form.vertical} onClose={() => { setIsShootDialogOpen(false); setEditingShoot(null); setCopyingShoot(null); }} onSave={saveShootDialog} />}
    {/* Answering is required, so the × is "Create new": it keeps the form as it is, and the draft is
        left untouched until this project is saved. */}
    {draftOffer && <Dialog
      layer="dialogOverPanel"
      title="A draft already exists for this enquiry"
      description={`“${draftOffer.title || `Enquiry #${draftOffer.enquiryId}`}” was saved ${draftSavedOn(draftOffer)} and is kept until ${draftKeptUntil(draftOffer)}. Use it to carry on where it was left, or create a new one - the draft is deleted when this project is saved.`}
      onClose={startNewOverDraft}
      footer={<>
        <Button type="button" onClick={startNewOverDraft}>Create new</Button>
        <Button type="button" variant="primary" onClick={() => onUseDraft(draftOffer)}>Use draft</Button>
      </>}
    />}
    {mode === "edit" && plan.shootDialog.open && <AddShootDialog initialShoot={plan.shootDialog.initialShoot} copyOf={plan.shootDialog.copyOf} existingShoots={plan.shootDialog.existingShoots} vertical={form.groupType || form.vertical} onClose={plan.shootDialog.onClose} onSave={plan.shootDialog.onSave} />}
  </SchemaFormPanel>;
}
