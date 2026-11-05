"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AlbumProofWorkspace from "@/components/image-selection/album-proofing/AlbumProofWorkspace";
import AlbumsPanel from "@/components/image-selection/album-proofing/AlbumsPanel";
import CreateAlbumProofingProject from "@/components/image-selection/album-proofing/CreateAlbumProofingProject";
import CreateImageSelectionProject from "@/components/image-selection/CreateImageSelectionProject";
import ImageSelectionNavigation from "@/components/image-selection/ImageSelectionNavigation";
import ProjectActionDialog from "@/components/image-selection/ProjectActionDialog";
import ProjectSidebar from "@/components/image-selection/ProjectSidebar";
import ProofingStatusChip from "@/components/image-selection/album-proofing/ProofingStatusChip";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import {
  archiveAlbumProofingProject,
  createAlbumProofingProject,
  deleteAlbumProofingProject,
  editAlbumProofingProject,
  listAlbumProofingProjects,
  restoreAlbumProofingProject,
} from "@/services/image-selection/album-proofs.service";

/**
 * Album Proofing keeps the Projects page's whole shape — the same sidebar, search and sort — but
 * has its own New Project form (a saved WhatsApp group name or a manual name, since the list sync
 * never creates proofing projects) and owns a separate list through its own API: a project
 * created here lives under Album Proofing's routes and permission, appears only in this sidebar,
 * and the Projects page's projects never appear here. Selecting a project opens its albums.
 */
// useSearchParams makes everything under it client-rendered, so the page keeps a Suspense
// boundary around itself as Next.js requires — the same shape the Projects page uses.
export default function AlbumProofingPage() {
  return <Suspense fallback={null}><AlbumProofing /></Suspense>;
}

