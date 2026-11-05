"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useState } from "react";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import Dropdown from "@/components/shared/Dropdown";
import MultiImageField from "@/components/shared/MultiImageField";
import { StepAction } from "@/components/project-management/production/StepActionSlot";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ProductionFileList from "@/components/project-management/production/ProductionFileList";
import ProductionPauseControl from "@/components/project-management/production/ProductionPauseControl";
import ProductionMessageStatus from "@/components/project-management/production/ProductionMessageStatus";
import ProductionUploadQueue from "@/components/project-management/production/ProductionUploadQueue";
import { MESSAGE_LABELS, MESSAGE_STEP_FOR, messageFor, stepLabel, unsentNotice, stepIndex } from "@/lib/productionSteps.mjs";
import { completeProductionStep, saveProductionFootage } from "@/services/project-management/production.service";

/*
 * One step of the day, built for a phone. `editable` is true only for somebody named on the shoot,
 * on the **current** step; everything else is the step read back. The step's one primary action goes
 * in the shoot panel's footer (`StepAction`), beside Close - the same place and style as the Plan's
 * Submit plan.
 */
// The photo-and-confirm steps: a photo of their own (`STEP_PHOTO_KINDS` on the server), an optional
// remark, one button. Happening now needs two photos and keeps up to thirty.
const PHOTO_STEP_RULES = {
  STARTED_FROM_STUDIO: { min: 1, max: 5 },
  REACHED_SHOOT_PLACE: { min: 1, max: 5 },
  SHOOT_STARTED: { min: 1, max: 5 },
  HAPPENING_NOW: { min: 2, max: 30 },
  HAPPY_CLIENTS: { min: 1, max: 10 },
};
// The steps whose remarks are optional (`OPTIONAL_REMARK_FIELDS` on the server); the rest ask for theirs.
const OPTIONAL_REMARK_STEPS = new Set(["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS"]);
// Every input - photo pickers, remarks, dropdowns, the footage link - keeps to a form's width from md
// up instead of stretching across the pane; the rest of the step - photos taken, read-backs - keeps
// the full width. Full width on a phone.
const FIELD_WIDTH = "w-full md:max-w-xl";
// The picker's own line, counting what is already uploaded on this step against what it needs.
const uploadedHint = (count, needed, most) => `${count} uploaded · ${count >= needed ? `up to ${most}` : `at least ${needed} needed`}`;
const primary = "max-sm:flex-1";
// Photo copy's fields per service: all required but the remarks.
const FOOTAGE_FIELDS = ["footageUrl", "backedUpByEmployeeId", "fileCount", "size", "firstFileName", "lastFileName"];
const FOOTAGE_MISSING = {
  footageUrl: "Enter the footage location.",
  backedUpByEmployeeId: "Choose who backed up the footage.",
  fileCount: "Enter the number of files.",
  size: "Enter the size.",
  firstFileName: "Enter the first file name.",
  lastFileName: "Enter the last file name.",
};
const EMPTY_FOOTAGE = { ...Object.fromEntries(FOOTAGE_FIELDS.map((field) => [field, ""])), remarks: "" };
const WHOLE_SHOOT = "__shoot";
/**
 * The services File in asks a copy for: the shoot's own, once each, and **only those that hand files
 * over** - Settings → Project → Services, "Deliverable added" (`deliverableAdded`, the server's own
 * answer). An LED wall brings nothing back to copy, so it is not a card.
 *
 * A shoot with **no services booked at all** still answers once for the whole shoot, as it always
 * has. A shoot whose services deliver nothing has no card and nothing to fill in - the same list the
 * server checks (`execution.photoCopyKeys`).
 */
function photoCopyServices(services = []) {
  const booked = services || [];
  const seen = new Map();
  for (const service of booked) if (service.definitionId && service.deliverableAdded && !seen.has(service.definitionId)) seen.set(service.definitionId, { key: service.definitionId, definitionId: service.definitionId, name: service.name });
  if (seen.size) return [...seen.values()];
  return booked.some((service) => service.definitionId) ? [] : [{ key: WHOLE_SHOOT, definitionId: null, name: "Whole shoot" }];
}
/*
 * What the form opens on: the services already saved by a Mark as pending, filled in, and the rest
 * blank. Before the pending save there was nothing to read back here - the rows only existed once
 * the step was complete, and a complete step shows the read-back below instead of this form.
 */
