"use client";

import { useEffect, useMemo, useState } from "react";
import SimpleTable from "@/components/data-table/SimpleTable";
import AddShootDialog from "@/components/project-management/AddShootDialog";
import ProjectServiceCreationSection from "@/components/project-management/ProjectServiceCreationSection";
import usePendingShootLines, { deliverablePayload, servicePayload } from "@/components/project-management/usePendingShootLines";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import FileUploadField from "@/components/shared/FileUploadField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import StepRail from "@/components/shared/StepRail";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import { shootDisplayName } from "@/lib/shootDisplay.mjs";
import { CORRECTION_CATEGORIES, REQUEST_TYPES, REQUEST_TYPE_HINTS, REQUEST_TYPE_LABELS, alreadyOnShoot } from "@/lib/changeRequests.mjs";
import { getChangeRequestDeliverables, getChangeRequestProjectShoots, getChangeRequestServices, raiseChangeRequest, searchChangeRequestProjects } from "@/services/client-management/change-requests.service";

/*
 * Client Requests -> Raise Request: the studio asking, for a booked project, for a new shoot, services
 * or deliverables for one of its shoots, or a correction - in four steps: what it is for, the project,
 * the details, and a last look before it is sent.
 *
 * The shoot and its lines are picked with Create Project's own pieces (`AddShootDialog`,
 * `ProjectServiceCreationSection`, `usePendingShootLines`), so a request asks in exactly the terms a
 * project is planned in. Nothing here carries a price: whoever decides the request sets the amounts.
 * Sending it writes nothing to the project - it waits for a decision (`onRaised`).
 */

const STEPS = [["type", "Request Type"], ["project", "Project"], ["details", "Details"], ["review", "Review"]];
// The requested shoot's key while it exists only here, so its lines can be grouped under it.
const REQUESTED_SHOOT_ID = "requested-shoot";

