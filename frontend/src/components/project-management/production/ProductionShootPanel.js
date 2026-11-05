"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import FileUploadField from "@/components/shared/FileUploadField";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useUnsavedGuard, { useUnloadWarning } from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import ProductionActivityTab from "@/components/project-management/production/ProductionActivityTab";
import ProductionExecutionTab from "@/components/project-management/production/ProductionExecutionTab";
import { StepActionSlotProvider, StepListSlotProvider } from "@/components/project-management/production/StepActionSlot";
import ProductionFileList from "@/components/project-management/production/ProductionFileList";
import ProductionServiceCrew from "@/components/project-management/production/ProductionServiceCrew";
import ProductionUploadQueue from "@/components/project-management/production/ProductionUploadQueue";
import useProductionUploads from "@/components/project-management/production/useProductionUploads";
import { productionPlanSections } from "@/constants/productionFormConfig";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { assistMovedFromServices, keptNamesLine, productionPlanForm, productionPlanOptions, productionPlanPayload, TICKET_STATUS_OPTIONS, ticketSection } from "@/lib/productionPlan.mjs";
import { formatDay } from "@/lib/productionSteps.mjs";
import { getProductionOptions, getProductionShoot, removeProductionFile, saveProductionPlan, setProductionPlanStatus } from "@/services/project-management/production.service";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";
import ProductionPlanStatusField from "@/components/project-management/production/ProductionPlanStatusField";
import ProductionContextSummary from "@/components/project-management/production/ProductionContextSummary";
import { planStatusChange } from "@/lib/productionBoard.mjs";

const PLAN_TAB = { id: "plan", label: "Plan" };
const EXECUTION_TAB = { id: "execution", label: "Execution" };
const ACTIVITY_TAB = { id: "activity", label: "Activity" };

/**
 * One shoot's production, opened from the board: Plan, Execution and Activity.
 *
 * Phone first. `SchemaFormPanel` covers the whole screen below `sm` (`fixed inset-0 h-dvh`), so the
 * shoot opens full-screen on a phone rather than as a side pane; the tabs sit under the title and
 * the footer stays at the bottom.
 *
 * What the viewer may do comes from two answers together: `canWrite` (the route's permission,
 * READ_WRITE) and the shoot's own `canEditPlan` / `canRunSteps` from the API (being named on it).
 * The panel asks them itself, so a deep link or a double-click cannot open more than the viewer
 * holds; a control the viewer cannot use is absent, not disabled.
 *
 * Files go through `useProductionUploads`: one request per file, and a file that fails stays on the
 * phone with Retry. Closing while any are still waiting asks first (`useUnsavedGuard`), and so does a
 * refresh or a closed tab (`useUnloadWarning`).
 *
 * A file landing or being removed changes the shoot's files, not its plan: it refreshes the detail
 * only (`applyFiles`), so a Plan form being edited keeps its edits. Only a plan save or a step
 * resets the form to the server's copy (`applyDetail`). The board hears about uploads once, when
 * the queue drains, rather than once per photo on a slow venue network.
 *
 * `onBack`, when given, puts a back arrow in the header (opened from a project's tiles on the board,
 * or from its Status tab); it is guarded against unfinished uploads the same way Close is.
 * Saving or submitting the plan closes the panel (back to the tiles where it was opened from them),
 * as every other save button does.
 */
// The project and shoot as already known, read-only at the top of the Plan tab - as Pre Production's.
const PLAN_CONTEXT_SECTION = { id: "context", title: "Project & Shoot", fields: [{ name: "contextSummary", type: "custom", colSpan: 2 }] };
// The plan's own status, at the bottom of the Plan tab.
const PLAN_STATUS_SECTION = { id: "plan-status", title: "Status", fields: [{ name: "planStatusControl", type: "custom", colSpan: 2 }] };