const footageFrom = (services, saved = []) => {
  const held = new Map((saved || []).map((entry) => [entry.serviceDefinitionId ?? WHOLE_SHOOT, entry]));
  return Object.fromEntries(services.map((service) => {
    const entry = held.get(service.key);
    if (!entry) return [service.key, { ...EMPTY_FOOTAGE }];
    return [service.key, {
      footageUrl: entry.footageUrl || "",
      backedUpByEmployeeId: entry.backedUpByEmployeeId ? String(entry.backedUpByEmployeeId) : "",
      fileCount: entry.fileCount === null || entry.fileCount === undefined ? "" : String(entry.fileCount),
      size: entry.size || "",
      firstFileName: entry.firstFileName || "",
      lastFileName: entry.lastFileName || "",
      remarks: entry.remarks || "",
    }];
  }));
};
// The pending save takes the answers as typed, blanks and all: the server keeps the services that
// are complete and leaves the others pending, so nothing is coerced into a number here.
const pendingFootagePayload = (services, values) => services.map((service) => ({
  serviceDefinitionId: service.definitionId,
  ...values[service.key],
}));
const footagePayload = (services, values) => services.map((service) => ({
  serviceDefinitionId: service.definitionId,
  ...values[service.key],
  backedUpByEmployeeId: Number(values[service.key].backedUpByEmployeeId),
  fileCount: Number(values[service.key].fileCount),
}));

const serviceFilled = (values) => FOOTAGE_FIELDS.every((field) => String(values?.[field] ?? "").trim());

/** What each footage backup answer means, read back once the step is done. */
const FOOTAGE_HELP = {
  footageUrl: "Where the footage is backed up - a link, or the disk and where it is kept.",
  backedUpBy: "The employee who copied the footage to the backup.",
  fileCount: "How many files were copied.",
  size: "The total size of the copied footage.",
  firstFileName: "The first file copied, to check nothing is missing.",
  lastFileName: "The last file copied, to check nothing is missing.",
  remarks: "Anything noted about this backup.",
};

/** Answers already given, read-only: `[label, value]`, or `[label, value, help]` for an ⓘ beside the label. */
function ReadBack({ rows }) {
  return <dl className="grid gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
    {rows.map(([label, value, help]) => <div key={label} className="min-w-0">
      <dt className="flex items-center text-xs font-semibold text-slate-500">{label}<HelpTip text={help} /></dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{value || "—"}</dd>
    </div>)}
  </dl>;
}

