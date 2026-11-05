"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useStickyTab from "@/components/shared/useStickyTab";
import ProjectDataTable from "@/components/data-table/ProjectDataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { PROJECT_IMPORT_COLUMNS } from "@/constants/importColumns";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import { getAuthenticatedUser } from "@/lib/auth";
import { PROJECT_STAFF_FIELDS } from "@/constants/projectStaff";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useCompactView from "@/components/shared/useCompactView";
import { getCrmEmployees } from "@/services/sales/employees.service";
import { deleteSalesProject, getSalesProjects, saveProjectDraft, startProject, updateSalesProject } from "@/services/sales/projects.service";
import { getWhatsappGroupNames } from "@/services/sales/whatsapp-group-names.service";
import CreateProjectFormPanel from "@/components/sales/CreateProjectFormPanel";
import { salePatchPayload } from "@/components/sales/SaleDetailsSection";
import StartProjectFormPanel from "./StartProjectFormPanel";

const tabs = ["All", "Yet to Start", "In Progress", "Completed"];
const inProgressStatuses = new Set([
  "Work in Progress - Pre & Production",
  "Work in Progress - Post Production",
]);

function belongsToProjectTab(project, tab) {
  const status = project.projectStatus || "Yet to Start";
  if (tab === "All") return true;
  if (tab === "In Progress") return inProgressStatuses.has(status);
  if (tab === "Completed") return status === "Delivered";
  return status === "Yet to Start";
}

function DeleteProjectDialog({ project, loading, onClose, onConfirm }) {
  return <ConfirmDialog
    open={Boolean(project)}
    title="Delete project?"
    message={`This removes ${project?.eventId || project?.enquiryId || "this project"} from active project lists. The project record will be retained safely.`}
    confirmLabel="Delete"
    busyLabel="Deleting..."
    loading={loading}
    onCancel={onClose}
    onConfirm={onConfirm}
  />;
}

