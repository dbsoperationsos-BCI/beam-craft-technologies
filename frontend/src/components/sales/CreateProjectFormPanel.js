"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddShootDialog from "@/components/project-management/AddShootDialog";
import SchedulePaymentSection, { paymentScheduleDefaults } from "@/components/project-management/SchedulePaymentSection";
import useProjectPlan from "@/components/project-management/useProjectPlan";
import ProjectServiceCreationSection from "@/components/project-management/ProjectServiceCreationSection";
import { autoDeliverableNamesForServices, blockedDeliverableNamesForServices, deliverableExistsForShoot, findDeliverableDefinitionByName } from "@/components/project-management/serviceDeliverableRules";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import SaleDetailsSection, { missingSaleFields, saleFieldsFromProject } from "@/components/sales/SaleDetailsSection";
import {
  OTHER_HANDLER,
  cashEntryPayload,
  cashEntryProblems,
  projectAdvanceFormSections,
  projectAdvanceInitialValues,
} from "@/constants/accountsConfig";
import usePaymentModes from "@/components/accounts/usePaymentModes";
import { createProjectDeliverableAllocation, createProjectServiceAllocation, getProjectDeliverableDefinitions, getProjectServiceDefinitions, saveProjectShoots } from "@/services/project-management/project-workflow.service";
import { getSalesQuotation, getProjectAdvanceOptions } from "@/services/sales/projects.service";
import { planFromQuotation, readyToBringPlan, unplannedPart } from "@/components/sales/quotationProjectPlan";

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
const createSectionLinks = [["project-details", "Project Details"], ["sales-remarks", "Sales Remarks"], ["service-creation", "Service Creation"], ["schedule-payment", "Shedule Payment"], ["payment-received", "Payment Received"]];
// An edit corrects the sale, not the money against it or the shoots planned for it: a payment
// already recorded is Accounts' to correct, on the project's own Payments tab.
/*
 * Editing a sale shows the same flow as creating one, minus Payment Received: the advance is
 * recorded once, when the project is created, and corrected afterwards in Accounts or on the
 * project's Payments tab. Showing it here would write a second cash entry on every save.
 */
const editSectionLinks = createSectionLinks.filter(([id]) => id !== "payment-received");

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

const groupRowsByShoot = (items) => (items || []).reduce((result, item) => ({ ...result, [item.shootId]: [...(result[item.shootId] || []), item] }), {});
const byId = (items) => new Map((items || []).map((item) => [item.id, item]));
const byName = (items) => new Map((items || []).map((item) => [item.name?.toLocaleLowerCase(), item]).filter(([name]) => name));

function normalizePendingService(row, definitions = []) {
  const definition = row.serviceDefinition || byId(definitions).get(row.serviceDefinitionId) || byName(definitions).get(row.serviceName?.toLocaleLowerCase());
  return {
    ...row,
    serviceDefinitionId: row.serviceDefinitionId || definition?.id || "",
    serviceDefinition: definition || null,
    serviceName: row.serviceName || definition?.name || "",
    quantity: row.quantity ?? 1,
    sessionOptionId: row.sessionOptionId || "",
    sessionOption: row.sessionOption || null,
    durationHours: row.durationHours ?? "",
    durationMinutes: row.durationMinutes ?? "",
    workDays: row.workDays ?? "",
    timingMinutes: row.timingMinutes ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    remarks: row.remarks || "",
  };
}

function normalizePendingDeliverable(row, definitions = []) {
  const definition = row.deliverableDefinition || byId(definitions).get(row.deliverableDefinitionId) || byName(definitions).get(row.deliverableName?.toLocaleLowerCase());
  return {
    ...row,
    deliverableDefinitionId: row.deliverableDefinitionId || definition?.id || "",
    deliverableDefinition: definition || null,
    deliverableName: row.deliverableName || definition?.name || "",
    quantity: row.quantity || 1,
    numberOfPhotos: row.numberOfPhotos ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    size: row.size || "",
    remarks: row.remarks || "",
  };
}

function hasChanged(form, originalForm) {
  return Object.keys(form).some((key) => JSON.stringify(form[key] ?? "") !== JSON.stringify(originalForm[key] ?? ""));
}

function TextAreaField({ label, helperText, value, onChange }) {
  return <label className="block text-xs font-semibold text-slate-600"><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 block min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />{helperText && <span className="mt-1 block text-xs font-normal text-slate-500">{helperText}</span>}</label>;
}


