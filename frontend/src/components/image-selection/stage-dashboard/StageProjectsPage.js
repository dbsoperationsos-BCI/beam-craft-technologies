"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import CreateImageSelectionProject from "@/components/image-selection/CreateImageSelectionProject";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import ImageSelectionProjectWorkspace from "@/components/image-selection/ImageSelectionProjectWorkspace";
import ProjectActionDialog from "@/components/image-selection/ProjectActionDialog";
import ProjectSidebar from "@/components/image-selection/ProjectSidebar";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { createVisualCurationProject, deleteModuleProject, editModuleProject, listModuleProjects } from "@/services/image-selection/module-projects.service";
import { getAiCullingDashboard, getAiEditingDashboard, getSignatureAlbumDashboard } from "@/services/image-selection/stage-dashboards.service";
import { toWorkspaceProject } from "@/lib/imageSelectionProjectSidebar.mjs";
import { PROJECT_MODULES, STAGE_ROUTES, createdProjectsText, linkChangesText, manualProjectModules, stageDashboard, stageProjectsHref, stageSections, stageSidebarStatuses, stageStatusByProject } from "@/lib/stageDashboards.mjs";
import ProjectModuleLinks from "./ProjectModuleLinks";

const LOADERS = { culling: getAiCullingDashboard, editing: getAiEditingDashboard, album: getSignatureAlbumDashboard };

/**
 * Visual Curation → AI Culling, AI Editing or Signature Album → Projects: the module's own projects,
 * managed the way Photo Selection's are - the same sidebar (search, a status filter, New Project,
 * the ⋮ with Edit and Delete) beside the same workspace, opened on this module alone.
 *
 * The projects are this module's own records (`GET /api/image-selection/module-projects`), each
 * with its own ID, name and client, plus the projects from Project Management this module is on.
 * New Project creates one here, and in each Linked Module ticked, in one submission. Edit changes
 * this module's project alone and shows the projects it is linked with. Delete removes this
 * module's project: the photos stay for the projects it was created with, and go only when this
 * module was the last on them.
 *
 * Everything answers to this module's own permission - the route's - and nothing here needs Photo
 * Selection's: Read opens the list and the projects, Read / Write creates, edits and deletes.
 */
export default function StageProjectsPage({ stage }) {
  return <Suspense fallback={null}><StageProjects stage={stage} /></Suspense>;
}

