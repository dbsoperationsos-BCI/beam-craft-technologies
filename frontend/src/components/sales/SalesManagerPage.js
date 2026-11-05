"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProjectDataTable from "@/components/data-table/ProjectDataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { PROJECT_IMPORT_COLUMNS } from "@/constants/importColumns";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import { getAuthenticatedUser } from "@/lib/auth";
import { PROJECT_STAFF_FIELDS } from "@/constants/projectStaff";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/apiClient";
// The CRM board's own reading of a stored date, so a converted project files the event under the
// day the board shows rather than under whatever `new Date()` made of the raw cell.
import { toIsoDay } from "@/lib/crmLeadDates";
import { getSalesProjects, updateSalesProject } from "@/services/sales/projects.service";
import { createWhatsappGroupName } from "@/services/sales/whatsapp-group-names.service";
import CreateProjectFormPanel from "./CreateProjectFormPanel";
import ProjectBookingPanel from "./ProjectBookingPanel";
import { CRM_GROUP_TYPES, projectToDuplicatePrefill, sourceBranchForCrmBranch, validationDetail } from "./projectBooking";
import { planFromProject } from "./quotationProjectPlan";
import { getProjectDeliverableAllocations, getProjectServiceAllocations, getProjectShoots } from "@/services/project-management/project-workflow.service";
import useProjectFormPickers from "./useProjectFormPickers";
import { salePatchPayload } from "./SaleDetailsSection";
import WhatsappGroupNameDialog from "./WhatsappGroupNameDialog";
import { derivedVertical } from "./whatsappGroupNameUtils";