function AlbumProofing() {
  // The route answers to IMAGE_SELECTION / Album Proofing (modulePermissions.js), so the sidebar's
  // write is that grant, as are the albums; Album Proofing QC is the QC lead's own write.
  const { canWrite } = useRouteAccess();
  const albumAccess = useModuleAccess("IMAGE_SELECTION", "Album Proofing");
  const qcAccess = useModuleAccess("IMAGE_SELECTION", "Album Proofing QC");
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by the floating upload dock when a reader clicks an upload started in this section. `at`
  // only makes each click a distinct URL so repeat clicks still jump back to the project.
  const requestedProjectId = searchParams.get("projectId");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("dateAdded");
  const [order, setOrder] = useState("desc");
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  // The manual project being edited in the main pane — the create form pre-filled with its data,
  // exactly the Projects page's edit flow. The sidebar only offers Edit on manual projects.
  const [editingProject, setEditingProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [actionDialog, setActionDialog] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openAlbumId, setOpenAlbumId] = useState(null);
  // What the QC review below is looking at, reported up by the panel that opens it and cleared the
  // moment that panel goes. Null everywhere else, which is what keeps the trail to QC review alone.
  const [reviewContext, setReviewContext] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listAlbumProofingProjects({ search, sort, order });
      setProjects(response.data || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load Album Proofing projects.");
    } finally {
      setIsLoading(false);
    }
  }, [order, search, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  // The linked-project picker must not offer a group name that already has a project.
  const usedSalesProjectIds = useMemo(
    () => projects.map((project) => project.salesProjectId).filter(Boolean),
    [projects],
  );

  // Opening a project from the upload dock: the query param wins over whatever was selected
  // here until the reader picks something else, which clears it again.
  const linkedProject = useMemo(
    () => (requestedProjectId ? projects.find((project) => String(project.id) === requestedProjectId) || null : null),
    [projects, requestedProjectId],
  );
  const activeProject = linkedProject || selectedProject;

  function selectProject(project) {
    setSelectedProject(project);
    if (requestedProjectId) router.replace("/image-selection/album-proofing", { scroll: false });
    setOpenAlbumId(null);
    setShowNewProject(false);
    setEditingProject(null);
  }

  // A manually named project carries the client it was created with; a project created from a
  // saved group name sends neither field — the same contract the Projects page uses.
  async function createProject(projectName, { salesProjectId = null, ...client } = {}) {
    const response = await createAlbumProofingProject({ projectName, salesProjectId, ...client });
    await loadProjects();
    selectProject(response.data);
  }

  // Save from the edit form: thrown errors surface inside the form, which is why this does not catch.
  async function saveEditedProject(payload) {
    const response = await editAlbumProofingProject(editingProject.id, payload);
    await loadProjects();
    selectProject(response.data);
  }

  // The dialog confirms archive, restore and delete; each goes to its own endpoint. A project
  // still holding albums is refused by the server, and the dialog shows that refusal.
  async function confirmAction() {
    const { mode, project } = actionDialog;
    if (mode === "archive") await archiveAlbumProofingProject(project.id);
    else if (mode === "restore") await restoreAlbumProofingProject(project.id);
    else await deleteAlbumProofingProject(project.id);
    await loadProjects();
    selectProject(null);
  }

  function handleProjectAction(mode, project) {
    if (mode === "edit") {
      setEditingProject(project);
      setShowNewProject(false);
      setSelectedProject(null);
      return;
    }
    setActionDialog({ mode, project });
  }

  return (
    // Fills the flex column AppShell provides, exactly like the Projects page beside it.
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <ImageSelectionNavigation title="Album Proofing" sections={[]} />

      {/* On a phone the two rows stack and this grid scrolls; from md up the sidebar and the
          proofing pane scroll on their own, so the shell never scrolls as a page. */}
      <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto transition-[grid-template-columns] duration-300 ease-in-out md:overflow-visible ${sidebarCollapsed ? "md:grid-cols-[44px_minmax(0,1fr)]" : "md:grid-cols-[250px_minmax(0,1fr)]"}`}>
        <ProjectSidebar
          projects={projects}
          // Editing clears the selection so the main pane can hold the form, but the row of the
          // project being edited stays highlighted — the form never says which project it is for.
          selectedProjectId={activeProject?.id ?? editingProject?.id}
          search={query}
          sort={sort}
          order={order}
          loading={isLoading}
          error={notice}
          onSearch={setQuery}
          onSort={setSort}
          onOrder={setOrder}
          onSelect={selectProject}
          onNew={() => { setShowNewProject(true); setSelectedProject(null); setEditingProject(null); }}
          onAction={handleProjectAction}
          canWrite={canWrite}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        />

        <main className="flex min-h-0 min-w-0 flex-col bg-white">
          {editingProject ? (
            <div className="px-5 py-10 md:px-6">
              {/* Keyed by project so switching between edits resets every pre-filled field. */}
              <CreateImageSelectionProject key={editingProject.id} project={editingProject} onSave={saveEditedProject} onCancel={() => setEditingProject(null)} />
            </div>
          ) : showNewProject ? (
            <div className="px-5 py-10 md:px-6">
              {/* Album Proofing's own New Project view: a saved WhatsApp group name or a manual
                  name. The Projects page keeps its manual-only form untouched. */}
              <CreateAlbumProofingProject onCreate={createProject} usedSalesProjectIds={usedSalesProjectIds} />
            </div>
          ) : activeProject ? (
            <>
              {/* The project workspace's own header: the full project name with its Created date,
                  so opening a project here reads exactly like opening one on the Projects page.
                  A QC review adds the version it is reviewing beside the name and nothing else. */}
              <header className="flex min-h-11 shrink-0 items-center border-b border-slate-200 px-3 py-1">
                <div className="min-w-0">
                  {/* The project, and — only while a QC review is open — what that review is of:
                      `Manual Album Proof Test / V1 · Round 1  [QC Review]`. The trail is `shrink-0`
                      and the name truncates, so at a phone's width the name gives up characters
                      and the version and its status stay legible rather than the other way about. */}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h1 className="truncate text-base font-normal text-slate-800">{activeProject.projectName}</h1>
                    {reviewContext && <>
                      <span aria-hidden="true" className="shrink-0 text-slate-300">/</span>
                      <span className="shrink-0 text-base font-normal text-slate-500">{reviewContext.versionLabel}</span>
                      <ProofingStatusChip status={reviewContext.status} />
                    </>}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Created: {activeProject.createdAt ? new Date(activeProject.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  </p>
                </div>
              </header>
              {/* The project's albums — Main Album, Parents Album, ... — or, once one is opened,
                  its full proofing workspace. Album actions answer to the Album Proofing grant,
                  not to Project Management. */}
              {openAlbumId
                ? <AlbumProofWorkspace key={openAlbumId} albumId={openAlbumId} canWrite={albumAccess.canWrite} qcCanWrite={qcAccess.canWrite} onReviewContext={setReviewContext} onBack={() => setOpenAlbumId(null)} />
                : <AlbumsPanel key={activeProject.id} project={activeProject} canWrite={albumAccess.canWrite} onOpen={(album) => setOpenAlbumId(album.id)} />}
            </>
          ) : (
            <div className="px-5 py-10 md:px-6">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Album Proofing</h1>
              <p className="mt-5 text-xs text-slate-700">
                {canWrite
                  ? <>Create a <button type="button" onClick={() => setShowNewProject(true)} className="font-medium text-blue-600 hover:underline">New Project</button> or choose an existing project to review its album proofs.</>
                  : "Choose a project from the sidebar to review its album proofs."}
              </p>
            </div>
          )}
        </main>
      </div>

      {actionDialog && <ProjectActionDialog {...actionDialog} onClose={() => setActionDialog(null)} onConfirm={confirmAction} />}
    </section>
  );
}