export default function ProductionShootPanel({ shootId, summary = null, canWrite, onBack, onClose, onChanged }) {
  const [pickedTab, setTab] = useState(null);
  // Where the Execution step's action is drawn - a node in the footer, set once it mounts.
  const [stepActionNode, setStepActionNode] = useState(null);
  // Execution's step list, drawn in the panel's own left column from lg up, as the Plan's sections are.
  const [stepListNode, setStepListNode] = useState(null);
  const [detail, setDetail] = useState(null);
  // The coordinator's day is the steps, so they open on Execution (listed first), with the plan a tap
  // away to read; everybody else - the manager filling the plan - opens on Plan. A tab picked by hand
  // is kept.
  const runsSteps = Boolean(detail?.canRunSteps && !detail?.canEditPlan);
  // The log is the Production Manager's and above (`canEditPlan`), as the WhatsApp status is; the
  // server refuses it to anybody else too.
  const seesActivity = Boolean(detail?.canEditPlan);
  const tab = pickedTab || (runsSteps ? "execution" : "plan");
  const tabs = [...(runsSteps ? [EXECUTION_TAB, PLAN_TAB] : [PLAN_TAB, EXECUTION_TAB]), ...(seesActivity ? [ACTIVITY_TAB] : [])];
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(() => productionPlanForm(null));
  // Mark as pending and Submit plan share one busy flag, so the pressed one is remembered.
  const [pendingSave, setPendingSave] = useState(false);
  const [error, setError] = useState("");
  const { busy, run } = useSubmitOnce();
  // The boxes `submit` found blank; each clears its own mark when changed.
  const marks = useFormErrors();
  const { errors: marked, clear: clearMark } = marks;
  const update = useCallback((field, value) => {
    clearMark(field);
    setForm((current) => ({ ...current, [field]: value }));
  }, [clearMark]);

  const load = useCallback(async () => {
    try {
      const [shootResponse, optionsResponse] = await Promise.all([getProductionShoot(shootId), getProductionOptions()]);
      setDetail(shootResponse?.data || null);
      setForm(productionPlanForm(shootResponse?.data));
      setOptions(optionsResponse?.data || null);
    } catch (loadError) {
      setError(loadError.message || "Unable to load this shoot.");
    }
  }, [shootId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const planEditable = Boolean(canWrite && detail?.canEditPlan);
  // The server's answer alone: running the steps takes Production *or* Production Execution at
  // Read / Write, so somebody reading Production (`canWrite` false) may still run their shoot's.
  const stepsRunnable = Boolean(detail?.canRunSteps);
  const done = detail?.execution?.currentStep === "DONE";

  const applyDetail = useCallback((next, message) => {
    if (!next) return;
    setDetail(next);
    setForm(productionPlanForm(next));
    onChanged?.(message);
  }, [onChanged]);

  // A ticket upload can set the plan's travel mode itself (server-side); syncing only the form's
  // `travelMode` keeps that in step without reverting any other unsaved plan edit the manager still
  // has open, and without the field then disagreeing with what the server actually holds.
  const applyFiles = useCallback((next) => {
    if (!next) return;
    setDetail(next);
    if (next.plan?.travelMode !== undefined) update("travelMode", next.plan.travelMode || "");
  }, [update]);

  // Each file that lands refreshes the shoot quietly; the queue itself says how many are left.
  const uploads = useProductionUploads(shootId, applyFiles, useCallback(() => onChanged?.(), [onChanged]));

  const removeFile = useCallback(async (file) => {
    setError("");
    try {
      const response = await removeProductionFile(shootId, file.id);
      applyFiles(response?.data);
      onChanged?.(`${file.fileName} removed.`);
    } catch (removeError) {
      setError(removeError.message || "Unable to remove the file.");
    }
  }, [applyFiles, onChanged, shootId]);

  const { guard, confirmProps } = useUnsavedGuard(uploads.pending > 0, {
    title: "Files still uploading",
    message: `${uploads.pending} file${uploads.pending === 1 ? " has" : "s have"} not reached the server yet. Closing now loses ${uploads.pending === 1 ? "it" : "them"}.`,
    cancelLabel: "Stay",
    confirmLabel: "Close anyway",
  });
  useUnloadWarning(true, () => uploads.pending > 0);
  const requestClose = () => guard(onClose);

  const context = useMemo(() => {
    const lists = productionPlanOptions(options || {}, detail);
    const tickets = (detail?.files || []).filter((file) => file.kind === "TICKET");
    return {
      options: { employees: lists.employees, travelModes: lists.travelModes, vehicles: lists.vehicles, ticketStatuses: TICKET_STATUS_OPTIONS },
      // An indoor shoot has no travel, so Travel Mode is not asked of one (`productionFormConfig`).
      indoor: Boolean(detail?.indoor),
      // The asterisked answers are what the plan is counted on for Planned: each says Pending until filled.
      pendingTags: true,
      renderers: {
        contextSummary: function ContextSummaryRenderer() { return detail ? <ProductionContextSummary detail={detail} /> : null; },
        planStatusControl: ({ values, onChange }) => <ProductionPlanStatusField
          detail={detail}
          value={values.planStatusControl}
          onChange={(next) => {
            const current = values.planStatusControl || {};
            if (next.choice !== current.choice || next.remarks !== current.remarks) clearMark("planStatusRemarks");
            if (next.choice !== current.choice || next.followupDate !== current.followupDate) clearMark("planStatusFollowupDate");
            onChange(next);
          }}
          errors={{ remarks: marked.planStatusRemarks, followupDate: marked.planStatusFollowupDate }}
          readOnly={!planEditable}
        />,
        // Named from the old sheet and since left: read only, and kept by a save.
        keptNames: function KeptNamesRenderer() {
          const line = keptNamesLine(detail?.plan);
          // A wrapped box, not a one-line input: a long line is read in full at phone width.
          return line ? <TextAreaField label="No longer with the studio" helperText="Crew named on the old plan who have left; kept when you save." value={line} rows={2} readOnly /> : null;
        },
        // Each of the shoot's services with who works it - a person and their cameras - and then,
        // once, below the last of them, the shoot's Assist: who assists on the whole shoot.
        crew: function CrewRenderer({ values, onChange }) {
          const busy = new Set((detail?.busyCrewEmployeeIds || []).map((id) => `emp:${id}`));
          const chosen = new Set(values.assist || []);
          // Who can shoot (the Technical department) and the vendors, less anybody on another shoot at that
          // time - whoever is already chosen stays, so a saved plan never loses anybody.
          const assistOptions = (lists.people || []).filter((option) => chosen.has(option.value) || ((String(option.value).startsWith("ven:") || option.shooter) && !busy.has(option.value)));
          const moved = assistMovedFromServices(detail?.plan);
          return <div className="flex flex-col gap-4"><ProductionServiceCrew
            services={detail?.plan?.services || []}
            crew={values.crew || []}
            onChange={(next) => {
              next.forEach((row) => { if (row.role === "LEAD" && row.person) clearMark(`crew:${row.definitionId}`); });
              onChange(next);
            }}
            errors={Object.fromEntries((values.crew || []).map((row) => [row.definitionId, marked[`crew:${row.definitionId}`]]))}
            people={lists.people}
            busyEmployeeIds={detail?.busyCrewEmployeeIds}
            busyCameraAssetIds={detail?.busyCameraAssetIds}
            cameras={lists.cameras}
            readOnly={!planEditable}
          />
            <MultiSelectField
              label="Assist"
              values={values.assist || []}
              onChange={(next) => update("assist", [...new Set(next)])}
              options={assistOptions}
              placeholder="Search and select assistants"
              helperText={moved ? `${moved} assistant${moved === 1 ? "" : "s"} given to a service before are listed here; saving keeps them on the shoot.` : "Who assists on the whole shoot, across its services."}
              searchable
              readOnly={!planEditable}
            /></div>;
        },
        // Only Bus, Train and Flight take tickets, and the upload itself carries the mode being
        // picked - the server sets it on the plan, so tickets can be added the moment the mode is
        // picked, without saving the plan first. Tickets from an earlier mode stay listed under
        // their own heading, still removable by whoever edits the plan. A ticket photo is
        // compressed on the phone like every other picture; a PDF goes up as it is.
        tickets: function TicketsRenderer({ values }) {
          const section = ticketSection({ mode: values.travelMode, status: values.ticketStatus, tickets });
          if (!section) return null;
          const editable = planEditable && !done;
          return <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">{section.title}</span>
            <ProductionFileList shootId={shootId} files={tickets} canRemove={editable} onRemove={removeFile} emptyText="No tickets added." />
            <ProductionUploadQueue queue={uploads.queue} kind="TICKET" onRetry={uploads.retry} onDiscard={uploads.discard} />
            {editable && section.canAdd && tickets.length < 10 && <FileUploadField
              label="Add tickets"
              helperText="Bus, train or flight tickets for the crew, as PDF or photo."
              value={[]}
              onChange={(files) => uploads.add("TICKET", files, { travelMode: values.travelMode })}
              accept="application/pdf,image/jpeg,image/png,image/webp"
              maxFiles={10 - tickets.length}
              compressImages
              size="lg"
            />}
          </div>;
        },
      },
    };
  }, [clearMark, detail, done, marked, options, planEditable, removeFile, shootId, update, uploads]);

  /*
   * Saving the plan, as one of two acts.
   *
   * **Submit plan** says the plan is finished, and the server holds it to that: a coordinator, the
   * travel mode on an outdoor shoot, and a person on every service the shoot booked. **Mark as
   * pending** saves exactly what has been filled in and asks for none of it - a shoot with six
   * services is rarely crewed in one sitting, and until this the half-finished plan could not be
   * put down at all: Submit refused it and nothing else saved it, so the work was retyped at the
   * next attempt. The shoot stays Work in Progress, its tile counting what is filled, and Submit is
   * still there for when the rest is known.
   *
   * After the plan is submitted there is one button again - Save changes - because a submitted plan
   * is held to being complete whatever it is saved by (`plan.js`).
   */
  async function submit(event, { pending = false } = {}) {
    event.preventDefault();
    if (tab !== "plan" || !planEditable) return;
    const submitting = !pending && !detail?.plan?.planSubmittedAt;
    // What the server refuses, marked under each box first. Mark as pending asks for none of the
    // plan - only the status saved with it. A coordinator kept by name from the old sheet still
    // counts - the server keeps it while the box is blank. Travel Mode and the Studio Start Date and
    // Time are asked on the submit of an outdoor shoot only, and every service needs its own person.
    const plan = detail?.plan || {};
    const keptCoordinator = !plan.productionCoordinatorEmployeeId && Boolean(plan.productionCoordinator);
    // The plan's status is saved with it, so one that cannot be saved yet holds the whole save.
    const { change: statusChange, problems: statusProblems = {} } = planStatusChange(detail, form.planStatusControl);
    const fine = marks.check({
      productionCoordinatorEmployeeId: pending || form.productionCoordinatorEmployeeId || keptCoordinator ? "" : "Choose the Production Coordinator.",
      travelMode: submitting && !detail?.indoor && !form.travelMode ? "Choose the Travel Mode." : "",
      // When the crew leaves the studio, asked of an outdoor shoot with its Travel Mode.
      studioStartDate: submitting && !detail?.indoor && !form.studioStartDate ? "Enter the Studio Start Date." : "",
      studioStartTime: submitting && !detail?.indoor && !form.studioStartTime ? "Enter the Studio Start Time." : "",
      // Every service's person is asked for on the submit; a plan already submitted may be saved with
      // one empty - it reads Work in Progress until filled, as the server holds it.
      ...(submitting ? Object.fromEntries((form.crew || []).filter((row) => row.role === "LEAD").map((row) => [`crew:${row.definitionId}`, row.person ? "" : "Choose the lead."])) : {}),
      planStatusRemarks: statusProblems.remarks,
      planStatusFollowupDate: statusProblems.followupDate,
    });
    if (!fine) return;
    // Which of the two is in flight, so only the pressed button says what it is doing.
    setPendingSave(pending);
    await run(async () => {
      setError("");
      try {
        let response = await saveProductionPlan(shootId, productionPlanPayload(form, submitting));
        if (statusChange) response = await setProductionPlanStatus(shootId, statusChange);
        applyDetail(response?.data, submitting ? "Plan submitted." : pending ? "Saved. The plan is still pending." : "Plan saved.");
        guard(onBack || onClose);
      } catch (saveError) {
        setError(saveError.message || "Unable to save the plan.");
      }
    });
  }

  const submitted = Boolean(detail?.plan?.planSubmittedAt);
  const onPlan = tab === "plan";
  const bothActions = onPlan && planEditable && !submitted;
  // Execution's current step puts its action here, beside Close, as the Plan does Submit plan.
  const footer = <>
    {/* Three buttons do not share a phone's width evenly: Close takes its own, the two acts split the rest. */}
    <Button className={bothActions ? "max-sm:shrink-0" : "max-sm:flex-1"} size="lg" type="button" onClick={requestClose} disabled={busy}>Close</Button>
    {tab === "execution" && <div ref={setStepActionNode} className="flex items-center gap-2 empty:hidden max-sm:flex-1 max-sm:[&>*]:flex-1" />}
    {/* Until the plan is submitted, what is filled in can be put down as it stands. */}
    {bothActions && <Button className="max-sm:flex-1 max-sm:px-2" size="lg" type="button" onClick={(event) => void submit(event, { pending: true })} busy={busy && pendingSave} disabled={busy && !pendingSave} busyLabel="Saving...">Mark as pending</Button>}
    {onPlan && planEditable && <Button className="max-sm:flex-1 max-sm:px-2" size="lg" type="submit" variant="primary" busy={busy && !pendingSave} disabled={busy && pendingSave} busyLabel={submitted ? "Saving..." : "Submitting..."}>{submitted ? "Save changes" : "Submit plan"}</Button>}
  </>;

  // Titled from the board's row (`summary`) while the shoot loads, so the header does not read
  // "Production" for a moment and then change.
  const shown = detail || summary;
  // The project's name, and beneath it the board and the shoot: "Production | Shoot ID · …".
  const title = shown ? shown.clientName || shown.eventId || "Production" : "Production";
  const description = shown ? `Production | ${[shown.shootId || "Shoot", shown.shoot, formatDay(shown.shootDate), shown.pending].filter(Boolean).join(" · ")}` : undefined;

  return <>
    <SchemaFormPanel
      title={title}
      titleAddon={<ProjectHoldBadge status={detail?.projectStatus} holds={detail?.holds} paymentsDue={detail?.paymentsDue} />}
      description={description}
      tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Production shoot sections" />}
      // The Plan's short sections read by scrolling on a phone; a second row of links under the
      // tabs only repeated the headings.
      sectionNavOnPhone={false}
      loading={!detail && !error}
      loadingLabel="Loading shoot..."
      readOnly={onPlan && !planEditable}
      sections={onPlan ? [PLAN_CONTEXT_SECTION, ...productionPlanSections, PLAN_STATUS_SECTION] : []}
      values={form}
      onChange={update}
      context={context}
      sidebarAriaLabel="Production plan sections"
      closeAriaLabel="Close production shoot"
      onBack={onBack ? () => guard(onBack) : undefined}
      backAriaLabel="Back"
      onClose={requestClose}
      onSubmit={submit}
      // Checked in `submit` instead: a coordinator kept by name from the old sheet leaves the box
      // blank yet satisfies the server, and Travel Mode is only refused on the first submit.
      validateRequired={false}
      errors={marked}
      error={error || marks.summary}
      saving={busy}
      footer={footer}
      rail={tab === "execution" && detail?.plan?.planSubmittedAt && !detail?.execution?.closedReason ? <div ref={setStepListNode} /> : undefined}
      railAriaLabel="Production steps"
    >
      {detail && tab === "execution" && <StepActionSlotProvider node={stepActionNode}><StepListSlotProvider node={stepListNode}><ProductionExecutionTab
        shootId={shootId}
        detail={detail}
        options={options}
        canRunSteps={stepsRunnable}
        uploads={uploads}
        onDetail={applyDetail}
        onError={setError}
        onRemoveFile={removeFile}
      /></StepListSlotProvider></StepActionSlotProvider>}
      {detail && seesActivity && tab === "activity" && <ProductionActivityTab shootId={shootId} refreshKey={detail.updatedAt} onError={setError} />}
    </SchemaFormPanel>
    <ConfirmDialog {...confirmProps} layer="dialogOverPanel" />
  </>;
}