export default function SalesManagerPage() {
  // SALES / Project Management. All three header controls start something new.
  const { canWrite } = useRouteAccess();
  /*
   * Who answers for a booking once it is a project, and it is two questions - see the same pair on
   * Project Management's Projects page.
   *
   * They have to be here too because **one endpoint feeds both screens**. `PATCH /api/sales/projects/:id`
   * is what Edit opens on either of them, so tightening it there and not here would leave this screen
   * offering the CRM an Edit the server then refuses - a control shown to somebody it will turn away,
   * which is the fault Rule 4 exists to stop.
   *
   * What this costs is worth saying plainly: the CRM who books a sale can no longer correct it
   * afterwards, here or anywhere. Making a project and changing one are no longer the same act -
   * once it exists, the studio is working to it, and it belongs to the people working to it. Booking
   * a **new** one is untouched, and so is Duplicate, which books a second.
   */
  const { canRead: administersBranches } = useModuleAccess("ADMIN", "Branch Administration");
  /*
   * The studio-wide grant, beside the staffed seats: `PROJECT / Show All Projects`.
   *
   * Its **Read** half is answered on the server, which stops narrowing the register to the projects
   * this person is named on - so it changes *which rows* they see and nothing else. Its **Read /
   * Write** half is this: being allowed to act on any of them, staffed to them or not.
   *
   * It is here because the staffed rules leave a real gap. A **Yet to Start project is staffed to
   * nobody**, since those seats are filled in on the Start Project form rather than the booking
   * form, so a freshly booked project could be started only by a branch administrator - and the
   * studio has people whose job is exactly that and who are not administrators.
   *
   * Permissions add and never subtract: holding this at Read takes nothing away from what somebody
   * already holds through `PROJECT / Projects` or through being staffed on a project.
   */
  const { canWrite: worksEveryProject } = useModuleAccess("PROJECT", "Show All Projects");
  const linkedEmployeeId = useMemo(() => Number(getAuthenticatedUser()?.linkedEmployeeId) || null, []);
  /*
   * **Changing** it is for anybody the project is staffed to - its Project Manager, its Pre
   * Production Coordinator, its Creative Manager, its Post Production Coordinator - because each of
   * them is working to it and each has reason to correct what it says. **Deleting** it is for its
   * Project Manager alone: a coordinator runs a stage of the work, and removing the project out from
   * under everybody else working to it is not a stage of anything. A branch administrator passes
   * either, and a Super Admin holds that along with everything else.
   *
   * Not the CRM. Booking a project is `SALES / Sales Manager` `READ_WRITE`, which is the right
   * question for making one and the wrong one for unmaking it: that permission used to be the whole
   * of the guard on Edit and Delete, so whoever typed a booking could rewrite or remove it long
   * after the studio had begun working to it.
   *
   * A **Yet to Start project is staffed to nobody** - every one of these fields is filled in on the
   * Start Project form, not the booking form - so until somebody is named, the branch administrator
   * is the only answer to either. `PATCH` and `DELETE /api/sales/projects/:id` make the same two
   * checks, so this hides controls rather than being the thing that protects them.
   */
  const staffedOn = useCallback(
    (project, fields) => Boolean(linkedEmployeeId) && fields.some((field) => project?.[field] === linkedEmployeeId),
    [linkedEmployeeId],
  );
  const canEditProject = useCallback(
    (project) => administersBranches || worksEveryProject || staffedOn(project, PROJECT_STAFF_FIELDS),
    [administersBranches, staffedOn, worksEveryProject],
  );
  const canDeleteProject = useCallback(
    (project) => administersBranches || worksEveryProject || staffedOn(project, PROJECT_STAFF_FIELDS.slice(0, 1)),
    [administersBranches, staffedOn, worksEveryProject],
  );


  // Import, offered in the header's ⋮ and in the table's, defined once so the two cannot open
  // different dialogs. Bookings and Project Management's Projects are one record and one endpoint.
  const bookingImportConfig = canWrite ? {
    prefix: "/api/sales/projects",
    columns: PROJECT_IMPORT_COLUMNS,
    templateName: "booking-import-template",
    title: "Import Bookings",
    onImported: () => loadProjects({ notifyOnError: false }),
  } : undefined;
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * The same records and the same endpoint as Project Management's Projects - a booking and a
   * project are one row - so the same bulk delete answers for both, and `mayDeleteProject` decides
   * per project on the server which of a selection actually goes.
   */
  const bulk = useTableSelection({
    prefix: "/api/sales/projects",
    rows: projects,
    noun: "record",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => loadProjects({ notifyOnError: false }),
  });

  // Editing reuses Create Project's panel, so this screen needs the same two lists behind it that
  // the booking panel loads for itself: the saved group names, and the SALES employees.
  const pickers = useProjectFormPickers({ onError: showError });
  const { density } = useCompactView();
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  // The project whose sale details are being edited, kept apart from Create Project's own flag
  // so the two panels can never be open at once.
  const [editingProject, setEditingProject] = useState(null);
  /*
   * What Create Project opens filled in with, whichever of the two things put it there: a CRM lead
   * being converted, or a project being duplicated. Both are mapped onto the same project-record
   * shape the panel prefills from, so this holds one thing rather than one per source.
   *
   * Null for a project started from the New Project button, which opens blank.
   */
  const [bookingPrefill, setBookingPrefill] = useState(null);
  // The source project's shoots, services and deliverables, read before the panel opens so it can
  // lay them down as its own pending rows. Null for every booking that is not a duplicate.
  const [duplicatePlan, setDuplicatePlan] = useState(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [groupNameGeneratorOpen, setGroupNameGeneratorOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const convertLeadId = searchParams.get("convertLead") || "";
  /*
   * Which converted status the lead should end up reading as, chosen on the pill that opened this.
   *
   * Qua Qua offers "Converted & Followup" beside "Converted" and both open Create Project, so the
   * choice has to reach the save that actually converts the lead. Absent - from New Project, or an
   * older link - the server falls back to "Converted", which is what it always did.
   */
  const convertStatus = searchParams.get("convertStatus") || "";

  async function loadProjects({ notifyOnError = true } = {}) {
    setIsLoading(true);
    try {
      const response = await getSalesProjects();
      setProjects(Array.isArray(response?.data) ? response.data : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load sales projects.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProjects(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function openEdit(project) {
    setEditingProject(project);
    await pickers.loadPickers({ notifyOnError: false });
  }

  async function saveEdit(form) {
    if (!editingProject) return;
    try {
      await updateSalesProject(editingProject.id, salePatchPayload(form));
      setEditingProject(null);
      showSuccess("Sale details updated successfully.");
      await Promise.all([loadProjects({ notifyOnError: false }), pickers.loadGroupNames({ notifyOnError: false })]);
    } catch (error) {
      showError(validationDetail(error) || error.message || "Unable to update sale details.");
      throw error;
    }
  }

  async function saveGroupName(groupName) {
    try {
      await createWhatsappGroupName({ ...groupName, gou: groupName.groupType === "Qua Qua" ? groupName.gou === "Yes" : null });
      setGroupNameGeneratorOpen(false);
      showSuccess("W/A group name saved successfully.");
      await pickers.loadGroupNames({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to save W/A group name.");
      throw error;
    }
  }

  /**
   * Booking the same package for somebody else.
   *
   * The plan is read here rather than inside the panel because it is three requests against the
   * *source* project, which the panel is never told about - it is handed a filled-in form and a
   * plan, exactly as the converted lead and the quotation hand it one. Reading them first also
   * means the panel opens with the shoots already on it rather than filling in underneath somebody.
   *
   * A plan that cannot be read stops the duplicate rather than opening a copy silently missing the
   * services it was sold with: an empty Service Creation section looks like a project that had none.
   */
  async function openDuplicate(project) {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const [shoots, services, deliverables] = await Promise.all([
        getProjectShoots(project.id),
        getProjectServiceAllocations(project.id),
        getProjectDeliverableAllocations(project.id),
      ]);
      const makeKey = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
      setDuplicatePlan(planFromProject({
        shoots: Array.isArray(shoots?.data) ? shoots.data : [],
        services: Array.isArray(services?.data) ? services.data : [],
        deliverables: Array.isArray(deliverables?.data) ? deliverables.data : [],
      }, makeKey));
      setBookingPrefill(projectToDuplicatePrefill(project));
      setProjectFormOpen(true);
    } catch (error) {
      showError(error.message || "Unable to read that project's shoots, so it cannot be duplicated.");
    } finally {
      setIsDuplicating(false);
    }
  }

  /**
   * A CRM lead in the shape CreateProjectFormPanel prefills from.
   *
   * The panel already knows how to fill itself from a project record, so the lead is mapped
   * onto that shape rather than teaching the panel a second one. Only the fields a lead can
   * actually answer are set; the rest stay blank for the user to complete.
   */
  /*
   * `convertedStatus` is passed in rather than read from the search params here, so this closes over
   * nothing that changes - which is what keeps it out of the effect's dependency list below.
   */
  function leadToProjectPrefill(record, convertedStatus = "") {
    const lead = record?.lead || {};
    const details = record?.details || {};
    // The panel parses "+91 9876543210", so the number is handed over in that form.
    const digits = String(lead.contactNumber || lead.phone || "").replace(/\D/g, "").slice(-10);
    const crmGroupType = CRM_GROUP_TYPES.find((type) => type === String(lead.vertical || details.vertical || "").trim()) || "";
    /*
     * Folded to `YYYY-MM-DD`, and dropped entirely where it will not fold.
     *
     * A lead's dates are text, from whatever wrote them - a CSV out of Excel, a Google Sheet, a
     * person typing - so this field holds anything from `2026-12-12` to `09-Sep-26` to a note.
     * Handed over raw it went to the server as it stood, where `new Date()` made an Invalid Date
     * of anything it could not read and the save came back "mainEventDate: Invalid input: expected
     * date, received Date". Create Project has no control for this date, so there was nowhere to
     * go and fix it: the lead simply could not be converted.
     *
     * `toIsoDay` is the CRM board's own reading of a stored date - the same function the tabs and
     * the cells use - so what reaches the project is the day the board shows. A value it cannot
     * read answers "", which leaves the project **Not decided** and bookable, with the date set
     * later in Project Management where it belongs.
     */
    const eventDate = toIsoDay(details.eventPlannedDate || lead.eventPlannedDate || lead.date || "");
    return {
      enquiryId: lead.id || "",
      clientMainNumber: digits ? `+91 ${digits}` : "",
      // A project's vertical is WED / QQ / CORP; the CRM names the same three Dum Dum, Qua Qua
      // and Corp. Handing the CRM's spelling straight over failed validation on the server -
      // "Invalid option: expected one of WED|QQ|CORP" - so every conversion ended at Save Project
      // with nothing but "Validation failed" to go on.
      groupType: crmGroupType,
      vertical: crmGroupType ? derivedVertical(crmGroupType) : "",
      sourceBranch: sourceBranchForCrmBranch(lead.assignedBranch),
      crmName: lead.crm || "",
      // What the Quotation Calculator applied to the lead, ahead of the budget it was entered
      // with: the calculator's total is the studio's own figure for the job, and the budget is the
      // client's opening one. Editable on the form either way.
      initialConvertedValue: String(lead.quotedAmount ?? "").replace(/[^\d.]/g, "") || String(lead.expectedBudget || lead.preferredBudget || "").replace(/[^\d.]/g, ""),
      mainEventDateKnown: Boolean(eventDate),
      mainEventDate: eventDate,
      salesPreProductionRemarks: details.remarks || lead.remarks || "",
      // Carried on the form's own state, as the main event date beside it is: there is no control
      // for it here because it is not a fact about the project - it is which status the lead it
      // came from should be left reading once this project is saved.
      crmLeadStatus: convertedStatus,
    };
  }

  // A conversion arrives as an id in the URL. The lead is loaded here rather than carried
  // through memory, so the form fills from current data even on a reopened link.
  useEffect(() => {
    if (!convertLeadId) return undefined;
    let active = true;
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(convertLeadId)}`)
      .then((response) => {
        if (!active || !response?.data) return;
        setBookingPrefill(leadToProjectPrefill(response.data, convertStatus));
        setProjectFormOpen(true);
      })
      .catch((error) => {
        if (active) showError(error?.message || "Unable to load the converted lead.");
      });
    return () => {
      active = false;
    };
  }, [convertLeadId, convertStatus, showError]);

  // Closing clears the prefill and drops the query string, so a later New Project starts
  // blank and a refresh does not reopen the converted lead.
  function closeProjectForm() {
    setProjectFormOpen(false);
    setBookingPrefill(null);
    // Dropped with the prefill it belongs to, so a later New Project opens on an empty Service
    // Creation section rather than on the last duplicate's shoots.
    setDuplicatePlan(null);
    if (convertLeadId) router.replace("/sales/manager");
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Bookings & Converted" actions={canWrite ? <><Button type="button" onClick={() => setGroupNameGeneratorOpen(true)}>W/A Group-Name Generator</Button><Button type="button" variant="primary" onClick={() => setProjectFormOpen(true)}>Create Project</Button><ImportMenuButton ariaLabel="More booking actions" importConfig={bookingImportConfig} /></> : null} />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1"><ProjectDataTable importConfig={bookingImportConfig} projects={projects} selection={bulk.selection} density={density} loading={isLoading} lastUpdated={lastUpdated} title="Sales Records" fileName="sales-manager" emptyMessage="Sales records will appear here." noMatchMessage="No sales records found." loadingMessage="Loading sales records..." onNotice={showNotice} onEditSaleDetails={(project) => void openEdit(project)} onDuplicate={canWrite ? (project) => void openDuplicate(project) : undefined} canEditSale={canWrite} canEditProject={canEditProject} canDeleteProject={canDeleteProject} readOnly={!canWrite} infoPanelTitle="Sales Details" fillAvailableHeight /></div>
    {projectFormOpen && <ProjectBookingPanel
      prefill={bookingPrefill}
      prefillPlan={duplicatePlan}
      onClose={closeProjectForm}
      /* Saving is what converts the lead, so the conversion is finished with: the prefill and the
         query string were dropped as the panel closed, and a refresh no longer reopens the form on
         a lead that has already become this project. */
      onSaved={() => Promise.all([loadProjects({ notifyOnError: false }), pickers.loadGroupNames({ notifyOnError: false })])}
      onNotice={showSuccess}
      onError={showError}
    />}
    {editingProject && <CreateProjectFormPanel key={`edit-project-${editingProject.id}`} project={editingProject} mode="edit" onClose={() => setEditingProject(null)} onSave={saveEdit} groupNames={pickers.groupNames} isLoadingGroupNames={pickers.isLoadingGroupNames} crmEmployees={pickers.crmEmployees} isLoadingCrmEmployees={pickers.isLoadingCrmEmployees} />}
    {groupNameGeneratorOpen && <WhatsappGroupNameDialog onClose={() => setGroupNameGeneratorOpen(false)} onSave={saveGroupName} />}
  </section>;
}
