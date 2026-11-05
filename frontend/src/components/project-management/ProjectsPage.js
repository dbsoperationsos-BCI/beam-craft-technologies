"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useStickyTab from "@/components/shared/useStickyTab";
import useLinkedProject from "@/components/shared/useLinkedProject";
import useLinkedParam from "@/components/shared/useLinkedParam";
import ProjectDataTable, { ProjectRecordPanel, useProjectRowActions } from "@/components/data-table/ProjectDataTable";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import useProjectMoney from "@/components/project-management/useProjectMoney";
import { moneyColumn, moneyFlag } from "@/lib/projectMoney.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { projectManagementInfoSections } from "@/constants/infoPanelConfig";
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
import { bulkUpdateProjectStatus, deleteSalesProject, getSalesProject, getSalesProjects, saveProjectDraft, sendBackSalesProject, startProject, updateSalesProject } from "@/services/sales/projects.service";
import { saveProjectPaymentSchedule } from "@/services/project-management/project-workflow.service";
import { getWhatsappGroupNames } from "@/services/sales/whatsapp-group-names.service";
import CreateProjectFormPanel from "@/components/sales/CreateProjectFormPanel";
import { salePatchPayload } from "@/components/sales/SaleDetailsSection";
import { PROJECT_BOARD_CARD, PROJECT_STATUSES, projectBoardDropRefusal, projectBoardStatus, projectColumnAmount } from "@/lib/projectStatuses.mjs";
import ProjectBulkStatusDialog from "./ProjectBulkStatusDialog";
import StartProjectFormPanel from "./StartProjectFormPanel";

// One tab per status a project may be given. A project still on an old status (Delivered, Work in
// Progress - Pre & Production...) keeps it, and is under the tab that replaced it - Completed, In
// Progress - read as the Board reads it (`projectBoardStatus`), so a tab and its column agree.
const tabs = ["All", ...PROJECT_STATUSES];

function belongsToProjectTab(project, tab) {
  return tab === "All" || projectBoardStatus(project) === tab;
}

const BOARD_COLUMNS = PROJECT_STATUSES.map((status) => ({ value: status, label: status }));

