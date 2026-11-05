const repository = require("./repository");
const classify = require("./classify");
const { createSettingsService } = require("../settings/service");
const { derivedLimitOf } = require("../deliverables/service");
const { expiryOf } = require("../publication/service");
const { clientNameOf } = require("../../../services/projectClientNames");
const { closeAbandonedBatches } = require("../uploads/batchRepository");
const { projectsWithAShootReached } = require("../shoot-visibility");

/**
 * The Image Selection dashboard, answered in one request.
 *
 * Every figure is produced the way the screen it summarises produces it: the stage a project is
 * counted under is the rung the Projects sidebar dot already shows (`classify.selectionProgressOf`),
 * the selected count and limit are the gallery's own per-item numbers, and the client name is the
 * one Client Storage and Accounts show. Counting a second way is how a dashboard ends up
 * disagreeing with the page beside it.
 *
 * Every count is a *position* — every Image Selection project as it stands now, Album Proofing's
 * rows never among them — and the range picker above the cards scopes the *period* figures on them:
 * projects created, photos added, photos picked and items submitted inside it. A dashboard that
 * hid this month's live selections because the project was set up in August answered a question
 *
 * Reads are batched for the whole set — a handful of grouped queries however many projects the
 * range holds — and no photo row is ever loaded; a project of fifty thousand photos costs the same
 * as one of fifty.
 */

// The range vocabulary is shared with every module dashboard (`src/services/dashboardRange.js`);
// it is re-exported below so this module's callers and tests keep one import.
const { RANGE_KEYS, RANGE_LABELS, DEFAULT_RANGE, rangeBounds } = require("../../../services/dashboardRange");
const PROGRESS_LIMIT = 5;

/**
 * How many photos the client may pick for one live selection item, by the deliverable service's
 * own rule: an allocation-derived item reads its deliverable's limit (then No of Photos, then
 * quantity, then the studio default); a typed item keeps the number it was given.
 */
function limitOf(config, defaultSelectionLimit) {
  if (config.projectShootDeliverableId || config.projectPostProductionAllocationId) {
    const deliverable = config.shootDeliverable || {};
    return derivedLimitOf({ allocatedSelectionLimit: deliverable.selectionLimit ?? null, numberOfPhotos: deliverable.numberOfPhotos ?? null, quantity: deliverable.quantity ?? null }, defaultSelectionLimit);
  }
  return config.selectionLimitOverride ?? defaultSelectionLimit;
}

const time = (value) => (value ? new Date(value).getTime() : 0);
const byLastActivity = (first, second) => time(second.lastActivityAt) - time(first.lastActivityAt);

/**
 * The shoot a selection item belongs to, by id where it has one and by name always: a Project
 * Management shoot's id, or the root folder a manual item is filed under (its live name).
 */
function shootOf(config) {
  const source = config.shootDeliverable || config.postProductionAllocation;
  if (source?.shootId) return { shootId: source.shootId, name: source.shoot?.shoot || null };
  if (config.manualShootFolder) return { shootId: null, folderId: config.manualShootFolder.id, name: config.manualShootFolder.name };
  return config.manualShootName ? { shootId: null, name: config.manualShootName } : null;
}