export default function RaiseRequestDialog({ onClose, onRaised }) {
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [type, setType] = useState("");
  const [projects, setProjects] = useState(null);
  const [projectsError, setProjectsError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [shoots, setShoots] = useState(null);
  const [shootId, setShootId] = useState("");
  // A SHOOT request's shoot, as the Add Shoot dialog fills it in.
  const [newShoot, setNewShoot] = useState(null);
  const [shootDialogOpen, setShootDialogOpen] = useState(false);
  const [masters, setMasters] = useState({ services: [], deliverables: [], loading: true, serviceError: "", deliverableError: "" });
  const [correctionCategory, setCorrectionCategory] = useState("");
  const [remarks, setRemarks] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [problems, setProblems] = useState({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const lines = usePendingShootLines({ serviceDefinitions: masters.services, deliverableDefinitions: masters.deliverables });

  const project = projects?.find((row) => row.id === projectId) || null;
  const existingShoot = shoots?.find((row) => row.id === shootId) || null;
  const wantsLines = ["SHOOT", "SERVICE", "DELIVERABLE"].includes(type);
  const lineShoot = useMemo(() => (type === "SHOOT" ? (newShoot ? { ...newShoot, id: REQUESTED_SHOOT_ID } : null) : existingShoot), [type, newShoot, existingShoot]);
  // The one shoot the section lists, kept the same array between renders: the section builds its
  // table columns from it, and a new array each render rebuilt every row under the person's hand.
  const sectionShoots = useMemo(() => (lineShoot ? [lineShoot] : []), [lineShoot]);
  const servicesAsked = lineShoot ? lines.servicesByShoot[lineShoot.id] || [] : [];
  const deliverablesAsked = lineShoot ? lines.deliverablesByShoot[lineShoot.id] || [] : [];

  // The projects in reach, once: the picker searches them as it is typed into.
  useEffect(() => {
    let alive = true;
    searchChangeRequestProjects("").then((response) => { if (alive) setProjects(response?.data || []); }).catch((error) => { if (alive) { setProjects([]); setProjectsError(error.message || "Unable to load the projects."); } });
    return () => { alive = false; };
  }, []);

  // The chosen project's shoots.
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    getChangeRequestProjectShoots(projectId).then((response) => { if (alive) setShoots(response?.data || []); }).catch(() => { if (alive) setShoots([]); });
    return () => { alive = false; };
  }, [projectId]);

  // The studio's Services and Deliverables, read while the first steps are filled in.
  useEffect(() => {
    let alive = true;
    Promise.allSettled([getChangeRequestServices(), getChangeRequestDeliverables()]).then(([services, deliverables]) => {
      if (!alive) return;
      setMasters({
        services: services.status === "fulfilled" ? services.value?.data || [] : [],
        deliverables: deliverables.status === "fulfilled" ? deliverables.value?.data || [] : [],
        loading: false,
        serviceError: services.status === "rejected" ? services.reason?.message || "Unable to load the services." : "",
        deliverableError: deliverables.status === "rejected" ? deliverables.reason?.message || "Unable to load the deliverables." : "",
      });
    });
    return () => { alive = false; };
  }, []);

  const projectOptions = useMemo(() => (projects || []).map((row) => ({ value: row.id, label: [row.eventId, row.clientName, row.clientNumber].filter(Boolean).join(" · ") })), [projects]);
  const shootOptions = useMemo(() => (shoots || []).map((row) => ({ value: row.id, label: [row.shootId, shootDisplayName(row)].filter(Boolean).join(" · ") })), [shoots]);

  function chooseType(next) {
    if (next === type) return;
    // A different kind of request starts its details again.
    lines.removeShootLines(REQUESTED_SHOOT_ID);
    if (shootId) lines.removeShootLines(shootId);
    setType(next);
    setNewShoot(null);
    setCorrectionCategory("");
    setProblems({});
    setFurthest(1);
  }

  function chooseProject(next) {
    if (next === projectId) return;
    if (shootId) lines.removeShootLines(shootId);
    setProjectId(next);
    setShoots(null);
    setShootId("");
    setProblems({});
    setFurthest(Math.min(furthest, 2));
  }

  function chooseShoot(next) {
    if (shootId && shootId !== next) lines.removeShootLines(shootId);
    setShootId(next || "");
    setProblems((current) => ({ ...current, shoot: "" }));
  }

  /** What the open step still needs, as `{ field: message }`; nothing when it is complete. */
  function problemsOf(at) {
    if (at === 0) return type ? {} : { type: "Choose what the request is for." };
    if (at === 1) return projectId ? {} : { project: "Choose the project." };
    if (at !== 2) return {};
    if (type === "SHOOT") return newShoot ? {} : { shoot: "Add the shoot's details." };
    if (type === "SERVICE" || type === "DELIVERABLE") {
      if (!shootId) return { shoot: "Choose the shoot." };
      const asked = type === "SERVICE" ? servicesAsked : deliverablesAsked;
      if (!asked.length) return { lines: `Add at least one ${type === "SERVICE" ? "service" : "deliverable"}.` };
      // What the shoot already has would add nothing once approved, so it is not asked for.
      const held = type === "SERVICE"
        ? alreadyOnShoot(existingShoot, asked.map((row) => ({ ...servicePayload(row), name: row.serviceName })), [], (line) => line.name)
        : alreadyOnShoot(existingShoot, [], asked.map((row) => ({ ...deliverablePayload(row), name: row.deliverableName })), (line) => line.name);
      return held ? { lines: `"${held}" is already on this shoot. Remove it from the request.` } : {};
    }
    return { ...(correctionCategory ? {} : { category: "Choose the correction category." }), ...(remarks.trim() ? {} : { remarks: "Describe the correction." }) };
  }

  function next() {
    const found = problemsOf(step);
    setProblems(found);
    if (Object.keys(found).length) return;
    const to = step + 1;
    setStep(to);
    setFurthest((current) => Math.max(current, to));
  }

  async function send() {
    setSending(true);
    setSendError("");
    try {
      const response = await raiseChangeRequest({
        requestType: type,
        projectId,
        shootId: type === "SHOOT" ? null : shootId || null,
        shoot: type === "SHOOT" ? newShoot : null,
        services: ["SHOOT", "SERVICE"].includes(type) ? servicesAsked.map(servicePayload) : [],
        deliverables: ["SHOOT", "DELIVERABLE"].includes(type) ? deliverablesAsked.map(deliverablePayload) : [],
        correctionCategory: type === "OTHER" ? correctionCategory : null,
        remarks: remarks.trim(),
        attachments: type === "OTHER" ? attachments : [],
      });
      onRaised?.(response?.message || "Request raised.", response?.data);
    } catch (error) {
      setSendError(error.data?.message || error.message || "The request could not be raised. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const summaryItems = [
    ...(type === "SHOOT" && newShoot ? [{ id: "shoot", kind: "Shoot", name: newShoot.shoot, quantity: 1 }] : []),
    ...(type === "OTHER" && correctionCategory ? [{ id: "correction", kind: "Correction", name: correctionCategory, quantity: 1 }] : []),
    ...servicesAsked.map((row) => ({ id: row.id, kind: "Service", name: row.serviceName, quantity: row.quantity || 1 })),
    ...deliverablesAsked.map((row) => ({ id: row.id, kind: "Deliverable", name: [row.deliverableName, row.brandName, row.size].filter(Boolean).join(" | "), quantity: row.quantity || 1 })),
  ];

  const footer = <>
    <Button type="button" onClick={step === 0 ? onClose : () => setStep(step - 1)} disabled={sending}>{step === 0 ? "Cancel" : "Back"}</Button>
    {step < STEPS.length - 1
      ? <Button type="button" variant="primary" onClick={next}>Continue</Button>
      : <Button type="button" variant="primary" onClick={() => void send()} disabled={sending}>{sending ? "Sending..." : "Submit Request"}</Button>}
  </>;

  return <>
    <Dialog
      title="Raise Request"
      description={step === 0 ? "What is the request for?" : `${REQUEST_TYPE_LABELS[type]} request${project ? ` · ${project.eventId}` : ""}`}
      // The shoot's services and deliverables are tables of their own; the dialog widens for them.
      size={step >= 2 && wantsLines ? "wide" : "lg"}
      height={step >= 2 && wantsLines ? "tall" : "auto"}
      onClose={onClose}
      busy={sending}
      footer={footer}
    >
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:gap-6">
        <StepRail steps={STEPS} current={step} furthest={furthest} onSelect={(to) => { if (to <= furthest) setStep(to); }} ariaLabel="Raise request steps" />
        <div className="min-w-0 flex-1 space-y-4 pb-4">
          {step === 0 && <RadioGroupField
            label="Request type"
            name="raise-request-type"
            required
            layout="column"
            options={REQUEST_TYPES.map((option) => ({ value: option.value, label: <span><span className="font-medium">{option.label}</span><span className="block text-xs font-normal text-slate-500">{REQUEST_TYPE_HINTS[option.value]}</span></span> }))}
            value={type}
            onChange={(value) => { chooseType(value); setProblems({}); }}
            error={problems.type}
          />}

          {step === 1 && <>
            <Dropdown
              label="Project"
              required
              placeholder={projects ? "Search by Event ID, client name or number" : "Loading projects..."}
              options={projectOptions}
              value={projectId}
              onChange={chooseProject}
              disabled={!projects}
              sorted={false}
              error={problems.project || projectsError}
              helperText="Only the projects you can raise requests on are listed."
            />
            {project && <RecordSummaryCard rows={[["Event ID", project.eventId], ["Client", project.clientName], ["Client number", project.clientNumber], ["Status", project.status], ["Vertical", project.vertical], ["Shoots", String(project.shootCount)]]} />}
          </>}

          {step === 2 && type === "SHOOT" && <>
            {!newShoot
              ? <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                <p>Start with the shoot: its name, date, location and timing - the same details as adding a shoot to a project.</p>
                <Button type="button" variant="primary" className="mt-3" onClick={() => setShootDialogOpen(true)}>Add Shoot Details</Button>
                {problems.shoot && <p role="alert" className="mt-2 text-xs text-red-600">{problems.shoot}</p>}
              </div>
              : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-slate-600">The shoot being requested. Add the services and deliverables it needs below - the approver sets the prices.</p>
                <Button type="button" onClick={() => setShootDialogOpen(true)}>Edit Shoot Details</Button>
              </div>
              <RecordSummaryCard columnsClassName="sm:grid-cols-2 lg:grid-cols-3" rows={[
                ["Shoot", shootDisplayName(newShoot)],
                ["Date", newShoot.dateCreated ? new Date(newShoot.dateCreated).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not fixed yet"],
                ["Location", [newShoot.shootPlace, newShoot.district, newShoot.state].filter(Boolean).join(", ")],
                ["Shoot type", (newShoot.shootTypes || []).join(", ")],
                ["Session", (newShoot.sessionTimings || []).join(", ")],
                ["Preference", newShoot.preference],
              ]} />
              <ProjectServiceCreationSection
                shootList={false}
                shoots={sectionShoots}
                loading={false}
                loadingMasterData={masters.loading}
                serviceDefinitionsError={masters.serviceError}
                deliverableDefinitionsError={masters.deliverableError}
                serviceDefinitions={masters.services}
                deliverableDefinitions={masters.deliverables}
                servicesByShoot={lines.servicesByShoot}
                deliverablesByShoot={lines.deliverablesByShoot}
                deliverableVariants
                sessionTimingColumn={false}
                onAddService={lines.addService}
                onUpdateService={lines.updateService}
                onDeleteService={lines.deleteService}
                onAddDeliverable={lines.addDeliverable}
                onUpdateDeliverable={lines.updateDeliverable}
                onDeleteDeliverable={lines.deleteDeliverable}
                onReorderServices={lines.reorderServices}
                onReorderDeliverables={lines.reorderDeliverables}
              />
              </>}
          </>}

          {step === 2 && (type === "SERVICE" || type === "DELIVERABLE") && <>
            <Dropdown label="Shoot" required placeholder={shoots ? (shoots.length ? "Choose the shoot" : "This project has no shoots yet") : "Loading shoots..."} options={shootOptions} value={shootId} onChange={chooseShoot} disabled={!shoots?.length} sorted={false} error={problems.shoot} helperText={`The ${type === "SERVICE" ? "services" : "deliverables"} are added to this shoot once approved.`} />
            {existingShoot && <p className="text-xs text-slate-600">
              <span className="font-semibold">Already on this shoot:</span> {(type === "SERVICE" ? existingShoot.heldServices : existingShoot.heldDeliverables)?.map((row) => [row.name, row.brandName, row.size].filter(Boolean).join(" | ")).join(", ") || "nothing yet"}
            </p>}
            {existingShoot && <p className="text-sm text-slate-600">{`Add the ${type === "SERVICE" ? "services" : "deliverables"} being requested - the approver sets the prices.`}</p>}
            {existingShoot && <ProjectServiceCreationSection
              shootList={false}
              parts={type === "SERVICE" ? "services" : "deliverables"}
              shoots={sectionShoots}
              loading={false}
              loadingMasterData={masters.loading}
              serviceDefinitionsError={masters.serviceError}
              deliverableDefinitionsError={masters.deliverableError}
              serviceDefinitions={masters.services}
              deliverableDefinitions={masters.deliverables}
              servicesByShoot={lines.servicesByShoot}
              deliverablesByShoot={lines.deliverablesByShoot}
              deliverableVariants
              sessionTimingColumn={false}
              {...(type === "SERVICE"
                ? { onAddService: lines.addService, onUpdateService: lines.updateService, onDeleteService: lines.deleteService, onReorderServices: lines.reorderServices }
                : { onAddDeliverable: lines.addDeliverable, onUpdateDeliverable: lines.updateDeliverable, onDeleteDeliverable: lines.deleteDeliverable, onReorderDeliverables: lines.reorderDeliverables })}
            />}
            {problems.lines && <p role="alert" className="text-xs text-red-600">{problems.lines}</p>}
          </>}

          {step === 2 && type === "OTHER" && <>
            <Dropdown label="Correction category" required placeholder="Choose the category" options={CORRECTION_CATEGORIES} value={correctionCategory} onChange={(value) => { setCorrectionCategory(value); setProblems((current) => ({ ...current, category: "" })); }} sorted={false} error={problems.category} />
            <Dropdown label="Related shoot" clearable clearLabel="No particular shoot" placeholder={shoots ? "Optional" : "Loading shoots..."} options={shootOptions} value={shootId} onChange={(value) => setShootId(value || "")} disabled={!shoots?.length} sorted={false} />
            <FileUploadField label="Reference attachments" image accept="image/*" maxFiles={5} value={attachments} onChange={setAttachments} helperText="Up to 5 pictures showing what is to be corrected." />
          </>}

          {step === 2 && <TextAreaField
            label={type === "OTHER" ? "Correction description / remarks" : "Request remarks"}
            required={type === "OTHER"}
            rows={3}
            maxLength={5000}
            value={remarks}
            onChange={(event) => { setRemarks(event.target.value); setProblems((current) => ({ ...current, remarks: "" })); }}
            error={problems.remarks}
            placeholder={type === "OTHER" ? "What is to be corrected, and where" : "Anything the approver should know"}
          />}

          {step === 3 && <>
            <RecordSummaryCard
              note="Check the request. Once submitted it waits for a decision - the approver sets the amounts and approves or rejects each item."
              rows={[
                ["Request type", REQUEST_TYPE_LABELS[type]],
                ["Project", project ? `${project.eventId} · ${project.clientName}` : ""],
                ["Shoot", type === "SHOOT" ? `${newShoot?.shoot || ""} (new)` : existingShoot ? [existingShoot.shootId, shootDisplayName(existingShoot)].filter(Boolean).join(" · ") : ""],
                ...(type === "OTHER" ? [["Attachments", attachments.length ? `${attachments.length} file${attachments.length === 1 ? "" : "s"}` : ""]] : []),
                ["Remarks", remarks.trim()],
              ]}
            />
            <SimpleTable ariaLabel="Requested items" rows={summaryItems} emptyMessage="Nothing requested." columns={[
              { key: "kind", label: "Type", render: (row) => row.kind },
              { key: "name", label: "Item", cellClassName: "whitespace-normal min-w-[12rem]", render: (row) => row.name },
              { key: "quantity", label: "Qty", headerClassName: "text-right", cellClassName: "text-right tabular-nums", render: (row) => row.quantity },
            ]} />
            {sendError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</p>}
          </>}
        </div>
      </div>
    </Dialog>
    {shootDialogOpen && <AddShootDialog
      initialShoot={newShoot}
      existingShoots={shoots || []}
      vertical={project?.vertical || ""}
      onClose={() => setShootDialogOpen(false)}
      onSave={async (rows) => {
        const [first] = rows || [];
        if (first) setNewShoot({ ...first, dateCreated: first.dateCreated || null });
        setProblems((current) => ({ ...current, shoot: "" }));
        setShootDialogOpen(false);
      }}
    />}
  </>;
}