export default function ProductionStepForm({ stepId, indoor = false, shootId, detail, options, editable, canRunSteps, uploads, onDetail, onError, onRemoveFile }) {
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();
  const execution = detail.execution;
  const [confirming, setConfirming] = useState(false);
  const [remarks, setRemarks] = useState(execution.pineappleRemarks || "");
  // The steps that ask nothing else take an optional remark of their own.
  const takesOptionalRemarks = OPTIONAL_REMARK_STEPS.has(stepId);
  const [stepRemarks, setStepRemarks] = useState(execution.stepRemarks?.[stepId] || "");
  // Nothing picked until the user picks: the current status is read back above, and a stopped shoot's
  // own status is not one of its next choices.

  // Photo copy: one answer per service booked on the shoot, or one for the whole shoot when it has
  // none (`photoCopyRows` on the server checks the same list).
  const footageServices = photoCopyServices(detail.plan?.services);
  const [footage, setFootage] = useState(() => footageFrom(footageServices, execution.footage));
  const setFootageField = (key, field, value) => {
    fields.clear(`${key}.${field}`);
    setFootage((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  };
  // Every answer per service, keyed "<service>.<field>" so each box carries its own.
  const footageProblems = () => Object.fromEntries(footageServices.flatMap((service) => FOOTAGE_FIELDS.map((field) => [
    `${service.key}.${field}`,
    String(footage[service.key]?.[field] ?? "").trim() ? "" : FOOTAGE_MISSING[field],
  ])));
  // Nothing to copy in is a finished step, not an unfinished one.
  const footageComplete = footageServices.every((service) => serviceFilled(footage[service.key]));
  // Both buttons share one busy flag, so the pressed one is remembered and only it says "Saving...".
  const [pendingSave, setPendingSave] = useState(false);
  // Whether a step's WhatsApp went - and its Retry - is for the Production Manager (and a Super
  // Admin), who can edit the plan; the coordinator and the team only see the steps.
  const seesMessages = Boolean(detail.canEditPlan);
  const filesOf = (kind) => (detail.files || []).filter((file) => file.kind === kind);
  const employees = (options?.employees || []).map((employee) => ({ value: String(employee.id), label: employee.employeeName, avatar: avatarOf(employee) }));
  const queueFor = (kind) => <ProductionUploadQueue queue={uploads.queue} kind={kind} onRetry={uploads.retry} onDiscard={uploads.discard} />;

  async function complete(payload = {}) {
    await run(async () => {
      onError("");
      try {
        const response = await completeProductionStep(shootId, stepId, payload);
        setConfirming(false);
        onDetail(response?.data, `${stepLabel(stepId, indoor)} done.`);
        // The step is saved either way. Whether its WhatsApp went is the Production Manager's to see.
        const unsent = seesMessages ? unsentNotice(response?.message) : null;
        if (unsent) onError(unsent);
      } catch (error) {
        setConfirming(false);
        onError(error.message || "Unable to complete this step.");
      }
    });
  }

  /*
   * File in, saved as it stands.
   *
   * The step wants every service of the shoot answered before it is complete, and that is right -
   * it says the whole shoot's footage is in. But the copying is done card by card, so this keeps
   * what is filled in and leaves the rest pending, and the notice says which: a service is kept once
   * all of its answers are there, because a footage row half written says a copy was made that was
   * not. The typed answers stay on the form either way, so nothing is lost by saving early.
   */
  /*
   * Complete photo copy. The step says the whole shoot's footage is in, so it wants every service
   * answered - and says which answers are missing instead of refusing silently, with Mark as pending
   * named as the other way out. The server holds the same rule (`photoCopyRows`).
   */
  async function completeFootage() {
    setPendingSave(false);
    if (!footageComplete) {
      fields.check(footageProblems());
      const left = footageServices.filter((service) => !serviceFilled(footage[service.key])).length;
      onError(`Fill in the answers marked in red on ${left === footageServices.length && left > 1 ? "every service" : left === 1 ? "1 service" : `${left} services`}, or Mark as pending to save what is filled in.`);
      return;
    }
    await complete({ footage: footagePayload(footageServices, footage) });
  }

  async function savePending() {
    setPendingSave(true);
    await run(async () => {
      onError("");
      try {
        const response = await saveProductionFootage(shootId, pendingFootagePayload(footageServices, footage));
        // `held` is what was written - the cards as they stand, finished or not; `pending` is how
        // many services the step is still waiting on. A card saved part way is saved, so the notice
        // says so: reading "no service finished" as "nothing saved" told people their work was lost
        // when it was on disk.
        const held = Number(response?.held || 0);
        const pending = Number(response?.pending || 0);
        onDetail(response?.data, !pending ? "File in saved. Complete photo copy when you are ready."
          : held ? `Saved as it stands. ${pending} ${pending === 1 ? "service" : "services"} still to fill in, then complete photo copy.`
            : "Nothing to save yet - fill in a service and mark it pending.");
      } catch (error) {
        onError(error.message || "Unable to save the File in.");
      }
    });
  }


  const finished = stepIndex(execution.currentStep) > stepIndex(stepId);
  const pineapple = filesOf("PINEAPPLE_GROUP");
  // The photo-and-confirm steps each need photos of their own before they confirm.
  const photoRule = PHOTO_STEP_RULES[stepId] || null;
  const stepPhotoKind = photoRule ? stepId : null;
  const stepPhotos = stepPhotoKind ? filesOf(stepPhotoKind) : [];
  /*
   * The message this step posts - unless the studio has switched it off on Settings → Templates
   * (`execution.messagesOff`), in which case the step says nothing about WhatsApp and does not ask
   * to be confirmed: there is no message to think twice about.
   */
  const messageStep = (execution.messagesOff || []).includes(MESSAGE_STEP_FOR[stepId]) ? undefined : MESSAGE_STEP_FOR[stepId];
  const photosProblem = (count, needed, one) => (count >= needed ? "" : needed > 1 ? `Add at least ${needed} photos.` : one);

  const optionalRemarks = takesOptionalRemarks && (editable
    ? <TextAreaField className={FIELD_WIDTH} label="Remarks" helperText="Anything worth noting about this step, saved with it." value={stepRemarks} onChange={(event) => setStepRemarks(event.target.value)} />
    : execution.stepRemarks?.[stepId] ? <ReadBack rows={[["Remarks", execution.stepRemarks[stepId], "Notes saved with this step by whoever completed it."]]} /> : null);

  return <section className="flex min-w-0 flex-col gap-4">
    {/* The step's name, with Pause / Resume the shoot opposite it - the one control that is not a step. */}
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-base font-semibold text-slate-900">{stepLabel(stepId, indoor)}</h3>
        {finished && <p className="text-xs font-medium text-green-700">✓ Done</p>}
      </div>
      <ProductionPauseControl shootId={shootId} execution={execution} canRunSteps={canRunSteps} onDetail={onDetail} onError={onError} />
    </header>
    <ProductionPauseControl part="notice" shootId={shootId} execution={execution} canRunSteps={canRunSteps} onDetail={onDetail} onError={onError} />

    {seesMessages && messageStep && messageFor(detail.messages, messageStep) && <ProductionMessageStatus
      shootId={shootId}
      message={messageFor(detail.messages, messageStep)}
      canRetry={seesMessages}
      onDetail={onDetail}
      onError={onError}
    />}

    {stepPhotoKind && <>
      {editable && <MultiImageField className={FIELD_WIDTH} label={photoRule.min > 1 ? "Photos" : "Photo"} helperText="Photos from this step, saved to the shoot as proof it was done." required size="lg" value={[]} max={Math.max(1, photoRule.max - stepPhotos.length)} hint={uploadedHint(stepPhotos.length, photoRule.min, photoRule.max)} onChange={(next) => { fields.clear("photos"); uploads.add(stepPhotoKind, next); }} error={fields.errors.photos} />}
      {queueFor(stepPhotoKind)}
      <ProductionFileList shootId={shootId} files={stepPhotos} canRemove={editable} onRemove={onRemoveFile} emptyText={photoRule.min > 1 ? "No photos yet." : "No photo yet."} />
    </>}

    {takesOptionalRemarks && optionalRemarks}

    {stepPhotoKind && editable && <>
      {messageStep && <p className="text-sm text-slate-600">Confirming posts the &quot;{MESSAGE_LABELS[messageStep]}&quot; message to the project&apos;s WhatsApp group.</p>}
      <StepAction>
        {/* Only a step that posts to WhatsApp asks again first - a message cannot be taken back.
            The others send nothing, so their button completes them straight away. */}
        <Button type="button" variant="primary" size="lg" className={primary} busy={!messageStep && busy} busyLabel="Saving..." onClick={() => {
          if (!fields.check({ photos: photosProblem(stepPhotos.length, photoRule.min, "Add a photo.") })) return;
          if (messageStep) setConfirming(true); else void complete({ remarks: stepRemarks });
        }}>Confirm {stepLabel(stepId, indoor).toLowerCase()}</Button>
      </StepAction>
      <ConfirmDialog
        open={confirming && Boolean(messageStep)}
        layer="dialogOverPanel"
        tone="primary"
        title={`${stepLabel(stepId, indoor)}?`}
        message="This completes the step and posts its message to the WhatsApp group. It cannot be undone."
        confirmLabel="Confirm"
        busyLabel="Saving..."
        loading={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void complete({ remarks: stepRemarks })}
      />
    </>}

    {stepId === "PINEAPPLE_MEETING" && <>
      {editable && <MultiImageField className={FIELD_WIDTH} label="Group photo" helperText="A photo of the team at the pineapple meeting, saved to the shoot." required size="lg" value={[]} max={Math.max(1, 5 - pineapple.length)} hint={uploadedHint(pineapple.length, 1, 5)} onChange={(next) => { fields.clear("photos"); uploads.add("PINEAPPLE_GROUP", next); }} error={fields.errors.photos} />}
      {queueFor("PINEAPPLE_GROUP")}
      <ProductionFileList shootId={shootId} files={pineapple} canRemove={editable} onRemove={onRemoveFile} emptyText="No group photo yet." />
      {editable
        ? <TextAreaField className={FIELD_WIDTH} label="Remarks" required helperText="What was discussed at the pineapple meeting." value={remarks} onChange={(event) => { setRemarks(event.target.value); fields.clear("remarks"); }} error={fields.errors.remarks} />
        : <ReadBack rows={[["Remarks", execution.pineappleRemarks, "What was discussed at the pineapple meeting, saved when the step was completed."]]} />}
      {editable && <StepAction>
        <Button type="button" variant="primary" size="lg" className={primary} busy={busy} busyLabel="Saving..." onClick={() => fields.check({
          photos: photosProblem(pineapple.length, 1, "Add a group photo."),
          remarks: remarks.trim() ? "" : "Enter the remarks.",
        }) && void complete({ remarks })}>Complete pineapple meeting</Button>
      </StepAction>}
    </>}

    {stepId === "PHOTO_COPY" && (editable
      ? <div className="flex flex-col gap-4">
        {/* Said rather than left blank: an empty step reads as one that failed to load. */}
        {footageServices.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500 md:max-w-3xl">
          No service on this shoot hands files over, so there is nothing to copy in. Mark the step done to finish the shoot.
        </p>}
        {footageServices.map((service) => {
          const values = footage[service.key];
          const set = (field) => (event) => setFootageField(service.key, field, event.target.value);
          const errorOf = (field) => fields.errors[`${service.key}.${field}`];
          return <section key={service.key} aria-label={service.name} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 md:max-w-3xl">
            <h4 className="text-sm font-semibold text-slate-900">{service.name}</h4>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <TextField className="md:col-span-2" label="Footage Location" required helperText="Where this service's footage is backed up - a link, or the disk and where it is kept." inputClassName="min-h-11" value={values.footageUrl} onChange={set("footageUrl")} error={errorOf("footageUrl")} />
              <Dropdown label="Footage backup done by" required helperText="The employee who copied the footage to the backup." value={values.backedUpByEmployeeId} onChange={(value) => setFootageField(service.key, "backedUpByEmployeeId", value)} options={employees} placeholder="Select employee" error={errorOf("backedUpByEmployeeId")} />
              <TextField label="No. of files" required helperText="How many files were copied, as a whole number." type="number" inputMode="numeric" min="1" step="1" inputClassName="min-h-11" value={values.fileCount} onChange={set("fileCount")} error={errorOf("fileCount")} />
              <TextField label="Size" required helperText="Total size of the copied footage, with its unit." placeholder="e.g. 128 GB" inputClassName="min-h-11" value={values.size} onChange={set("size")} error={errorOf("size")} />
              <TextField label="First file name" required helperText="Name of the first file copied, to check nothing is missing." inputClassName="min-h-11" value={values.firstFileName} onChange={set("firstFileName")} error={errorOf("firstFileName")} />
              <TextField label="Last file name" required helperText="Name of the last file copied, to check nothing is missing." inputClassName="min-h-11" value={values.lastFileName} onChange={set("lastFileName")} error={errorOf("lastFileName")} />
              <TextAreaField className="md:col-span-2" label="Remarks" helperText="Anything worth noting about this backup." value={values.remarks} onChange={set("remarks")} />
            </div>
          </section>;
        })}
        <StepAction>
          {/*
            * Completing the step is the way out of File in, and Mark as pending is there for the day
            * it cannot be done in one sitting: it shows only while something is still missing, and
            * goes as soon as every service is answered - at which point there is nothing to leave
            * pending and one button to press.
            */}
          {!footageComplete && <Button type="button" size="lg" className={`${primary} max-sm:px-2`} busy={busy && pendingSave} busyLabel="Saving..." disabled={busy && !pendingSave} onClick={() => void savePending()}>Mark as pending</Button>}
          <Button type="button" variant="primary" size="lg" className={`${primary} max-sm:px-2`} busy={busy && !pendingSave} busyLabel="Saving..." disabled={busy && pendingSave} onClick={() => void completeFootage()}>Complete photo copy</Button>
        </StepAction>
      </div>
      : execution.footage?.length
        // One read-back per service; a shoot that finished before Photo copy was per service reads its single answer.
        ? <div className="flex flex-col gap-3">{execution.footage.map((entry, index) => <section key={entry.serviceDefinitionId || index} className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-slate-900">{entry.serviceDefinitionId ? entry.serviceName || "Service removed" : "Whole shoot"}</h4>
          <ReadBack rows={[["Footage Location", entry.footageUrl, FOOTAGE_HELP.footageUrl], ["Backup done by", entry.backedUpBy, FOOTAGE_HELP.backedUpBy], ["No. of files", entry.fileCount === null || entry.fileCount === undefined ? "" : String(entry.fileCount), FOOTAGE_HELP.fileCount], ["Size", entry.size, FOOTAGE_HELP.size], ["First file name", entry.firstFileName, FOOTAGE_HELP.firstFileName], ["Last file name", entry.lastFileName, FOOTAGE_HELP.lastFileName], ["Remarks", entry.remarks, FOOTAGE_HELP.remarks]]} />
        </section>)}</div>
        : <ReadBack rows={[["Footage Location", execution.footageUrl, FOOTAGE_HELP.footageUrl], ["Backup done by", execution.footageBackupBy, FOOTAGE_HELP.backedUpBy], ["Remarks", execution.footageRemarks, FOOTAGE_HELP.remarks]]} />)}

    {!editable && !finished && <p className="text-xs text-slate-500">{!canRunSteps ? "Only the people named on this shoot, with Production or Production Execution at Read / Write, complete its steps."
      // A paused shoot is already saying so above, in the title bar - this only says what that means here.
      : execution.paused && stepId === execution.currentStep ? "The shoot is paused. Resume it to complete this step."
        : "Finish the steps before this one first."}</p>}
  </section>;
}
