"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import CreateImageSelectionProject from "@/components/image-selection/CreateImageSelectionProject";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import ImageSelectionProjectWorkspace from "@/components/image-selection/ImageSelectionProjectWorkspace";
import ProjectActionDialog from "@/components/image-selection/ProjectActionDialog";
import ProjectSidebar from "@/components/image-selection/ProjectSidebar";
import WhatsAppLinkAllDialog from "@/components/image-selection/WhatsAppLinkAllDialog";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import {
  archiveImageSelectionProject,
  createImageSelectionProject,
  deleteImageSelectionProject,
  editImageSelectionProject,
  listImageSelectionProjects,
  restoreImageSelectionProject,
} from "@/services/image-selection/image-selection.service";
import { toWorkspaceProject } from "@/lib/imageSelectionProjectSidebar.mjs";
import { projectListFiltersFromParams } from "@/lib/imageSelectionDashboard.mjs";

// useSearchParams makes everything under it client-rendered, so the page keeps a
// Suspense boundary around the workspace as Next.js requires.
export default function ImageSelectionProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ImageSelectionProjects />
    </Suspense>
  );
}

function ImageSelectionProjects() {
  // IMAGE_SELECTION / Project Management. Browsing projects and opening a workspace read them;
  // creating, editing, archiving and deleting do not.
  const { canWrite } = useRouteAccess();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by the floating upload dock when the user clicks a running upload. `at` only
  // makes each click a distinct URL so repeat clicks still jump back to the folder.
  const requestedProjectId = searchParams.get("projectId");
  const requestedFolderId = searchParams.get("folderId");
  const requestedLinkId = searchParams.get("at");
  // Set by the dashboard: a card opens this list with the sidebar's progress filter or its
  // Archived view, a Needs Attention row narrows it to the projects on that row, and New Project
  // opens the create form. Read as one key so a fresh link applies again even while the page is
  // already open, and never re-applied while the reader is changing the filters themselves.
  const urlFilters = projectListFiltersFromParams((name) => searchParams.get(name));
  const filterKey = `${urlFilters.progress}|${urlFilters.archived}|${urlFilters.attention || ""}|${urlFilters.create}`;
  const [appliedFilterKey, setAppliedFilterKey] = useState(filterKey);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(urlFilters.archived);
  const [progressFilter, setProgressFilter] = useState(urlFilters.progress);
  const [attention, setAttention] = useState(urlFilters.attention);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(urlFilters.create);
  // ⋮ → Match WhatsApp Groups: every unlinked project linked to the group carrying its name.
  const [matchGroups, setMatchGroups] = useState(false);
  // The manual project being edited in the main pane — the create form pre-filled with its data,
  // with Save and Cancel in place of Create Project. The sidebar only offers Edit on manual
  // projects, so the form's manual branch is always the right one.
  const [editingProject, setEditingProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [actionDialog, setActionDialog] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openedLinkId, setOpenedLinkId] = useState(requestedLinkId);
  // Bumped when the studio-wide settings are saved, so the open workspace reloads the lists those
  // settings feed instead of waiting for the next thing to refresh them.
  const [settingsRevision, setSettingsRevision] = useState(0);

  // A dock click has to survive whatever the page was showing: a search, the archived
  // list or the create form would all hide the project it is trying to open.
  if (requestedLinkId && requestedLinkId !== openedLinkId) {
    setOpenedLinkId(requestedLinkId);
    setQuery("");
    setArchived(false);
    setShowNewProject(false);
  }
  if (filterKey !== appliedFilterKey) {
    setAppliedFilterKey(filterKey);
    setArchived(urlFilters.archived);
    setProgressFilter(urlFilters.progress);
    setAttention(urlFilters.attention);
    if (urlFilters.create) setShowNewProject(true);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      // No sort control any more — the list keeps its newest-first default.
      const response = await listImageSelectionProjects({ search, sort: "dateAdded", order: "desc", archived, attention });
      setProjects(response.data || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load Image Selection projects.");
    } finally {
      setIsLoading(false);
    }
  }, [archived, attention, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  // Opening a project from the upload dock: the query params win over whatever was
  // selected here until the user picks something else, which clears them again.
  const linkedProject = useMemo(() => {
    if (!requestedProjectId) return null;
    const match = projects.find((project) => String(project.id) === requestedProjectId);
    return match ? toWorkspaceProject(match) : null;
  }, [projects, requestedProjectId]);
  // A new object per deep link so the workspace re-opens the folder even if the user has
  // browsed elsewhere inside the same project since the last click.
  const folderTarget = useMemo(
    () => (linkedProject && requestedFolderId ? { id: requestedFolderId, at: requestedLinkId } : null),
    [linkedProject, requestedFolderId, requestedLinkId],
  );
  const activeProject = linkedProject || selectedProject;
  function selectProject(project) {
    setSelectedProject(project);
    if (requestedProjectId) router.replace("/image-selection/projects", { scroll: false });
  }

  // The selected project and the sidebar row are both snapshots taken when the project was
  // opened. Saving its settings returns the updated row, so both are replaced here — otherwise
  // the workspace keeps rendering from the copy that predates the save and the client details
  // read back as empty.
  function applyProjectUpdate(updated) {
    if (!updated) return;
    setProjects((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    setSelectedProject((current) => (current?.id === updated.id ? toWorkspaceProject(updated) : current));
  }

  // Only manual projects are created here — a production project joins the sidebar by itself
  // once it is In Progress, so no saved-group-name branch and no salesProjectId are sent.
  async function createProject(projectName, client = {}) {
    const response = await createImageSelectionProject({ projectName, ...client });
    await loadProjects();
    selectProject(toWorkspaceProject(response.data));
    setShowNewProject(false);
  }

  // `options` carries { acknowledgeSubmitted: true } when the dialog escalated to the
  // high-impact warning and the admin typed the confirmation; the backend re-checks either way.
  async function confirmAction(options) {
    const { mode, project } = actionDialog;
    if (mode === "archive") await archiveImageSelectionProject(project.id);
    if (mode === "delete") await deleteImageSelectionProject(project.id, options);
    await loadProjects();
    selectProject(null);
  }

  // Save from the edit form: the same fields the manual creation asks for, written onto the
  // existing project. Thrown errors surface inside the form, which is why this does not catch.
  async function saveEditedProject(payload) {
    const response = await editImageSelectionProject(editingProject.id, payload);
    await loadProjects();
    setEditingProject(null);
    selectProject(toWorkspaceProject(response.data));
  }

  async function handleProjectAction(mode, project) {
    if (mode === "restore") {
      try {
        await restoreImageSelectionProject(project.id);
        selectProject(null);
        await loadProjects();
      } catch (error) {
        setNotice(error.message || "Unable to restore the project.");
      }
      return;
    }
    // Edit opens the manual creation form pre-filled in the main pane rather than a dialog.
    if (mode === "edit") {
      setEditingProject(project);
      setShowNewProject(false);
      selectProject(null);
      return;
    }
    setActionDialog({ mode, project });
  }

  function toggleArchived() {
    setArchived((current) => !current);
    selectProject(null);
    setShowNewProject(false);
    setEditingProject(null);
  }

  return (
    // AppShell gives its children no padding, so this fills the pane as-is. It used to pull
    // itself out with negative margins to cancel padding the shell no longer has, which pushed
    // both edges past the pane and let `overflow-x-hidden` clip them.
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      {/* ⋮ → Project Settings edits the studio-wide record, and the default selection limit it
          holds is what an unallocated deliverable falls back to — so the workspace is refreshed
          after a save rather than left showing limits derived from the previous default. */}
      <ImageSelectionNavigation
        onSettingsSaved={() => setSettingsRevision((value) => value + 1)}
        options={canWrite ? [{ label: "Match WhatsApp Groups", onSelect: () => setMatchGroups(true) }] : []}
      />
      {matchGroups && <WhatsAppLinkAllDialog onClose={() => setMatchGroups(false)} onLinked={loadProjects} />}

      {/* Fills what is left of the shell's flex column. On a phone the two rows stack and this
          grid is what scrolls; from md up it holds its height and the workspace panes inside
          do their own scrolling, so the shell never scrolls as a page. */}
      <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto transition-[grid-template-columns] duration-300 ease-in-out md:overflow-visible ${sidebarCollapsed ? "md:grid-cols-[44px_minmax(0,1fr)]" : "md:grid-cols-[250px_minmax(0,1fr)]"}`}>
        <ProjectSidebar
          projects={projects}
          // Editing clears the selection so the main pane can hold the form, but the row of the
          // project being edited stays highlighted — the form never says which project it is for.
          selectedProjectId={activeProject?.id ?? editingProject?.id}
          search={query}
          archived={archived}
          loading={isLoading}
          error={notice}
          onSearch={setQuery}
          onSelect={(project) => { selectProject(toWorkspaceProject(project)); setShowNewProject(false); setEditingProject(null); }}
          onNew={() => { setShowNewProject(true); selectProject(null); setEditingProject(null); }}
          onAction={handleProjectAction}
          onToggleArchived={toggleArchived}
          canWrite={canWrite}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          progressFilter={progressFilter}
          onProgressFilterChange={setProgressFilter}
          attentionFilter={attention}
          // Clearing the row's filter also takes it out of the URL, keeping whatever else the
          // link carried, so a reload does not quietly put the narrowing back.
          onClearAttention={() => {
            setAttention(null);
            setAppliedFilterKey(`${urlFilters.progress}|${urlFilters.archived}||${urlFilters.create}`);
            const params = new URLSearchParams(searchParams.toString());
            params.delete("attention");
            const next = params.toString();
            router.replace(next ? `/image-selection/projects?${next}` : "/image-selection/projects", { scroll: false });
          }}
        />

        {/* No min-height floor: a floor is what reintroduces a page scrollbar, and the grid
            row already gives this column the full remaining height to fill. */}
        <main className="flex min-h-0 min-w-0 flex-col bg-white">
          {editingProject && !archived ? (
            <div className="px-5 py-10 md:px-6">
              {/* Keyed by project so switching between edits resets every pre-filled field. */}
              <CreateImageSelectionProject key={editingProject.id} project={editingProject} onSave={saveEditedProject} onCancel={() => setEditingProject(null)} />
            </div>
          ) : showNewProject && !archived ? (
            <div className="px-5 py-10 md:px-6">
              <CreateImageSelectionProject onCreate={createProject} />
            </div>
          ) : activeProject && !archived ? (
            <ImageSelectionProjectWorkspace project={activeProject} folderTarget={folderTarget} refreshSignal={settingsRevision} onBack={() => selectProject(null)} onProjectUpdated={applyProjectUpdate} />
          ) : (
            <div className="px-5 py-10 md:px-6">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                {archived ? "Archived Projects" : "Good Morning!"} {!archived && <span className="font-normal text-slate-700">Admin</span>}
              </h1>
              <p className="mt-5 text-xs text-slate-700">
                {archived ? "Restore a project from the sidebar to make it active again." : canWrite ? <>Create a <button type="button" onClick={() => setShowNewProject(true)} className="font-medium text-blue-600 hover:underline">New Project</button> or choose an existing project.</> : "Choose a project from the sidebar."}
              </p>
            </div>
          )}
        </main>
      </div>

      {actionDialog && <ProjectActionDialog {...actionDialog} onClose={() => setActionDialog(null)} onConfirm={confirmAction} />}
    </section>
  );
}