export default function ProjectsPage() {
  /*
   * PROJECT / Projects decides the plan: starting a project, and editing what it is made of. The
   * sale underneath it is still Sales Manager's, so editing it and deleting the record are asked
   * for separately - a project manager plans the shoot without being able to delete the sale it
   * came from. The view switch reads the same records either way, so it stays.
   *
   * The menu is one "Edit" now rather than one entry per permission: `PROJECT / Projects` opens the
   * plan form, and a role holding only the sale's permission opens Edit Sale Details instead. The
   * plan form shows the sale read-only either way, so it is never the screen that changes it.
   */
  const { canWrite } = useRouteAccess();
  const { canWrite: canEditSale } = useModuleAccess("SALES", "Sales Manager");
  /*
   * The Payments tab of a project's record takes Accounts' own permission as well as this page's.
   * The figures on it are Accounts' cash entries, so being able to open a project is not by itself
   * a reason to be shown what it earned — somebody needs both, and the endpoint asks for both.
   * Without it the record view opens exactly as it did before, with no tab bar at all.
   */
  const { canRead: canReadCash } = useModuleAccess("ACCOUNTS", "Cash Management");
  /*
   * Who may still change a project once it has started.
   *
   * Planning is `PROJECT / Projects`, and that is the right question up until the project starts.
   * After that the plan is being worked to - shoots rostered, services allocated, money scheduled -
   * and changing it belongs to the person answerable for the work: its **Project Manager**, or
   * whoever runs the branch, which is `ADMIN / Branch Administration`. A Super Admin holds that
   * along with everything else, so they are covered without a role test - the same reason the
   * server checks the permission rather than `req.user.role`.
   *
   * The employee behind this login is what a Project Manager is matched on; a login with none
   * cannot be one, and falls through to the branch permission.
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
  /*
   * May this person plan a project at all - either the register's own write, or the studio-wide
   * grant. It mirrors `plansAProject` on the server, which guards the twelve per-project plan
   * routes; the studio's own vocabulary (service and deliverable definitions, option sets) stays on
   * `PROJECT / Projects` alone, because somebody trusted with every project is not thereby trusted
   * to rewrite the lists every project is planned from.
   */
  const canPlanProjects = canWrite || worksEveryProject;
  const linkedEmployeeId = useMemo(() => Number(getAuthenticatedUser()?.linkedEmployeeId) || null, []);
  /*
   * The two questions a project's record asks, and they have different answers.
   *
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
  /*
   * The plan of a project already running is the Project Manager's, unchanged: a coordinator works
   * a stage of it and does not re-plan it. Same shape, narrower list, so the two cannot be confused.
   */
  const canEditStarted = canDeleteProject;

  /*
   * Import, offered in two places and defined once.
   *
   * The header's ⋮ is where people look - beside the button that adds one record, the way Leads &
   * Followups has always had it - and the table's own ⋮ carries it as well. Both take this, so they
   * cannot open different dialogs or post to different endpoints.
   *
   * Gated on Sales Manager write because that is what `POST /api/sales/projects/import` answers to:
   * a booking and a project are one record, and creating one is a sales write wherever it is done.
   */
  const projectImportConfig = canEditSale ? {
    prefix: "/api/sales/projects",
    columns: PROJECT_IMPORT_COLUMNS,
    templateName: "project-import-template",
    title: "Import Projects",
    onImported: () => loadProjects({ notifyOnError: false }),
  } : undefined;
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useStickyTab("project-management-projects", "All", tabs);
  const [editingProject, setEditingProject] = useState(null);
  const [startingProject, setStartingProject] = useState(null);
  const [editingWorkflowProject, setEditingWorkflowProject] = useState(null);
  const [deletingProject, setDeletingProject] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [groupNames, setGroupNames] = useState([]);
  const [isLoadingGroupNames, setIsLoadingGroupNames] = useState(false);
  const [crmEmployees, setCrmEmployees] = useState([]);
  const [isLoadingCrmEmployees, setIsLoadingCrmEmployees] = useState(false);

  const tabCounts = useMemo(() => Object.fromEntries(tabs.map((tab) => [tab, projects.filter((project) => belongsToProjectTab(project, tab)).length])), [projects]);
  const tabProjects = useMemo(() => projects.filter((project) => belongsToProjectTab(project, activeTab)), [activeTab, projects]);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * `canDelete` is the screen's own Read / Write, deliberately not `canDeleteProject` beside it:
   * that is a *per project* predicate, and a selection is not one project. Which projects then go
   * is decided per project on the server by `mayDeleteProject` - the Project Manager, whoever
   * administers the branch, whoever works every project - so a selection over a whole tab deletes
   * the ones this person manages and leaves the rest ticked with the sentence saying how many. That
   * rule is asked inside `deleteProjectRecord`, because `requireProjectDeleter` cannot guard a
   * route whose ids arrive in the body.
   *
   * The boxes stay on every row rather than only the deletable ones, because Delete is not all they
   * lead to: exporting the ticked rows is for anybody who may read them.
   */
  const bulk = useTableSelection({
    prefix: "/api/sales/projects",
    rows: tabProjects,
    noun: "project",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => loadProjects({ notifyOnError: false }),
  });

  async function loadProjects({ notifyOnError = true } = {}) {
    setIsLoading(true);
    try {
      const response = await getSalesProjects();
      setProjects(Array.isArray(response?.data) ? response.data : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load projects.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function loadEditOptions() {
    setIsLoadingGroupNames(true);
    setIsLoadingCrmEmployees(true);
    const [groupResult, crmResult] = await Promise.allSettled([getWhatsappGroupNames(), getCrmEmployees()]);
    if (groupResult.status === "fulfilled") setGroupNames(Array.isArray(groupResult.value?.data) ? groupResult.value.data : []);
    else showError(groupResult.reason?.message || "Unable to load available WhatsApp group names.");
    if (crmResult.status === "fulfilled") setCrmEmployees(Array.isArray(crmResult.value?.data) ? crmResult.value.data : []);
    else showError(crmResult.reason?.message || "Unable to load SALES employees.");
    setIsLoadingGroupNames(false);
    setIsLoadingCrmEmployees(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProjects(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function openEdit(project) {
    setEditingProject(project);
    await loadEditOptions();
  }

  async function saveEdit(form) {
    try {
      await updateSalesProject(editingProject.id, salePatchPayload(form));
      setEditingProject(null);
      showSuccess("Sale details updated successfully.");
      await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to update sale details.");
      throw error;
    }
  }

  /*
   * Start / Edit Project shows the sale read-only, so it asks for none of the lists a sale is
   * edited with - the generated group names and the SALES employees are Edit Sale Details' own.
   */
  function openPlan(project) {
    if ((project.projectStatus || "Yet to Start") === "Yet to Start") {
      setStartingProject(project);
      return;
    }
    // Guarded here as well as on the menu: the panel is a screen, and a screen may not rely on the
    // control that opens it having been hidden. The server refuses the write either way.
    if (!canEditStarted(project)) {
      showError("This project has started, so only its Project Manager or a branch administrator can change it.");
      return;
    }
    setEditingWorkflowProject(project);
  }

  async function saveStartProjectDraft(payload) {
    if (!startingProject) return;
    try {
      await saveProjectDraft(startingProject.id, payload);
      await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to save draft.");
      throw error;
    }
  }

  async function saveStartProject(payload) {
    if (!startingProject) return;

    try {
      await startProject(startingProject.id, payload);
      setStartingProject(null);
      showSuccess("Project started successfully.");
      await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to start project.");
      throw error;
    }
  }

  /**
   * The background save while Edit Project is open, and nothing else.
   *
   * Deliberately separate from `saveWorkflowEdit`: that one is Submit, and it closes the panel.
   * Pointing the autosave at it meant every edited field saved and then shut the form a moment
   * later, mid-typing. This keeps the panel open — the same way Start Project's own draft save
   * already behaves.
   */
  async function saveWorkflowEditDraft(payload) {
    if (!editingWorkflowProject) return;
    try {
      await saveProjectDraft(editingWorkflowProject.id, payload);
      await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to save draft.");
      throw error;
    }
  }

  async function saveWorkflowEdit(payload) {
    if (!editingWorkflowProject) return;
    try {
      await saveProjectDraft(editingWorkflowProject.id, payload);
      setEditingWorkflowProject(null);
      showSuccess("Project saved successfully.");
      await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to save project.");
      throw error;
    }
  }

  async function confirmDelete() {
    if (!deletingProject) return;
    setIsDeleting(true);
    try {
      await deleteSalesProject(deletingProject.id);
      setDeletingProject(null);
      showSuccess("Project deleted successfully.");
      await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to delete project.");
    } finally {
      setIsDeleting(false);
    }
  }

  /*
   * A project linked to from elsewhere - the studio calendar sends a shoot or a main event here,
   * naming the project by its Event ID in the query string.
   *
   * The id lives in the URL rather than in a handoff between the two screens, so the link is a real
   * link: it can be pasted, bookmarked and reloaded, and Back closes the panel rather than leaving
   * the page in a state nothing put it in. Closing the panel clears the parameter with `replace`,
   * which keeps that one closing out of the history rather than making Back reopen what was just
   * shut.
   */
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openEventId = searchParams.get("project") || "";
  const clearOpenedEvent = useCallback(() => {
    if (!openEventId) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("project");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [openEventId, pathname, router, searchParams]);

  /*
   * A linked project may be on any tab, and the page opens on whichever one was last used. Without
   * this, following a link to a completed project while the board is on "Yet to Start" lands on a
   * list that does not contain it and opens nothing at all - a link that silently does nothing.
   */
  useEffect(() => {
    if (!openEventId || activeTab === "All") return;
    if (tabProjects.some((project) => project.eventId === openEventId)) return;
    if (projects.some((project) => project.eventId === openEventId)) setActiveTab("All");
  }, [openEventId, activeTab, tabProjects, projects, setActiveTab]);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Projects" tabs={tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))} tabValue={activeTab} onTabChange={setActiveTab} tabsAriaLabel="Project status filters" actions={<ImportMenuButton ariaLabel="More project actions" importConfig={projectImportConfig} />} />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1"><ProjectDataTable key={activeTab} openEventId={openEventId} onCloseOpenedEvent={clearOpenedEvent} projects={tabProjects} selection={bulk.selection} density={density} loading={isLoading} lastUpdated={lastUpdated} title="Project Records" fileName="projects" emptyMessage="No projects found." noMatchMessage="No projects found." loadingMessage="Loading projects..." onNotice={showNotice} onEditSaleDetails={(project) => void openEdit(project)} onStartProject={(project) => void openPlan(project)} onEditProject={(project) => void openPlan(project)} onDelete={setDeletingProject} importConfig={projectImportConfig} infoPanelTitle="Project Details" projectManagement showPayments={canReadCash} readOnly={!canPlanProjects && !canEditSale} canEditSale={canEditSale} canPlan={canPlanProjects} canEditStarted={canEditStarted} canEditProject={canEditProject} canDeleteProject={canDeleteProject} fillAvailableHeight /></div>
    {editingProject && <CreateProjectFormPanel project={editingProject} mode="edit" onClose={() => setEditingProject(null)} onSave={saveEdit} groupNames={groupNames} isLoadingGroupNames={isLoadingGroupNames} crmEmployees={crmEmployees} isLoadingCrmEmployees={isLoadingCrmEmployees} />}
    {startingProject && <StartProjectFormPanel key={`start-project-${startingProject.id}`} project={startingProject} onClose={() => setStartingProject(null)} onSaveDraft={saveStartProjectDraft} onStart={saveStartProject} onShootChange={() => loadProjects({ notifyOnError: false })} />}
    {/* Edit Project carries the record view's Payments tab too, behind the same pair of
        permissions: this page's own, and Accounts' Cash Management read that the figures answer
        to. Without the second the panel opens exactly as before, with no tab bar at all. */}
    {editingWorkflowProject && <StartProjectFormPanel key={`edit-project-${editingWorkflowProject.id}`} project={editingWorkflowProject} mode="edit" showPayments={canReadCash} onClose={() => setEditingWorkflowProject(null)} onSaveDraft={saveWorkflowEditDraft} onStart={saveWorkflowEdit} onShootChange={() => loadProjects({ notifyOnError: false })} />}
    <DeleteProjectDialog project={deletingProject} loading={isDeleting} onClose={() => setDeletingProject(null)} onConfirm={() => void confirmDelete()} />
  </section>;
}
