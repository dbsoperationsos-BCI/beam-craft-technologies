const repository = require("./repository");
const publication = require("../publication/service");
const { cleanupService } = require("../cleanup/service");
// The sidebar dot's rung is decided in one place — the dashboard classifier — so the dashboard's
// stage counts and the sidebar's dots can never read the same project two ways.
const { selectionProgressOf } = require("../dashboard/classify");
const { projectsWithAShootReached } = require("../shoot-visibility");
const { manualModules } = require("./modules");

const sortFields = { name: "projectName", dateLastOpened: "lastOpenedAt", dateAdded: "createdAt", dateModified: "updatedAt", dateCreated: "createdAt", size: "totalPhotoSize" };
// Every Project Management project that has been started gets its linked Image Selection project -
// In Progress, Completed, On Hold, Rejected and the older statuses alike - so a booking moved on
// before anybody opened Image Selection is not left without one. Only a booking not started yet is
// skipped. Being linked is not being listed: the sidebar still waits for a shoot's own date
// (`projectsWithAShootReached`), and nothing here reads Production or Pre Production.
const NOT_STARTED_SALES_STATUSES = ["Yet to Start"];
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function serialize(project) { return { ...project, totalPhotoSize: String(project.totalPhotoSize ?? 0) }; }
// This page shows one Image Selection project per Sales Manager project. Should the table ever
// hold a second live row for the same Sales project, listing both means two same-named sidebar
// rows: photos uploaded into one and the invite sent from the other. The row that came first is
// the one this page has always shown.
function withoutLaterSalesSiblings(rows) {
  const firstBySalesProject = new Map();
  for (const row of rows) {
    if (!row.salesProjectId) continue;
    const first = firstBySalesProject.get(row.salesProjectId);
    if (!first || new Date(row.createdAt) < new Date(first.createdAt)) firstBySalesProject.set(row.salesProjectId, row);
  }
  return rows.filter((row) => !row.salesProjectId || firstBySalesProject.get(row.salesProjectId) === row);
}

function orderBy(sort, order) { const field = sortFields[sort] || sortFields.dateAdded; return field === "projectName" ? [{ [field]: order }, { createdAt: order }] : [{ [field]: order }, { createdAt: order }, { projectName: "asc" }]; }
async function nextCopyName(projectName, repo) { const base = `${projectName} - Copy`; if (!(await repo.findProjectByName(base))) return base; let number = 2; while (await repo.findProjectByName(`${base} ${number}`)) number += 1; return `${base} ${number}`; }