function DeleteProjectDialog({ project, loading, onClose, onConfirm }) {
  return <ConfirmDialog
    open={Boolean(project)}
    title="Delete project?"
    message={`${project?.eventId || project?.enquiryId || "This project"} moves to Resource Management → Project Vault, with its Image Selection gallery, client login and client storage records. Nothing is erased: it can be restored from there.`}
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
  // Editing a booking without being staffed on it, as its own grant - see `SALES / Booking Edit`.
  const { canWrite: mayEditBookings } = useModuleAccess("SALES", "Booking Edit");
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
  // Whoever plans projects (PROJECT / Projects Read / Write) edits a project's sale details too, beside
  // its plan - the studio's rule for this screen. The server asks the same (`mayEditProject`).
  const canEditProject = useCallback(
    (project) => canPlanProjects || mayEditBookings || administersBranches || worksEveryProject || staffedOn(project, PROJECT_STAFF_FIELDS),
    [administersBranches, canPlanProjects, mayEditBookings, staffedOn, worksEveryProject],
  );
  const canDeleteProject = useCallback(
    (project) => administersBranches || worksEveryProject || staffedOn(project, PROJECT_STAFF_FIELDS.slice(0, 1)),
    [administersBranches, staffedOn, worksEveryProject],
  );
  /*
   * The plan of a project already running: its Project Manager, a branch administrator, whoever works
   * every project - and whoever plans projects, whose permission is enough to change a started plan
   * too (`mayEditStartedProject` on the server). A coordinator works a stage of it and does not re-plan it.
   */
  const canEditStarted = useCallback(
    (project) => canPlanProjects || canDeleteProject(project),
    [canDeleteProject, canPlanProjects],
  );
  /*
   * Whether this viewer may change this project's payment schedule - what decides whether Edit Sale
   * Details shows it as a form or as a reading. The two ways through `PUT .../payment-schedule`:
   * `SALES / Booking Edit`, which changes a booking and its schedule with it; or may you plan
   * projects at all **and** may you still change *this* project.
   */
  const canEditSchedule = useCallback(
    (project) => mayEditBookings
      || (canPlanProjects && ((project?.projectStatus || "Yet to Start") === "Yet to Start" || canEditStarted(project))),
    [canEditStarted, canPlanProjects, mayEditBookings],
  );

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
  const [sendingBack, setSendingBack] = useState(null);
  const [isSendingBack, setIsSendingBack] = useState(false);
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
    deleteMessage: "The selected projects move to Resource Management → Project Vault, with their Image Selection galleries, client logins and client storage records. Nothing is erased: they can be restored from there, or deleted permanently.",
    showSuccess,
    showError,
    onDeleted: () => loadProjects({ notifyOnError: false }),
  });

  /*
   * Update status over the ticked projects, beside Export and Delete - for whoever may plan projects;
   * the server still checks each project is theirs to change and says how many were left alone.
   */
  // Open with the ticked projects (`project` null), or with one project from its row's ⋮.
  const [statusTarget, setStatusTarget] = useState(null);
  const selectedCount = bulk.selectedCount;
  const selection = useMemo(() => (bulk.selection ? {
    ...bulk.selection,
    actions: canPlanProjects && selectedCount ? [{ id: "status", label: "Update", variant: "primary", onClick: () => setStatusTarget({ project: null }) }] : [],
  } : undefined), [bulk.selection, canPlanProjects, selectedCount, setStatusTarget]);

  async function saveBulkStatus(status) {
    const single = statusTarget?.project;
    try {
      const response = await bulkUpdateProjectStatus(single ? [single.id] : [...bulk.selectedIds], status);
      const { updated = 0, refused = 0, missing = 0 } = response?.data || {};
      const left = refused + missing;
      if (single && !updated) {
        showError("Only this project's Project Manager or a branch administrator can change it now it has started.");
        return;
      }
      showSuccess([
        `${updated} project${updated === 1 ? "" : "s"} set to ${status}.`,
        left ? `${left} ${left === 1 ? "was" : "were"} left alone: only its Project Manager or a branch administrator can change a started project.` : "",
      ].filter(Boolean).join(" "));
      setStatusTarget(null);
      if (!single) bulk.clear();
      // One project from its row's menu is read again alone; ticked projects, the register.
      if (single) await refreshProject(single.id);
      else await loadProjects({ notifyOnError: false });
    } catch (error) {
      showError(error.message || "Unable to update the selected projects.");
    }
  }

  async function loadProjects({ notifyOnError = true } = {}) {
    setIsLoading(true);
    try {
      const response = await getSalesProjects();
      // A project sent back to Bookings & Converted is off this page until it is edited and saved there.
      setProjects(Array.isArray(response?.data) ? response.data.filter((project) => !project.sentBackAt) : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load projects.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  /*
   * One project read again after it was changed, and its row replaced in place - rather than the
   * whole register downloaded again, which on a studio's real data is megabytes, and which Edit
   * Project's autosave used to do after every field. A project now out of this page - sent back,
   * deleted, or out of the reader's reach - leaves the list. Bulk changes and imports still read
   * the register whole, since they touch many rows.
   */
  async function refreshProject(id) {
    try {
      const response = await getSalesProject(id);
      const fresh = response?.data;
      setProjects((current) => {
        const rest = current.filter((project) => project.id !== id);
        if (!fresh || fresh.sentBackAt) return rest;
        const at = current.findIndex((project) => project.id === id);
        return at === -1 ? [fresh, ...rest] : current.map((project) => (project.id === id ? fresh : project));
      });
      setLastUpdated(new Date());
    } catch (error) {
      if (error?.status === 404) setProjects((current) => current.filter((project) => project.id !== id));
      else await loadProjects({ notifyOnError: false });
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

  // `shootId`: opened from a shoot's row - the form opens on that shoot's edit dialog. A project's own
  // Edit passes none, so a shoot opened before is never opened again.
  const [editShootId, setEditShootId] = useState(null);
  async function openEdit(project, shootId = null) {
    setEditShootId(shootId);
    setEditingProject(project);
    await loadEditOptions();
  }

  // The sale first, then its schedule - the rows are shares of the Signed Quotation this save may
  // have changed, and a schedule arrives only from somebody the server will let change one.
  // `scheduleOnly`: only the schedule changed (opened with Edit), so the sale is not sent again.
  async function saveEdit(form, payment, schedule, { scheduleOnly = false } = {}) {
    try {
      if (!scheduleOnly) await updateSalesProject(editingProject.id, salePatchPayload(form));
      if (schedule) await saveProjectPaymentSchedule(editingProject.id, schedule);
      setEditingProject(null);
      showSuccess(scheduleOnly ? "Payment schedule updated successfully." : "Sale details updated successfully.");
      await refreshProject(editingProject.id);
    } catch (error) {
      showError(error.message || "Unable to update sale details.");
      throw error;
    }
  }

  /*
   * Start / Edit Project shows the sale read-only, so it asks for none of the lists a sale is
   * edited with - the generated group names and the SALES employees are Edit Sale Details' own.
   */
  // `view`: the form's tab to open on - "payments" from the calendar's Update payment.
  const [editView, setEditView] = useState("details");
  function openPlan(project, shootId = null, view = "details") {
    setEditShootId(shootId);
    setEditView(view);
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
      await refreshProject(startingProject.id);
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
      await refreshProject(startingProject.id);
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
      await refreshProject(editingWorkflowProject.id);
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
      await refreshProject(editingWorkflowProject.id);
    } catch (error) {
      showError(error.message || "Unable to save project.");
      throw error;
    }
  }

  /*
   * Send Back: the project returns to Bookings & Converted's Sent Back tab to be corrected, and leaves
   * this page until it is edited and saved there. Said only once the server has done it; the list is
   * then read again rather than patched, so what is shown is what was written.
   */
  async function confirmSendBack() {
    if (!sendingBack) return;
    setIsSendingBack(true);
    try {
      await sendBackSalesProject(sendingBack.id);
      setSendingBack(null);
      showSuccess("Project sent back to Bookings & Converted.");
      await refreshProject(sendingBack.id);
    } catch (error) {
      showError(error.message || "Unable to send the project back.");
    } finally {
      setIsSendingBack(false);
    }
  }

  async function confirmDelete() {
    if (!deletingProject) return;
    setIsDeleting(true);
    try {
      await deleteSalesProject(deletingProject.id);
      setDeletingProject(null);
      showSuccess("Project deleted successfully.");
      await refreshProject(deletingProject.id);
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

  /*
   * And the same for a "Navigate to" from another board, which names its project in the address: the
   * board comes to All if the project is not on the tab in front of the reader, and the table then
   * selects the row and scrolls to it (`useLinkedProject`).
   */
  const [linkedEventId, clearLinkedProject] = useLinkedProject({ tab: activeTab, onTab: setActiveTab });

  /*
   * `&edit=1` beside it: open that project's own form.
   *
   * The Overall Status tab's **Project Initiation** stage carries an Update wherever it is read, and
   * the editor behind it is this page's - one owner for the project's form, rather than a second
   * copy of its saves and its autosave on two more boards. So the boards link here, and this opens
   * what they asked for.
   *
   * Through `openPlan`, which is the same door the row's own ⋮ uses: it decides again whether this
   * reader may change a project that has started, and says so if not. A link is not a permission.
   *
   * `&view=payments` with it opens the form on its Payments tab - the calendar's Update payment.
   * Both go from the address in one replace, so a reload does not open the form again.
   */
  const [editLink] = useLinkedParam("edit");
  const [viewLink] = useLinkedParam("view");
  const clearEditLink = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("edit");
    next.delete("view");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router, searchParams]);
  /*
   * Taken from the address the moment it arrives and held until the projects are in. The table's
   * landing clears `?project=` straight away - long before the list has loaded - and the request
   * used to go with it, leaving only the filter: the form never opened.
   */
  const [editRequest, setEditRequest] = useState(null);
  if (editLink && linkedEventId && editRequest?.eventId !== linkedEventId) {
    setEditRequest({ eventId: linkedEventId, view: viewLink === "payments" ? "payments" : "details" });
  }
  useEffect(() => { if (editRequest && editLink) clearEditLink(); }, [clearEditLink, editLink, editRequest]);
  useEffect(() => {
    if (!editRequest || editRequest.opened) return undefined;
    const row = projects.find((project) => project.eventId === editRequest.eventId);
    if (!row) return undefined;
    const timer = window.setTimeout(() => { setEditRequest({ ...editRequest, opened: true }); openPlan(row, null, editRequest.view); }, 0);
    return () => window.clearTimeout(timer);
    // `openPlan` is this page's own function, stable enough for the one press it answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest, projects]);

  /*
   * The Board: every project in a column per status, in the tabs' order - so the status tabs, which
   * only filter by status, step aside while it is shown. A card opens the project's record, as a
   * double-click on its row does; dropping one on another column opens the row's own Update status
   * with that status chosen, still to be confirmed - offered to whoever the ⋮ offers it to.
   */
  const [layout, setLayout] = useTableBoardLayout("project-management-projects");
  const onBoard = layout === "board";
  // The projects' money under each column, and "Balance due ₹…" on a card whose client still owes - only for
  // somebody who may see a project's Payments tab (`useProjectMoney`), and only while the Board is open.
  const money = useProjectMoney(onBoard ? projects : null);
  const [boardViewing, setBoardViewing] = useState(null);
  // The tab the board's record opens on: Activity for the ⋮'s "View activity", else its details.
  const [boardTab, setBoardTab] = useState(null);
  // The card's ⋮ is the row's ⋮: the same items, from the same props the table below is handed.
  const projectActions = useProjectRowActions({
    board: "projects",
    onView: (project) => { setBoardTab(null); setBoardViewing(project); },
    onViewActivity: (project) => { setBoardTab("activity"); setBoardViewing(project); },
    onNotice: showNotice,
    onEditSaleDetails: (project) => void openEdit(project),
    onStartProject: (project) => void openPlan(project),
    onEditProject: (project) => void openPlan(project),
    onUpdateStatus: canPlanProjects ? (project) => setStatusTarget({ project }) : undefined,
    onSendBack: canWrite ? setSendingBack : undefined,
    onDelete: setDeletingProject,
    readOnly: !canPlanProjects && !canEditSale,
    canEditSale,
    canPlan: canPlanProjects,
    canEditStarted,
    canEditProject,
    canDeleteProject,
  });
  // A link naming a project to open (`?project=`) opens its record on the Board too.
  const boardLinked = onBoard && openEventId ? projects.find((project) => project.eventId === openEventId) || null : null;
  const boardRecord = boardViewing || boardLinked;
  // A "Jump to" from another board filters the table to its project, so it brings the table back.
  useEffect(() => {
    if (!linkedEventId || !onBoard) return undefined;
    const timer = window.setTimeout(() => setLayout("table"), 0);
    return () => window.clearTimeout(timer);
  }, [linkedEventId, onBoard, setLayout]);
  // Never out of Yet to Start by a drop: that is Start Project's, with its setup and Pre Production.
  const canDropAt = useCallback((project, to) => canPlanProjects && !projectBoardDropRefusal(project, to), [canPlanProjects]);
  const dropProject = useCallback((project, to) => setStatusTarget({ project, status: to }), [setStatusTarget]);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Projects" tabs={onBoard ? undefined : tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))} tabValue={activeTab} onTabChange={setActiveTab} tabsAriaLabel="Project status filters" actions={<TableBoardSwitch value={layout} onChange={setLayout} />}
      menu={<ImportMenuButton ariaLabel="More project actions" importConfig={projectImportConfig} />} />
    {statusTarget && <ProjectBulkStatusDialog count={statusTarget.project ? 1 : selectedCount} project={statusTarget.project} initialStatus={statusTarget.status} onSave={saveBulkStatus} onClose={() => setStatusTarget(null)} />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {onBoard ? <KanbanBoard
      rows={projects}
      columns={BOARD_COLUMNS}
      statusOf={projectBoardStatus}
      card={PROJECT_BOARD_CARD}
      columnAmount={money ? (rows) => moneyColumn(rows, money) : projectColumnAmount}
      cardFlag={money ? (row) => moneyFlag(row, money) : undefined}
      onOpen={setBoardViewing}
      cardActions={projectActions}
      canDropAt={canDropAt}
      onDrop={dropProject}
      refusalFor={(project, to) => (canPlanProjects ? projectBoardDropRefusal(project, to) : "")}
      loading={isLoading}
      noun="projects"
      ariaLabel="Projects board"
    /> : <div className="min-h-0 flex-1"><ProjectDataTable key={activeTab} board="projects" revealEventId={linkedEventId} onRevealed={clearLinkedProject} openEventId={openEventId} onCloseOpenedEvent={clearOpenedEvent} projects={tabProjects} selection={selection} density={density} loading={isLoading} lastUpdated={lastUpdated} title="Project Records" fileName="projects" emptyMessage="No projects found." noMatchMessage="No projects found." loadingMessage="Loading projects..." onNotice={showNotice} onEditSaleDetails={(project) => void openEdit(project)} onStartProject={(project) => void openPlan(project)} onEditProject={(project) => void openPlan(project)} onEditShoot={(project, shoot, route) => (route === "plan" ? openPlan(project, shoot.id) : void openEdit(project, shoot.id))} onUpdateStatus={canPlanProjects ? (project) => setStatusTarget({ project }) : undefined} onSendBack={canWrite ? setSendingBack : undefined} onDelete={setDeletingProject} importConfig={projectImportConfig} infoPanelTitle="Project Details" projectManagement showPayments={canReadCash} showStatus readOnly={!canPlanProjects && !canEditSale} canEditSale={canEditSale} canPlan={canPlanProjects} canEditStarted={canEditStarted} canEditProject={canEditProject} canDeleteProject={canDeleteProject} fillAvailableHeight /></div>}
    {onBoard && <ProjectRecordPanel project={boardRecord} initialTab={boardTab} sections={projectManagementInfoSections} projectManagement showPayments={canReadCash} showStatus onClose={() => { setBoardViewing(null); setBoardTab(null); clearOpenedEvent(); }} />}
    {editingProject && <CreateProjectFormPanel project={editingProject} mode="edit" editShootId={editShootId} canEditSchedule={canEditSchedule(editingProject)} onClose={() => setEditingProject(null)} onSave={saveEdit} groupNames={groupNames} isLoadingGroupNames={isLoadingGroupNames} crmEmployees={crmEmployees} isLoadingCrmEmployees={isLoadingCrmEmployees} />}
    {startingProject && <StartProjectFormPanel key={`start-project-${startingProject.id}`} project={startingProject} editShootId={editShootId} initialView={editView} showPayments={canReadCash && editView === "payments"} onClose={() => setStartingProject(null)} onSaveDraft={saveStartProjectDraft} onStart={saveStartProject} onShootChange={() => refreshProject(startingProject.id)} />}
    {/* Edit Project carries the record view's Payments tab too, behind the same pair of
        permissions: this page's own, and Accounts' Cash Management read that the figures answer
        to. Without the second the panel opens exactly as before, with no tab bar at all. */}
    {editingWorkflowProject && <StartProjectFormPanel key={`edit-project-${editingWorkflowProject.id}`} project={editingWorkflowProject} mode="edit" editShootId={editShootId} initialView={editView} showPayments={canReadCash} onClose={() => setEditingWorkflowProject(null)} onSaveDraft={saveWorkflowEditDraft} onStart={saveWorkflowEdit} onShootChange={() => refreshProject(editingWorkflowProject.id)} />}
    <DeleteProjectDialog project={deletingProject} loading={isDeleting} onClose={() => setDeletingProject(null)} onConfirm={() => void confirmDelete()} />
    <ConfirmDialog
      open={Boolean(sendingBack)}
      title="Send back to Bookings & Converted?"
      message={`${sendingBack?.whatsappGroupName || sendingBack?.eventId || "This project"} moves to the Sent Back tab of Bookings & Converted to be corrected, and leaves this page until it is edited and saved there. Its shoots, quotation, payments and history stay as they are.`}
      confirmLabel="Send Back"
      busyLabel="Sending back..."
      // Not a deletion: nothing is lost, so the confirm is the page's ordinary primary.
      tone="primary"
      loading={isSendingBack}
      onCancel={() => setSendingBack(null)}
      onConfirm={() => void confirmSendBack()}
    />
  </section>;
}