function createDashboardService(repo = repository, dependencies = {}) {
  const settings = dependencies.settings || createSettingsService();
  const now = dependencies.now || (() => new Date());
  // Injectable so the card can be tested without a database, like every other read here.
  const closeBatches = dependencies.closeAbandonedBatches || closeAbandonedBatches;

  /**
   * One classifier input per project, from five batched reads.
   *
   * With `asOf`, the same projects as they stood at that instant: every stamp at or after it —
   * a publish, a pick, a submission, an archive, a download — is set aside as not yet having
   * happened, and the counts are bounded the same way. That is what lets each card say which way
   * it has moved since the start of the range, from the rows already in hand. It is a
   * reconstruction from the dates the rows carry, so a thing later undone (a photo unpicked, a
   * project restored from the archive) reads as never having happened; the number is honest to
   * what the records still hold.
   */
  async function snapshotsFor(projects, asOf = null) {
    const [data, { defaultSelectionLimit }] = await Promise.all([repo.snapshotData(projects.map((project) => project.id), asOf ? { asOf } : {}), settings.read()]);
    // A stamp only counts if it had happened by `asOf`; with no instant, everything is as it is now.
    const before = (value) => (!asOf ? value ?? null : value && new Date(value) < asOf ? value : null);
    const publicationByProject = new Map(data.publications.map((publication) => [publication.projectId, publication]));
    const countByConfig = new Map(data.selectionCounts.map((row) => [row.imageSelectionDeliverableConfigId, row.count]));
    const photosByProject = new Map(data.photoCounts.map((row) => [row.projectId, row.count]));
    const legacyByProject = new Map(data.legacySelected.map((row) => [row.projectId, row.count]));
    const configsByProject = new Map();
    for (const config of data.configs) {
      // A selection item that did not exist yet was not a selection item then.
      if (asOf && config.createdAt && new Date(config.createdAt) >= asOf) continue;
      if (!configsByProject.has(config.imageSelectionProjectId)) configsByProject.set(config.imageSelectionProjectId, []);
      configsByProject.get(config.imageSelectionProjectId).push({ id: config.id, name: config.name || config.shootDeliverable?.deliverableName || config.postProductionAllocation?.serviceName || "Selection item", selectionSubmittedAt: before(config.selectionSubmittedAt), selectedDownloadedAt: before(config.selectedDownloadedAt), selectionLimit: limitOf(config, defaultSelectionLimit), selectedCount: countByConfig.get(config.id) || 0, shoot: shootOf(config) });
    }
    return new Map(projects.map((project) => {
      const stored = publicationByProject.get(project.id) || null;
      // A gallery published at or after the instant was not published then. One published before
      // it was PUBLISHED then unless it had already been revoked by then.
      const publication = stored && (!asOf || (stored.publishedAt && new Date(stored.publishedAt) < asOf))
        ? { ...stored, status: asOf ? (before(stored.revokedAt) ? "REVOKED" : "PUBLISHED") : stored.status, selectionSubmittedAt: before(stored.selectionSubmittedAt), galleryFirstOpenedAt: before(stored.galleryFirstOpenedAt), galleryLastOpenedAt: before(stored.galleryLastOpenedAt), lastClientActivityAt: before(stored.lastClientActivityAt) }
        : null;
      const configs = configsByProject.get(project.id) || [];
      const selectedConfigIds = new Set(configs.filter((config) => config.selectedCount > 0).map((config) => config.id));
      return [project.id, {
        archivedAt: before(project.archivedAt),
        selectionProgress: classify.selectionProgressOf(publication?.status === "PUBLISHED", configs, selectedConfigIds),
        publication: publication ? { ...publication, expiresAt: expiryOf(publication) } : null,
        configs,
        legacySelectedCount: legacyByProject.get(project.id) || 0,
        photoCount: photosByProject.get(project.id) || 0,
        selectedDownloadedAt: before(project.selectedDownloadedAt),
      }];
    }));
  }

  /** The nine cards, the stage counts and the attention counts, from one set of rows. */
  function summarize(rows) {
    const stageCounts = Object.fromEntries(classify.DASHBOARD_STAGES.map((stage) => [stage.key, 0]));
    const attention = Object.fromEntries(classify.ATTENTION_KINDS.map((kind) => [kind, 0]));
    let totalPhotos = 0;
    for (const row of rows) {
      stageCounts[row.stage] += 1;
      totalPhotos += row.photoCount;
      for (const kind of classify.ATTENTION_KINDS) if (row.attention[kind]) attention[kind] += 1;
    }
    /*
     * The ten cards. Five are the ladder as the studio reads it - nothing uploaded, uploaded
     * but not sent, sent but untouched, being picked, submitted - and together with the archived
     * projects they add up to the total. The other four overlap the ladder: a submitted project
     * is either not yet downloaded or downloaded, and a running one may also have a link about to
     * expire or one that already has. Every other view the classifier knows - never opened, quiet,
     * overdue - is still a filter the Projects list takes, just not a card.
     */
    const summary = {
      totalProjects: rows.length,
      yetToUpload: attention.yetToUpload,
      notPublished: attention.notPublished,
      clientNotStarted: stageCounts.linkSent,
      clientInProgress: stageCounts.selecting,
      // Any item submitted - not every item: Retouches sent while Frames is still being picked counts.
      clientSubmitted: attention.clientSubmitted,
      notYetDownloaded: attention.readyToDownload,
      linkExpiringSoon: attention.expiringSoon,
      linkExpired: attention.expired,
      downloaded: attention.downloaded,
      totalPhotos,
    };
    return { stageCounts, attention, totalPhotos, summary };
  }

  /** One project as every list on the dashboard shows it. */
  function projectRow(project, snapshot, names, at) {
    const publication = snapshot.publication;
    const latestSubmission = classify.latestOf(...snapshot.configs.map((config) => config.selectionSubmittedAt));
    return {
      id: project.id, projectCode: project.projectCode, projectName: project.projectName, sourceType: project.sourceType, salesProjectId: project.salesProjectId,
      clientName: project.clientName || clientNameOf(project.salesProject, names),
      archivedAt: snapshot.archivedAt, createdAt: project.createdAt,
      photoCount: snapshot.photoCount,
      ...classify.selectionTotals(snapshot),
      selectionProgress: snapshot.selectionProgress,
      stage: classify.stageOf(snapshot),
      publicationStatus: publication?.status || "UNPUBLISHED",
      expiresAt: publication?.expiresAt || null,
      lastClientActivityAt: publication?.lastClientActivityAt || null,
      galleryLastOpenedAt: publication?.galleryLastOpenedAt || null,
      selectedDownloadedAt: snapshot.selectedDownloadedAt || null,
      lastActivityAt: classify.latestOf(project.updatedAt, publication?.publishedAt, publication?.lastClientActivityAt, publication?.galleryLastOpenedAt, publication?.selectionSubmittedAt, latestSubmission),
      attention: classify.attentionFlagsOf(snapshot, at),
      // The items the client has submitted, each with whether its picks have been copied out - what
      // Client Submitted and Yet to Download count by, shown on the row.
      submittedItems: classify.submittedItemsOf(snapshot),
      // Internal: the items behind Yet to Download, resolved to a folder once per build and dropped.
      downloadConfigs: classify.readyToDownloadConfigs(snapshot),
    };
  }

  // `asOf` reads the rows as they stood at that instant; `names` lets a second read reuse the
  // client names the first one already resolved.
  async function rowsFor(projects, at, { asOf = null, names = null } = {}) {
    const [snapshots, resolvedNames] = await Promise.all([snapshotsFor(projects, asOf), names || repo.clientNames(projects.map((project) => project.salesProject).filter(Boolean))]);
    return projects.map((project) => projectRow(project, snapshots.get(project.id), resolvedNames, at));
  }

  // Storage is infrastructure: a failure there is an empty card, never a failed page. The range
  // reaches it too, so the card can say what this month put into the store as well as what the
  // store holds.
  async function readStorage(range) {
    try {
      /*
       * The batches nothing is coming back for are closed on the way in, before they are counted.
       *
       * A batch is created with the total the browser says it is about to send and only finishes
       * when the counters reach it, so a closed tab or a dropped connection leaves one calling
       * itself active for ever - and this card, which was reporting active upload batches beside
       * no photograph being processed, is where the studio saw it. Swept here rather than on a
       * timer, the way a dead freeze's DRAFT is: it costs one indexed UPDATE on the page that
       * would otherwise show the wrong number.
       *
       * Never allowed to fail the card. A sweep that cannot run leaves the count as it was, which
       * is the number this page has always shown.
       */
      await closeBatches().catch((error) => console.warn("Image Selection could not close abandoned upload batches:", error?.message || error));
      const stats = await repo.storageStats({ from: range.from, to: range.to });
      let queue;
      try { queue = await repo.queueCounts(); } catch { queue = { available: false }; }
      return { ...stats, queue };
    } catch (error) {
      console.warn("Image Selection dashboard could not read storage statistics:", error?.message || error);
      return null;
    }
  }

  /*
   * Each Yet to Download row carries the shoot folder to open it on - `readyToDownloadFolderId`,
   * null on every other row and where no folder stands for the shoot. One read of root folders for
   * the rows that need it; the dashboard's other rows ask for nothing.
   */
  async function withDownloadFolders(rows) {
    const ready = rows.filter((row) => row.attention.readyToDownload && row.downloadConfigs.length);
    const folders = await repo.rootFolders(ready.map((row) => row.id));
    const byProject = new Map();
    for (const folder of folders) {
      if (!byProject.has(folder.projectId)) byProject.set(folder.projectId, []);
      byProject.get(folder.projectId).push(folder);
    }
    return rows.map(({ downloadConfigs, ...row }) => ({
      ...row,
      readyToDownloadFolderId: row.attention.readyToDownload ? classify.downloadFolderOf(downloadConfigs, byProject.get(row.id)) : null,
    }));
  }

  /*
   * Every row says whether its project is enabled (`expandEnabled`: no `disabledAt`). With `expand`,
   * the cards and period figures count only the enabled projects, by exactly the rules of the full
   * dashboard, while the table still lists every project - a disabled one marked so - so it can be
   * enabled again from there. Storage belongs to the whole store rather than to a set of projects,
   * so it is not read there.
   */
  async function build(input = {}) {
    const at = now();
    const range = rangeBounds(input.range, at);
    const expand = input.expand === true;
    const [allProjects, allProjectsCount] = await Promise.all([repo.listProjects(), repo.countAllProjects()]);
    const off = new Set(allProjects.filter((project) => project.disabledAt).map((project) => project.id));
    const disabledAtOf = new Map(allProjects.filter((project) => project.disabledAt).map((project) => [project.id, project.disabledAt]));
    const counts = (id) => !expand || !off.has(id);
    const period = await repo.periodCounts(range, { excludeIds: expand ? [...off] : [] });
    // Only what the Projects sidebar lists: a linked project none of whose shoots has passed yet
    // is held back there, so it is no card, stage or row here either.
    const projects = await projectsWithAShootReached(allProjects, repo.listShootDatesForSalesProjects, at);
    const counted = projects.filter((project) => counts(project.id));
    const totalProjectsAllTime = allProjectsCount - (allProjects.length - projects.length);
    const names = await repo.clientNames(projects.map((project) => project.salesProject).filter(Boolean));
    const [allRows, storage] = await Promise.all([rowsFor(projects, at, { names }), expand ? null : readStorage(range)]);
    const rows = await withDownloadFolders(allRows);
    const countedRows = rows.filter((row) => counts(row.id));
    const { summary } = summarize(countedRows);

    /*
     * Where the same nine numbers stood at the start of the range — the end of last week, last
     * month, or the same day three or six months ago — so every card can say which way it has
     * moved. Read the same way as now, from the same rows, with every stamp later than that
     * instant set aside. Lifetime has no start, so it has no comparison, and the cards say so.
     */
    const previous = range.key === "lifetime"
      ? null
      : summarize(await rowsFor(counted.filter((project) => new Date(project.createdAt) < range.from), range.from, { asOf: range.from, names })).summary;
    const trend = previous && Object.fromEntries(Object.keys(summary).map((key) => [key, { before: previous[key], delta: summary[key] - previous[key] }]));
    const active = countedRows.filter((row) => !row.archivedAt);
    const strip = ({ attention: _attention, ...row }) => row;

    return {
      range: { key: range.key, label: range.label, from: range.from, to: range.to },
      // What the range added, beside the position the cards show. The key travels so the page can
      // word the line under each card — "this month", "in total" — rather than print the label raw.
      period: { key: range.key, label: range.label, ...period },
      totalProjectsAllTime,
      summary,
      // Each card's number at the start of the range, and how far it has moved since. Null for
      // Lifetime, which has no earlier point to compare with.
      trend,
      comparedAt: previous ? range.from : null,
      /*
       * The clients who are nearly through their selection, closest to finishing first.
       *
       * A position rather than a period, which is why the range does not reach it: what the studio
       * wants from this panel is who to chase today, and a client sitting at 96% since last month
       * is exactly who that is - a range would have hidden them for having been quiet. A project
       * with no selection limit has no percentage and so is never here.
       */
      selectionProgress: [...active].filter((row) => classify.isNearlyDone(row.percent)).sort((first, second) => second.percent - first.percent || byLastActivity(first, second)).slice(0, PROGRESS_LIMIT).map(strip),
      storage,
      // Every project, most recently active first, each carrying which of the dashboard's views
      // it belongs to. The cards above the table filter it in the browser from these flags, so a
      // press is instant and asks the server for nothing — and every row was already read to
      // count the cards, so this costs no query. Rows are small; a studio's whole register is a
      // few hundred kilobytes, and the table draws them a page at a time.
      // `disabledAt` beside the switch: when a disabled project was switched off, so Expand's Enabled
      // and Disabled cards can say where each stood at the start of the range, as every card does.
      recentProjects: [...rows].sort(byLastActivity).map(({ attention: views, ...row }) => ({ ...row, views, expandEnabled: !off.has(row.id), disabledAt: disabledAtOf.get(row.id) || null })),
      expand,
      generatedAt: at,
    };
  }

  /**
   * The ids among `projects` that belong on one Needs Attention row — how the Projects list
   * answers `?attention=`, from the same classifier the dashboard counted with.
   */
  async function attentionProjectIds(projects, kind) {
    if (!classify.ATTENTION_KINDS.includes(kind)) return new Set(projects.map((project) => project.id));
    const at = now();
    const snapshots = await snapshotsFor(projects);
    return new Set(projects.filter((project) => classify.attentionFlagsOf(snapshots.get(project.id), at)[kind]).map((project) => project.id));
  }

  return { build, attentionProjectIds };
}

module.exports = { createDashboardService, rangeBounds, limitOf, RANGE_KEYS, RANGE_LABELS, DEFAULT_RANGE, PROGRESS_LIMIT };