function StageProjects({ stage }) {
  const spec = stageDashboard(stage);
  const label = PROJECT_MODULES[stage].label;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite: canManage } = useRouteAccess();
  const { notice: floating, showSuccess, clearNotice } = useNotice();
  const requestedProjectId = searchParams.get("projectId");
  const requestedFolderId = searchParams.get("folderId");
  const requestedLinkId = searchParams.get("at");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projects, setProjects] = useState([]);
  const [statusByProject, setStatusByProject] = useState({});
  const [selectedProject, setSelectedProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  // Delete: `{ mode: "module" | "project", project }` - which one is decided by the project's modules.
  const [removal, setRemoval] = useState(null);
  const [removalBusy, setRemovalBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      // The module's statuses ride on its own dashboard read; a failure there leaves the dots at
      // "not started" rather than hiding the projects.
      const [response, summary] = await Promise.all([
        listModuleProjects(stage, { search }),
        LOADERS[stage]({ range: "lifetime" }).catch(() => null),
      ]);
      const rows = response.data || [];
      setProjects(rows);
      setStatusByProject(stageStatusByProject(stage, summary?.data?.rows || []));
      setNotice("");
      return rows;
    } catch (error) {
      setNotice(error.message || `Unable to load ${spec.title} projects.`);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [search, stage, spec.title]);

  useEffect(() => {
    const timer = window.setTimeout(loadProjects, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  // A project opened by link - a dashboard row, another module's "Open …" - wins over whatever was
  // selected here until something else is picked, which clears the link.
  const linkedProject = useMemo(() => {
    if (!requestedProjectId) return null;
    const match = projects.find((project) => String(project.id) === requestedProjectId);
    return match ? toWorkspaceProject(match) : null;
  }, [projects, requestedProjectId]);
  const folderTarget = useMemo(
    () => (linkedProject && requestedFolderId ? { id: requestedFolderId, at: requestedLinkId } : null),
    [linkedProject, requestedFolderId, requestedLinkId],
  );
  const activeProject = linkedProject || selectedProject;
  function selectProject(project) {
    setSelectedProject(project);
    if (requestedProjectId) router.replace(STAGE_ROUTES[stage].projects, { scroll: false });
  }
  function applyProjectUpdate(updated) {
    if (!updated) return;
    setProjects((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    setSelectedProject((current) => (current?.id === updated.id ? toWorkspaceProject(updated) : current));
  }
  // "Open AI Editing" and the like: the linked project, in that module's own Projects page.
  const openStage = (target, folderId) => router.push(stageProjectsHref(target, { projectId: activeProject?.id, folderId }));

  // One submission: this module's project and one in each Linked Module ticked, or none at all.
  async function createProject(projectName, payload) {
    const response = await createVisualCurationProject({ projectName, ...payload });
    const rows = await loadProjects();
    setShowNewProject(false);
    showSuccess(createdProjectsText(response.data?.projects || []));
    const created = rows.find((row) => row.id === response.data?.workspaceId);
    if (created) selectProject(toWorkspaceProject(created));
  }
  // This module's project's name and client, and its Linked Modules - said once saved.
  async function saveEditedProject(payload) {
    const response = await editModuleProject(editingProject.moduleProjectId, payload);
    const rows = await loadProjects();
    setEditingProject(rows.find((row) => row.moduleProjectId === editingProject.moduleProjectId) || null);
    const changed = linkChangesText(response.data?.links);
    if (changed) showSuccess(changed);
  }

  function handleProjectAction(mode, project) {
    if (mode === "edit") {
      setEditingProject(project);
      setShowNewProject(false);
      selectProject(null);
      return;
    }
    if (mode === "delete") {
      // Still in other modules: only this module lets go. In this module alone: the project goes.
      const modules = manualProjectModules(project) || [];
      setRemoval({ mode: modules.length > 1 ? "module" : "project", project });
    }
  }
  async function confirmRemoval(options) {
    await deleteModuleProject(removal.project.moduleProjectId, options);
    if (activeProject?.id === removal.project.id) selectProject(null);
    if (editingProject?.id === removal.project.id) setEditingProject(null);
    await loadProjects();
  }
  async function removeFromModule() {
    setRemovalBusy(true);
    try {
      await confirmRemoval();
      setRemoval(null);
    } catch (error) {
      setRemoval(null);
      setNotice(error.message || `Unable to delete the ${label} project.`);
    } finally {
      setRemovalBusy(false);
    }
  }

  // Sorted by the four rungs every Visual Curation list shares; the dot says the module's own status.
  const statuses = useMemo(() => stageSidebarStatuses(stage, statusByProject), [stage, statusByProject]);
  const otherModules = removal ? (manualProjectModules(removal.project) || []).filter((module) => module !== stage).map((module) => PROJECT_MODULES[module].label) : [];

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <ImageSelectionNavigation title={spec.title} sections={stageSections(stage)} onSettingsSaved={() => setSettingsRevision((value) => value + 1)} />
      <FloatingNotice notice={floating} onClose={clearNotice} />
      <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto transition-[grid-template-columns] duration-300 ease-in-out md:overflow-visible ${sidebarCollapsed ? "md:grid-cols-[44px_minmax(0,1fr)]" : "md:grid-cols-[250px_minmax(0,1fr)]"}`}>
        <ProjectSidebar
          projects={projects}
          selectedProjectId={activeProject?.id ?? editingProject?.id}
          search={query}
          loading={isLoading}
          error={notice}
          onSearch={setQuery}
          onSelect={(project) => { selectProject(toWorkspaceProject(project)); setShowNewProject(false); setEditingProject(null); }}
          onNew={() => { setShowNewProject(true); setEditingProject(null); selectProject(null); }}
          onAction={handleProjectAction}
          canWrite={canManage}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          progressFilter={statusFilter}
          onProgressFilterChange={setStatusFilter}
          statuses={statuses}
        />
        <main className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-white">
          {editingProject ? (
            <div className="px-5 py-10 md:px-6">
              <CreateImageSelectionProject key={editingProject.moduleProjectId} module={stage} project={editingProject} onSave={saveEditedProject} onCancel={() => setEditingProject(null)} />
              <ProjectModuleLinks project={editingProject} />
            </div>
          ) : showNewProject ? (
            <div className="px-5 py-10 md:px-6">
              <CreateImageSelectionProject module={stage} onCreate={createProject} />
            </div>
          ) : activeProject ? (
            <ImageSelectionProjectWorkspace key={`${stage}-${activeProject.id}`} project={activeProject} stage={stage} folderTarget={folderTarget} refreshSignal={settingsRevision} onBack={() => selectProject(null)} onProjectUpdated={applyProjectUpdate} onOpenStage={openStage} />
          ) : (
            <div className="px-5 py-10 md:px-6">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{spec.title}</h1>
              <p className="mt-5 text-xs text-slate-700">{canManage ? `Create a New Project or choose a project from the sidebar to open its ${spec.title}.` : `Choose a project from the sidebar to open its ${spec.title}.`}</p>
            </div>
          )}
        </main>
      </div>
      {removal?.mode === "module" && (
        <ConfirmDialog
          title={`Delete the ${label} project "${removal.project.projectName}"?`}
          message={`${removal.project.projectCode ? `${removal.project.projectCode} is deleted. ` : ""}Its linked projects in ${otherModules.join(" and ")} stay, with every photo and result.`}
          confirmLabel={`Delete ${label} project`}
          loading={removalBusy}
          onCancel={() => setRemoval(null)}
          onConfirm={removeFromModule}
        />
      )}
      {removal?.mode === "project" && <ProjectActionDialog mode="delete" project={removal.project} onClose={() => setRemoval(null)} onConfirm={confirmRemoval} />}
    </section>
  );
}