export default function CreateProjectFormPanel({ onClose, onSave, groupNames = [], isLoadingGroupNames = false, project = null, mode = "create", prefillPlan = null }) {
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
  const [originalForm] = useState(() => initialForm(project));
  const [form, setForm] = useState(() => originalForm);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // Not persisted yet - the rows reach no payload, here or in Start / Edit Project. Kept in step
  // with that form rather than saved from only one of the two.
  const [schedulePayments, setSchedulePayments] = useState(paymentScheduleDefaults);
  /*
   * Editing a sale edits a project that already exists, so its plan is read from the server and
   * every change is written straight back - the same hook, the same endpoints and the same careful
   * shoot deletion Start / Edit Project uses. Creating one has no project to write against yet, so
   * that path keeps its pending rows and sends them with the project.
   */
  const plan = useProjectPlan(mode === "edit" ? project?.id : null, { onError: setError });
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
  const [serviceAllocations, setServiceAllocations] = useState([]);
  const [deliverableAllocations, setDeliverableAllocations] = useState([]);
  const serviceAllocationsRef = useRef([]);
  const deliverableAllocationsRef = useRef([]);
  const [isShootDialogOpen, setIsShootDialogOpen] = useState(false);
  const [editingShoot, setEditingShoot] = useState(null);
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
  const appliedQuotationRef = useRef(project?.quotationRowId ? "" : project?.quotationId || "");
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
  const [advance, setAdvance] = useState(projectAdvanceInitialValues);
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
  const servicesByShoot = useMemo(() => groupRowsByShoot(serviceAllocations), [serviceAllocations]);
  const deliverablesByShoot = useMemo(() => groupRowsByShoot(deliverableAllocations), [deliverableAllocations]);
  // The rail lists what is actually on screen, so a form with no Payment Received section has no
  // entry pointing at one.
  const sections = useMemo(
    () => (mode === "create" ? createSectionLinks : editSectionLinks).filter(([id]) => id !== "payment-received" || showAdvance),
    [mode, showAdvance],
  );

  const update = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const updateAdvance = useCallback((field, value) => {
    setAdvance((current) => ({ ...current, [field]: value }));
  }, []);

  useEffect(() => {
    serviceAllocationsRef.current = serviceAllocations;
  }, [serviceAllocations]);

  useEffect(() => {
    deliverableAllocationsRef.current = deliverableAllocations;
  }, [deliverableAllocations]);

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

  /** Creating: the quoted rows leave, and whatever was added by hand stays. */
  function clearQuotedPlanFromForm() {
    replaceQuotedPlanInForm({ shoots: [], services: [], deliverables: [] });
  }

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
    setForm((current) => ({ ...current, shoots: prefillPlan.shoots || [] }));
    const nextServices = services.map((row) => normalizePendingService(row, serviceDefinitions));
    serviceAllocationsRef.current = nextServices;
    setServiceAllocations(nextServices);
    const nextDeliverables = deliverables.map((row) => normalizePendingDeliverable(row, deliverableDefinitions));
    deliverableAllocationsRef.current = nextDeliverables;
    setDeliverableAllocations(nextDeliverables);
    // Seeded once, guarded by the ref above; the definitions are read at that moment rather than
    // depended on, so a later refresh of them does not lay the plan down a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prefillPlan, isLoadingMasterData]);

  /**
   * Creating: the quotation's rows become the pending plan, replacing the last quotation's.
   *
   * Only the rows a quotation put there are replaced. A shoot somebody added by hand - which is
   * only possible while the chosen quotation carried none - is theirs and survives the switch,
   * along with its services and deliverables.
   *
   * `fromQuotation` is what marks the difference, and is also what closes the shoot controls: a
   * shoot the client agreed to pay for is not the booking clerk's to rewrite on the way in. It is
   * stripped again in `shootsPayload` - it says where a row came from, not what the shoot is.
   */
  function replaceQuotedPlanInForm(quoted) {
    const quotedShoots = quoted.shoots.map((shoot) => ({ ...shoot, fromQuotation: true }));
    /*
     * The ids that survive, read from this render rather than from inside the updater below.
     * An updater runs when React chooses to and must stay pure, so a value assigned inside one is
     * not a value the next two lines can use.
     */
    const keptShootIds = new Set(form.shoots.filter((shoot) => !shoot.fromQuotation).map((shoot) => shoot.id));
    setForm((current) => ({ ...current, shoots: [...current.shoots.filter((shoot) => !shoot.fromQuotation), ...quotedShoots] }));
    // The allocations follow their shoots: the ones belonging to rows just dropped go with them,
    // and the new quotation's arrive priced and named.
    const survives = (row) => keptShootIds.has(row.shootId);
    const nextServices = [...serviceAllocationsRef.current.filter(survives), ...quoted.services.map((row) => normalizePendingService(row, serviceDefinitions))];
    serviceAllocationsRef.current = nextServices;
    setServiceAllocations(nextServices);
    const nextDeliverables = [...deliverableAllocationsRef.current.filter(survives), ...quoted.deliverables.map((row) => normalizePendingDeliverable(row, deliverableDefinitions))];
    deliverableAllocationsRef.current = nextDeliverables;
    setDeliverableAllocations(nextDeliverables);
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
          });
        } catch {
          // As above.
        }
      }
    }
    await plan.load();
  }

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
        })),
        { value: OTHER_HANDLER, label: "Other" },
      ],
    },
  }), [cashOptions, paymentModeOptions]);

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
  const advanceProblems = advanceStarted ? cashEntryProblems(advance, { requireLink: false, sections: projectAdvanceFormSections, context: advanceContext }) : {};
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
      return { ...current, shoots: [...(hasNewMainEvent ? current.shoots.map((shoot) => ({ ...shoot, isMainEvent: false })) : current.shoots), ...rows.map((row) => {
      const clientKey = makeKey();
      return { ...row, dateCreated: row.dateCreated, id: clientKey, clientKey };
    })] };
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
  }

  function openAddShootDialog() {
    setEditingShoot(null);
    setIsShootDialogOpen(true);
  }

  function openEditShootDialog(shoot, index) {
    setEditingShoot({ shoot, index });
    setIsShootDialogOpen(true);
  }

  async function savePendingShootEdit(shoot, index, nextShoot) {
    setForm((current) => ({ ...current, shoots: current.shoots.map((row, rowIndex) => {
      if (rowIndex === index) return { ...row, ...nextShoot, shootId: row.shootId, dateCreated: nextShoot.dateCreated || row.dateCreated };
      return nextShoot.isMainEvent ? { ...row, isMainEvent: false } : row;
    }) }));
  }

  async function deletePendingShoot(shoot) {
    setForm((current) => ({ ...current, shoots: current.shoots.filter((row) => row.id !== shoot.id) }));
    setServiceAllocations((current) => {
      const next = current.filter((row) => row.shootId !== shoot.id);
      serviceAllocationsRef.current = next;
      return next;
    });
    setDeliverableAllocations((current) => {
      const next = current.filter((row) => row.shootId !== shoot.id);
      deliverableAllocationsRef.current = next;
      return next;
    });
  }

  async function addPendingService(shoot, definition) {
    const row = normalizePendingService({
      id: `pending-service-${shoot.id}-${definition.id}`,
      shootId: shoot.id,
      serviceDefinitionId: definition.id,
      serviceDefinition: definition,
      serviceName: definition.name,
    }, serviceDefinitions);
    const nextServices = [...serviceAllocationsRef.current, row];
    serviceAllocationsRef.current = nextServices;
    setServiceAllocations(nextServices);
    addPendingAutoDeliverablesForService(shoot, nextServices);
    return row;
  }

  function addPendingAutoDeliverablesForService(shoot, nextServices) {
    setDeliverableAllocations((current) => {
      const serviceNames = nextServices.filter((row) => row.shootId === shoot.id).map((row) => row.serviceName);
      const names = autoDeliverableNamesForServices(serviceNames);
      const blockedNames = blockedDeliverableNamesForServices(serviceNames);
      const nextRows = current.filter((row) => !(row.shootId === shoot.id && blockedNames.has(row.deliverableName)));
      names.filter((name) => !blockedNames.has(name)).forEach((name) => {
        const definition = findDeliverableDefinitionByName(deliverableDefinitions, name);
        if (!definition || deliverableExistsForShoot(nextRows, shoot.id, definition)) return;
        nextRows.push(normalizePendingDeliverable({
          id: `pending-deliverable-${shoot.id}-${definition.id}`,
          shootId: shoot.id,
          deliverableDefinitionId: definition.id,
          deliverableDefinition: definition,
          deliverableName: definition.name,
          quantity: 1,
        }, deliverableDefinitions));
      });
      deliverableAllocationsRef.current = nextRows;
      return nextRows;
    });
  }

  async function updatePendingService(row, data) {
    setServiceAllocations((current) => {
      const next = current.map((item) => item.id === row.id ? normalizePendingService({ ...item, ...data }, serviceDefinitions) : item);
      serviceAllocationsRef.current = next;
      return next;
    });
  }

  async function deletePendingService(row) {
    setServiceAllocations((current) => {
      const next = current.filter((item) => item.id !== row.id);
      serviceAllocationsRef.current = next;
      return next;
    });
  }

  async function addPendingDeliverable(shoot, definition) {
    const row = normalizePendingDeliverable({
      id: `pending-deliverable-${shoot.id}-${definition.id}`,
      shootId: shoot.id,
      deliverableDefinitionId: definition.id,
      deliverableDefinition: definition,
      deliverableName: definition.name,
      quantity: 1,
    }, deliverableDefinitions);
    setDeliverableAllocations((current) => {
      const next = [...current, row];
      deliverableAllocationsRef.current = next;
      return next;
    });
    return row;
  }

  async function updatePendingDeliverable(row, data) {
    setDeliverableAllocations((current) => {
      const next = current.map((item) => item.id === row.id ? normalizePendingDeliverable({ ...item, ...data }, deliverableDefinitions) : item);
      deliverableAllocationsRef.current = next;
      return next;
    });
  }

  async function deletePendingDeliverable(row) {
    setDeliverableAllocations((current) => {
      const next = current.filter((item) => item.id !== row.id);
      deliverableAllocationsRef.current = next;
      return next;
    });
  }

  function shootsPayload() {
    return form.shoots.map(({ id, clientKey, shootId, fromQuotation, ...shoot }) => ({
      ...shoot,
      services: (servicesByShoot[id] || []).map(({ serviceDefinitionId, quantity, sessionOptionId, durationHours, durationMinutes, workDays, timingMinutes, sizeOptionValueId, remarks }) => ({
        serviceDefinitionId,
        quantity: quantity === "" ? 1 : Number(quantity),
        sessionOptionId: sessionOptionId || null,
        durationHours: durationHours === "" ? null : Number(durationHours),
        durationMinutes: durationMinutes === "" ? null : Number(durationMinutes),
        workDays: workDays === "" ? null : Number(workDays),
        timingMinutes: timingMinutes === "" ? null : Number(timingMinutes),
        sizeOptionValueId: sizeOptionValueId || null,
        remarks: remarks || null,
      })),
      deliverables: (deliverablesByShoot[id] || []).map(({ deliverableDefinitionId, quantity, numberOfPhotos, sizeOptionValueId, remarks }) => ({
        deliverableDefinitionId,
        quantity: Number(quantity || 1),
        numberOfPhotos: numberOfPhotos === "" ? null : Number(numberOfPhotos),
        sizeOptionValueId: sizeOptionValueId || null,
        remarks: remarks || null,
      })),
    }));
  }

  async function submit(event) {
    event.preventDefault();
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
      onClose();
      return;
    }
    const missing = missingSaleFields(form);
    if (missing.length) {
      setError(`Complete required fields: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`);
      return;
    }
    // Named where it now lives, so the message points at the box somebody has to go and fix rather
    // than at a field that used to be in Project Details.
    if (!Number.isFinite(Number(form.initialConvertedValue)) || Number(form.initialConvertedValue) < 0) {
      setError("Signed Quotation, under Shedule Payment, must be zero or a positive amount.");
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
    setError("");
    setIsSaving(true);
    try {
      // Only when there is one. An untouched section is a project booked with no advance, which is
      // ordinary - not an empty cash entry to be filed against it.
      const payment = advanceStarted ? cashEntryPayload(advance, { projectId: null }) : null;
      await onSave({ ...form, shoots: mode === "create" ? shootsPayload() : undefined }, payment);
    } catch (saveError) {
      setError(saveError.message || "Unable to save project.");
    } finally {
      setIsSaving(false);
    }
  }

  return <SchemaFormPanel
    title={mode === "edit" ? "Edit Sale Details" : "Create Project"}
    sections={sections}
    sidebarAriaLabel="Project form sections"
    closeAriaLabel="Close project form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    zIndexClassName="z-[110]"
    footer={<><button type="button" disabled={isSaving} onClick={onClose} className="mr-auto min-h-10 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 max-sm:mr-0 max-sm:w-full">Discard Changes</button><button disabled={isSaving} className="min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70 max-sm:flex-1">{isSaving ? "Saving..." : mode === "edit" ? "Update Project" : "Save Project"}</button></>}
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
      <SaleDetailsSection form={form} setForm={setForm} groupNames={groupNames} isLoadingGroupNames={isLoadingGroupNames} initialGroupNameMode={project ? "manual" : "saved"} enquiryLocked={Boolean(project?.enquiryId)} />
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
          shootListHint={shootsFromQuotation
            ? "The shoots this quotation was priced on. They are what the client agreed to, so they are shown here rather than edited."
            : droppedFromDuplicate
              ? `Copied from the project being duplicated. ${droppedFromDuplicate} ${droppedFromDuplicate === 1 ? "row" : "rows"} could not be copied because the service or deliverable is no longer active — add what this project needs.`
              : prefillPlan
                ? "Copied from the project being duplicated. Every shoot, service and deliverable here can be changed."
                : "Add one or more Shoots for this Project"}
          /* Absent, not disabled: with the shoots settled by the quotation there is nothing here
             for anybody to do, and a greyed-out row of controls only invites the question. */
          onAddShoot={shootsFromQuotation ? undefined : openAddShootDialog}
          onSaveShootEdit={shootsFromQuotation ? undefined : savePendingShootEdit}
          onDeleteShoot={shootsFromQuotation ? undefined : deletePendingShoot}
          onRequestEditShoot={shootsFromQuotation ? undefined : openEditShootDialog}
          /* The rows the quotation priced, on the same rule as the shoots above them: shown, and
             not the booking clerk's to change. Without a quotation's shoots the section is the plan
             being built by hand, and all six come back. */
          onAddService={shootsFromQuotation ? undefined : addPendingService}
          onUpdateService={shootsFromQuotation ? undefined : updatePendingService}
          onDeleteService={shootsFromQuotation ? undefined : deletePendingService}
          onAddDeliverable={shootsFromQuotation ? undefined : addPendingDeliverable}
          onUpdateDeliverable={shootsFromQuotation ? undefined : updatePendingDeliverable}
          onDeleteDeliverable={shootsFromQuotation ? undefined : deletePendingDeliverable}
        />
        : <ProjectServiceCreationSection {...plan.sectionProps} />}
    </div></SchemaFormSection>
    {/* The schedule is a share of what the project is signed for, which on this form is being typed
        as it goes - so it follows Initial Converted Value live rather than waiting for a save. */}
    {/* The figure the schedule is shares of, and the one place it is answered: it arrives from the
        chosen quotation and is corrected here rather than in a box up in the sale's own fields. */}
    <SchedulePaymentSection
      signedQuotation={form.initialConvertedValue}
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
      onSignedQuotationChange={String(form.quotationId || "").trim() ? undefined : (value) => update("initialConvertedValue", value)}
      rows={schedulePayments}
      onChange={setSchedulePayments}
    />
    {showAdvance && <SchemaFormSection id="payment-received" title="Payment Received">
      {/* Required in full: a project is created with the advance against it, not beside a promise
          of one. The section says none of this on screen — the fields are the same ones Accounts
          records money in with, each carrying its own asterisk, and a paragraph above them
          explaining the rule would be answering a question the heading has not raised. */}
      <div className="grid gap-4 md:grid-cols-2">
        {projectAdvanceFormSections.flatMap((section) => visibleFields(section.fields, advance, advanceContext))
          .map((field) => <SchemaFormField key={field.name} field={field} values={advance} onChange={updateAdvance} errors={advanceErrors} context={advanceContext} />)}
      </div>
    </SchemaFormSection>}
    {/* The group name's own group type - "Dum Dum", "Qua Qua", "Corp" - which is what decides
        whether a shoot is asked who it is for. */}
    {mode === "create" && isShootDialogOpen && <AddShootDialog initialShoot={editingShoot?.shoot} existingShoots={form.shoots} vertical={form.groupType || form.vertical} onClose={() => { setIsShootDialogOpen(false); setEditingShoot(null); }} onSave={saveShootDialog} />}
    {mode === "edit" && plan.shootDialog.open && <AddShootDialog initialShoot={plan.shootDialog.initialShoot} existingShoots={plan.shootDialog.existingShoots} vertical={form.groupType || form.vertical} onClose={plan.shootDialog.onClose} onSave={plan.shootDialog.onSave} />}
  </SchemaFormPanel>;
}