function createImageSelectionProjectService(repo = repository, dependencies = {}) {
  const publisher = dependencies.publisher || publication;
  const cleanup = dependencies.cleanup || cleanupService;
  // Required lazily: the dashboard service reads this module's classifier, and a require at the
  // top would make the two load each other. Injectable so the list can be tested without it.
  const attentionFilter = () => dependencies.attention || require("../dashboard/service").createDashboardService();
  // Which modules a project is linked to, and whether one may be unlinked (modules.js). Injectable
  // so an edit can be tested without the database.
  const projectModules = () => dependencies.projectModules || require("./modules");
  /*
   * A linked project's name is its Sales project's WhatsApp group name, copied when the row was
   * made. A group renamed in Project Management afterwards left the copy behind, so the two screens
   * named one booking two ways. Each list load brings the copies back in step - by the Sales
   * project id, never by the old name - and touches nothing but the name: links, folders, photos and
   * picks are the same rows. A rename that would give two Projects-page rows one name is left as it
   * is and logged, for the reason the create below refuses one.
   */
  async function renameRenamedLinkedProjects() {
    for (const { id, name } of await repo.listRenamedLinkedProjects()) {
      try {
        const holder = await repo.findProjectByName(name);
        if (holder && holder.id !== id) { console.warn(`Image Selection sync kept project ${id}'s old name: "${name}" is already another project's.`); continue; }
        await repo.updateProject(id, { projectName: name });
      } catch (error) {
        console.warn(`Image Selection sync could not rename project ${id}:`, error?.message || error);
      }
    }
  }
  // Allocation is what puts a project here, not a picker: every started Sales Manager project
  // (`NOT_STARTED_SALES_STATUSES`) without an Image Selection project gets its linked project
  // created on the way into the list — the same fill-derived-state-on-read pattern ensureShortCode
  // uses for gallery codes. Web and the desktop app read the same list, so both see the project the
  // moment it is started. Linked by the Sales project id, and only once: a Sales project that already
  // has a Projects-page row is never offered again, whatever its status becomes. A soft-deleted or
  // archived linked project blocks re-creation — what an admin removed stays removed. The retired
  // picker's one-project-per-group-name rule survives here: names are trimmed, blanks skipped, and a
  // sales project whose group name an existing project (or an earlier row of this batch) already
  // carries is left out - and logged, so it is not missing silently - because two same-named sidebar
  // projects means photos uploaded into one and the invite sent from the other.
  async function syncAllocatedSalesProjects() {
    await renameRenamedLinkedProjects().catch((error) => console.warn("Image Selection rename sync skipped:", error?.message || error));
    const pending = await repo.listSalesProjectsAwaitingImageProject(NOT_STARTED_SALES_STATUSES);
    const claimedNames = new Set();
    for (const salesProject of pending) {
      const projectName = String(salesProject.whatsappGroupName || "").trim();
      const nameKey = projectName.toLowerCase();
      if (!projectName || claimedNames.has(nameKey)) continue;
      try {
        if (await repo.findProjectByName(projectName)) {
          claimedNames.add(nameKey);
          console.warn(`Image Selection sync did not create a project for sales project ${salesProject.id}: another project is already named "${projectName}".`);
          continue;
        }
        // The pending list was read a moment ago, and a booking deleted since then must not be
        // handed a new project by the very read that should have stopped showing it. The parent
        // is checked again with its row locked, in the same transaction as the create, so the
        // two outcomes are the only ones possible: the project is created and the delete
        // cascades over it, or the delete lands first and nothing is created at all.
        await repo.transaction(async (tx) => {
          if (!(await tx.findLiveSalesProjectForUpdate(salesProject.id))) return;
          await tx.createProject({ projectName, sourceType: "Sales", salesProjectId: salesProject.id, createdByUserId: null });
        });
        claimedNames.add(nameKey);
      } catch (error) {
        // Any one row failing (a race on the salesProjectId unique, a bad value) skips that row
        // only — the sync is a convenience and must never decide whether the list loads.
        if (error?.code !== "P2002") console.warn(`Image Selection sync could not create a project for sales project ${salesProject.id}:`, error?.message || error);
      }
    }
  }
  async function list(input) {
    // Never for the archived list — a project the sync creates cannot appear there — and never
    // at the cost of the read: a sync failure is logged and the list still answers.
    if (!input.archived) await syncAllocatedSalesProjects().catch((error) => console.warn("Image Selection sync skipped:", error?.message || error));
    // A linked project is listed from its first shoot's own day (studio time) - see `projectsWithAShootReached`.
    const rows = await projectsWithAShootReached(await repo.listProjects({ search: input.search, archived: input.archived, orderBy: orderBy(input.sort, input.order) }), repo.listShootDatesForSalesProjects);
    // The sidebar dot's answer, batched once for the whole list rather than per row.
    const { publishedProjectIds, configs, selectedConfigIds } = await repo.selectionProgressData(rows.map((row) => row.id));
    const published = new Set(publishedProjectIds);
    const selected = new Set(selectedConfigIds);
    const configsByProject = new Map();
    for (const config of configs) {
      if (!configsByProject.has(config.imageSelectionProjectId)) configsByProject.set(config.imageSelectionProjectId, []);
      configsByProject.get(config.imageSelectionProjectId).push(config);
    }
    const listed = withoutLaterSalesSiblings(rows).map((row) => ({ ...serialize(row), selectionProgress: selectionProgressOf(published.has(row.id), configsByProject.get(row.id) || [], selected) }));
    // A dashboard Needs Attention row opens this list narrowed to its projects. The rows are
    // classified by the dashboard's own rule, so the list shows exactly what the row counted.
    if (!input.attention) return listed;
    const wanted = await attentionFilter().attentionProjectIds(listed, input.attention);
    return listed.filter((row) => wanted.has(row.id));
  }
  async function create(input, userId) {
    // A manual project carries its own client, which the schema has already insisted on: without a
    // number there is nobody to send the gallery invite to, and this is the only screen that asks.
    // It also carries the workspace tabs it was created with — Photo Selection alone when the
    // form predates the choice — because it has no allocation to earn tabs from later.
    //
    // `modules` (the Create Project form's current module and its Linked Modules) creates the
    // project in exactly those modules; `workspaceTabs` is the older form's ticks, read as they
    // always were. Either way every one of AI Culling, AI Editing and Signature Album it is created
    // in gets its own project record (own ID, name and client copied), all in one transaction with
    // the photo workspace - which is Photo Selection's own project when Photo Selection is among
    // them - so a failure leaves nothing behind. Nothing is published, processed or sent.
    if (!input.salesProjectId) {
      const modules = input.modules ? new Set(input.modules) : null;
      const flags = modules
        ? { photoSelectionTab: modules.has("photos"), photoCullingTab: modules.has("culling"), signatureAlbumTab: modules.has("album"), aiEditingTab: modules.has("editing") }
        : {
          photoSelectionTab: input.workspaceTabs?.photoSelection ?? true,
          photoCullingTab: input.workspaceTabs?.photoCulling ?? false,
          signatureAlbumTab: input.workspaceTabs?.signatureAlbum ?? false,
          // Null when the form did not say (an older client): the tab is on, as the workspace reads it.
          aiEditingTab: input.workspaceTabs?.aiEditing ?? null,
        };
      const workspace = { projectName: input.projectName, sourceType: "Manual", clientName: input.clientName ?? null, clientMainNumber: input.clientMainNumber ?? null, ...flags, createdByUserId: userId };
      const recordModules = [...manualModules(flags)].filter((module) => module !== "photos");
      if (!recordModules.length) return serialize(await repo.createProject(workspace));
      return repo.transaction(async (tx) => {
        const created = await tx.createProject(workspace);
        const moduleProjects = [];
        for (const module of recordModules)
          moduleProjects.push(await tx.createModuleProject({ module, imageSelectionProjectId: created.id, projectName: created.projectName, clientName: created.clientName, clientMainNumber: created.clientMainNumber, createdByUserId: userId }));
        return { ...serialize(created), moduleProjects };
      });
    }
    // A linked project reads its client from the SalesProject, so storing a second copy here would
    // only create two answers to the same question — the same rule the settings save applies.
    if (input.clientName != null || input.clientMainNumber != null)
      throw httpError(409, "This project takes its client details from the linked Sales Manager project. Edit them there instead.");
    // Its tabs are just as much the allocation's: a hand-picked set here would be a second answer
    // to which deliverables the project carries.
    if (input.workspaceTabs != null)
      throw httpError(409, "A linked project's workspace tabs come from its Post Production Allocation and the Deliverables table.");
    return repo.transaction(async (tx) => {
      const salesProject = await tx.findSalesProject(input.salesProjectId);
      if (!salesProject) throw httpError(404, "The selected Sales Manager project no longer exists.");
      // A group name that already has a project here is refused: two same-named sidebar rows would
      // mean photos uploaded into one and the invite sent from the other.
      if (await tx.findProjectBySalesProjectId(salesProject.id))
        throw httpError(409, "This WhatsApp group name already has an Image Selection project.");
      return serialize(await tx.createProject({ projectName: salesProject.whatsappGroupName, sourceType: "Sales", salesProjectId: salesProject.id, createdByUserId: userId }));
    });
  }
  // A linked project's name IS the Sales Manager project's WhatsApp group name, so renaming it
  // here would give the same project two names. The sidebar hides Edit for linked projects; this
  // is the same rule enforced where it cannot be bypassed. Editing re-opens the manual creation
  // form, so alongside the name it may carry the client details, each applied only when sent. It
  // never changes which modules the project is in: those are chosen when it is created, and a
  // module lets go of it only through its own Delete - so `workspaceTabs`, which an older form
  // still sends, is not applied, and this edit touches Photo Selection's project alone, never the
  // AI Culling, AI Editing or Signature Album projects made with it.
  //
  // `links` is the form's Linked Modules: applied by `moduleLinks.apply`, in one transaction with the
  // name and client, so a refused unlink (a client still holding a link) saves nothing at all.
  async function edit(projectId, input, userId) {
    const project = await repo.findProject(projectId, { archived: false });
    if (!project) throw httpError(404, "Active Image Selection project not found.");
    if (project.salesProjectId) throw httpError(409, "This project is named by the linked Sales Manager project's WhatsApp group name. Change it there instead.");
    const data = { projectName: input.projectName };
    if (input.clientName !== undefined) data.clientName = input.clientName;
    if (input.clientMainNumber !== undefined) data.clientMainNumber = input.clientMainNumber;
    if (!input.links) return serialize(await repo.updateProject(projectId, data));
    const links = dependencies.moduleLinks || require("./moduleLinks");
    const changed = await links.apply(projectId, "photos", input.links, userId, {
      alsoWrite: (tx) => tx.imageSelectionProject.update({ where: { id: projectId }, data }),
      copyFrom: { projectName: data.projectName, clientName: data.clientName ?? project.clientName, clientMainNumber: data.clientMainNumber ?? project.clientMainNumber },
    });
    return { ...serialize(await repo.updateProject(projectId, {})), links: changed };
  }
  // Delete is only for a project the studio typed itself (manual or duplicated): a linked project
  // is the Sales Manager project's presence here and is archived, never deleted. Deleting purges
  // the project's data — photos, selections, folders, selection items and the published gallery,
  // rows and files alike — and leaves only the soft-deleted project row, so the gallery link
  // answers 404 and the storage the photos took is actually given back.
  async function remove(projectId, options = {}) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    if (project.salesProjectId) throw httpError(409, "This project comes from a Sales Manager WhatsApp group name and cannot be deleted. Archive it instead.");
    // Made with AI Culling, AI Editing or Signature Album projects too (records of their own on this
    // workspace): deleting Photo Selection's project must not delete theirs, or the photos they work
    // on. Photo Selection lets go of the workspace instead - refused while its gallery is published -
    // and everything is kept.
    // (`asLastModule`: the last module project on the workspace is the one being deleted, so the
    // workspace goes with it - moduleProjects.remove.)
    if (!options.asLastModule && (await repo.countModuleProjects?.(projectId)) > 0) {
      const blocker = await projectModules().unlinkBlocker(project, "photos", { allowLast: true });
      if (blocker) throw httpError(409, blocker);
      return serialize(await repo.updateProject(projectId, { photoSelectionTab: false }));
    }
    // Client-submitted selections are high-value business data. Their presence turns this into a
    // two-step delete: the first request answers 409 with the counts, and only a request that
    // explicitly acknowledges them may proceed. Checked here, at the moment of deletion — a
    // frontend warning alone would not stop a direct API call, and stale frontend data would not
    // survive this re-check.
    const impact = await repo.deletionImpact(projectId);
    if (impact.submittedSelectionCount > 0 && !options.acknowledgeSubmitted) {
      const submittedError = httpError(409, "This project contains photos the client has already selected and submitted. Confirm the high-impact warning to delete them anyway.");
      submittedError.details = { requiresAcknowledgement: true, scope: "project", projectName: project.projectName, ...impact };
      throw submittedError;
    }
    return purgeData(projectId);
  }
  /*
   * The delete itself, with nothing deciding whether it may happen.
   *
   * `remove` above is the interactive path and owns the two questions a person has to answer —
   * is this project one this page may delete at all, and has the client already submitted
   * selections. Once those are answered the work is the same everywhere, so it lives here and
   * has exactly one implementation: the deleted-booking cascade and the one-time cleanup of the
   * rows that cascade predates both call this rather than carrying a copy.
   *
   * Callable on a project that is already hidden. `purgeProjectData` keys on the id alone and
   * the cascade runs after its transaction has committed, so by then the row it is clearing out
   * already carries `deletedAt` — which is the order that keeps a bucket failure from ever
   * leaving a visible project standing with its photos gone.
   */
  async function purgeData(projectId) {
    // Read before the purge — afterwards there are no rows left to say which files were ours.
    const uploads = await repo.listUploadFilesForPurge(projectId);
    // Cloud first, strictly: a bucket failure aborts here with the rows — and their keys —
    // intact, so retrying the delete retries exactly the objects that remain. Purging the rows
    // first would destroy the only record of the keys and orphan the objects forever. Originals
    // under `originalPath` are never part of this sweep.
    await cleanup.purgeDerivatives(uploads);
    return serialize(await repo.purgeProjectData(projectId));
  }
  async function saveSettings(projectId, input) {
    const project = await repo.findProject(projectId, { archived: false });
    if (!project) throw httpError(404, "Active Image Selection project not found.");
    const data = { selectionValidityEnabled: input.selectionValidityEnabled, allowPhotoSelection: input.allowPhotoSelection };
    // Only touch the client details when the caller actually sent them: publish-share saves
    // pending settings without them, and Prisma reads undefined as "leave this column alone".
    // A linked project reads its client from the SalesProject, so storing a second copy here
    // would only create two answers to the same question.
    for (const field of ["clientName", "clientMainNumber"]) {
      if (input[field] === undefined) continue;
      if (project.salesProjectId) throw httpError(409, "This project takes its client details from the linked Sales Manager project. Edit them there instead.");
      data[field] = input[field];
    }
    // Same rule for the expiry date, which is absent whenever publish-share saves pending settings.
    if (input.selectionValidUntil !== undefined) data.selectionValidUntil = input.selectionValidUntil;
    const saved = serialize(await repo.updateProject(projectId, data));
    // A gallery already in the client's hands carries its own copy of the expiry, so the studio's
    // new date has to be pushed onto it — otherwise editing this field on a published project
    // would change what the panel shows and nothing about when the link actually stops working.
    if (input.selectionValidUntil !== undefined) await publisher.setExpiry(projectId, input.selectionValidUntil);
    return saved;
  }
  async function archive(projectId) { if (!(await repo.findProject(projectId, { archived: false }))) throw httpError(404, "Active Image Selection project not found."); return serialize(await repo.updateProject(projectId, { archivedAt: new Date() })); }
  async function restore(projectId) { if (!(await repo.findProject(projectId, { archived: true }))) throw httpError(404, "Archived Image Selection project not found."); return serialize(await repo.updateProject(projectId, { archivedAt: null })); }
  async function duplicate(projectId, userId) {
    return repo.transaction(async (tx) => {
      const source = await tx.findProject(projectId, { archived: false });
      if (!source) throw httpError(404, "Active Image Selection project not found.");
      // A duplicate is never linked, so it carries the source's own client details. They are
      // null on a linked source, which correctly leaves the copy asking for them.
      // The workspace-tab choice travels too: a copy of a linked source carries null tabs, which
      // the workspace reads as the manual default of Photo Selection alone.
      const duplicate = await tx.createProject({ projectName: await nextCopyName(source.projectName, tx), sourceType: "Duplicate", salesProjectId: null, clientName: source.clientName, clientMainNumber: source.clientMainNumber, photoSelectionTab: source.photoSelectionTab, photoCullingTab: source.photoCullingTab, signatureAlbumTab: source.signatureAlbumTab, aiEditingTab: source.aiEditingTab, status: "New", selectionValidUntil: source.selectionValidUntil, selectionValidityEnabled: source.selectionValidityEnabled, allowPhotoSelection: source.allowPhotoSelection, publicSlug: null, archivedAt: null, lastOpenedAt: null, totalPhotoSize: BigInt(0), publishVersion: 1, createdByUserId: userId });
      const folders = await tx.listFoldersForDuplicate(source.id); const folderIds = new Map(); const remaining = [...folders];
      while (remaining.length) {
        const ready = remaining.filter((folder) => !folder.parentId || folderIds.has(folder.parentId));
        if (!ready.length) throw httpError(409, "The project folder structure is invalid and cannot be copied.");
        for (const folder of ready) { const created = await tx.createFolder({ projectId: duplicate.id, parentId: folder.parentId ? folderIds.get(folder.parentId) : null, name: folder.name, sortOrder: folder.sortOrder, createdByUserId: userId }); folderIds.set(folder.id, created.id); remaining.splice(remaining.indexOf(folder), 1); }
      }
      const configs = await tx.listDeliverableConfigs(source.id);
      await tx.createDeliverableConfigs(configs.map((config) => ({ ...config, imageSelectionProjectId: duplicate.id })));
      return serialize(duplicate);
    });
  }
  return { list, create, edit, saveSettings, duplicate, archive, restore, remove, purgeData };
}

module.exports = { ...createImageSelectionProjectService(), createImageSelectionProjectService, sortFields, orderBy, nextCopyName, serialize };
