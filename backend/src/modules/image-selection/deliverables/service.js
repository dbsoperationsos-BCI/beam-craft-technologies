const repository = require("./repository");
const { createSettingsService } = require("../settings/service");
const { shootDayReached } = require("../shoot-visibility");
// The Deliverables table's Image Selection column is typed words now rather than a Yes/No pair.
// These read the words back into the answer this module has always worked from - see the module
// for the rule. Every `Yes` and `No` written before it reads exactly as it did.
const { deliverableAnswered, deliverableAnswerOn } = require("../../../services/deliverableAnswers");

// Comparison ignores case, spacing and punctuation so "Maxi Print", "Maxiprint" and "maxi-print"
// all resolve to the same service.
function normalizeServiceName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Photo Selection, Photo Culling and Signature Album are the workspace's own three tabs — the
// client never picks photos against them as selection items, so they never appear in Selection
// Settings whatever the Deliverables table answers. Which tabs a linked project shows is the
// workspace's reading of `listAllocatedServices` (`frontend/src/lib/imageSelectionTabs.mjs`):
// Photo Selection once any allocated service is `selectable` - a Selection Item - Photo Culling
// always, and Signature Album when it is allocated and its row says an explicit Yes. Matched by
// contained name so "Signature Album (Soft Copy)" and the other spellings count.
const TAB_ONLY_SERVICES = ["photoselection", "photoculling", "aiculling", "aiediting", "signaturealbum"];
function isTabOnlyService(name) {
  const key = normalizeServiceName(name);
  return TAB_ONLY_SERVICES.some((base) => key.includes(base));
}

const DEFAULT_SELECTION_LIMIT = 50;
const MIN_SELECTION_LIMIT = 1;
const MAX_SELECTION_LIMIT = 100000;

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function sourceKey(item) { return item.projectPostProductionAllocationId ? `allocation:${item.projectPostProductionAllocationId}` : `deliverable:${item.projectShootDeliverableId}`; }

// Selection items come only from the project's Post Production Allocation deliverables, which
// are stored as ProjectShootDeliverable rows. Production Creation services — candid
// photography, drone, and other shoot-day work — are never something the client picks photos
// against, so they are left out entirely. Within the allocation itself only the photo-facing
// services qualify; an unallocated service never appears at all.
//
// Which services are photo-facing is the deliverable definition's Image Selection column in
// Project Settings — nothing is hard-coded here. The definition the row is linked to answers
// first; a row allocated before rows carried a definition link is matched to one by name. The
// column is typed words now: an answer starting with "no" keeps the service out, so does a blank
// one and so does no definition at all, and anything else typed admits it. (The migration
// `20260820090000` stamped Yes onto the definitions the retired built-in list used to admit, so
// existing projects kept their selection items when the list moved into the table.)
/**
 * The Image Selection answer for one allocated row: true, false, or null for never answered.
 *
 * Three states, as it has always been, now read out of the words the column holds. The definition
 * the row is linked to answers first, and only if it has been answered at all - a blank is not a
 * No, it is nothing, and the row falls back to the definition matched by name, which is how a row
 * allocated before rows carried a definition link is still read. Unanswered by both stays null:
 * `listAllocatedServices` reports the table's answer rather than applying it, and "nobody has said"
 * is a different thing to report than "they said no".
 */
function flagWith(enabledByName) {
  const answerOf = (value) => (deliverableAnswered(value) ? deliverableAnswerOn(value) : null);
  return (deliverable) => {
    const own = answerOf(deliverable.deliverableDefinition?.imageSelectionEnabled);
    if (own !== null) return own;
    return answerOf(enabledByName.get(normalizeServiceName(deliverable.deliverableName)));
  };
}
function selectableWith(enabledByName) {
  const flagOf = flagWith(enabledByName);
  return (deliverable) => !isTabOnlyService(deliverable.deliverableName) && flagOf(deliverable) === true;
}

function buildSources(deliverables, enabledByName = new Map()) {
  return deliverables
    .filter(selectableWith(enabledByName))
    // A shoot's deliverables wait for the shoot: a Wedding dated 28 Oct offers its selection items
    // from 28 Oct (studio time), while an already-shot Pre Wedding's are not held back by it.
    // Synchronize leaves a waiting item's config exactly as it is (`heldSourceKeys`) - picks,
    // submission and all - and offers it again the day its shoot arrives.
    // A deliverable that hangs off no shoot is not waiting for one; only a deliverable whose
    // shoot has yet to happen is held back. Asked in that order because an undated shoot and
    // an absent shoot both read as an empty date and mean opposite things.
    .filter((deliverable) => !deliverable.shoot || shootDayReached(deliverable.shoot.dateCreated))
    // `selectionLimit` is the deliverable's own answer to "how many photos may the client pick" and
    // is the one number both screens share. With no limit set, `numberOfPhotos` — the No of Photos
    // typed on the Post Production Allocation — stands in, because that is the count the studio
    // actually ordered photos against. `quantity` is how many of the deliverable were ordered (one
    // album is one album however many photos go into it) and is only the last resort for a
    // deliverable allocated before either field existed.
    // The nested shoot keeps the three fields it always carried; the date only decides the filter
    // above and is not part of the payload.
    .map((deliverable) => ({ projectPostProductionAllocationId: null, projectShootDeliverableId: deliverable.id, name: deliverable.deliverableName, shootId: deliverable.shootId, shoot: deliverable.shoot ? { id: deliverable.shoot.id, shootId: deliverable.shoot.shootId, shoot: deliverable.shoot.shoot } : null, quantity: deliverable.quantity, numberOfPhotos: deliverable.numberOfPhotos ?? null, allocatedSelectionLimit: deliverable.selectionLimit ?? null }));
}

/*
 * The selection items that are only waiting: their deliverable is live and selectable, and its shoot
 * has not reached its day - not yet scheduled, or moved to a later date. Their configs are neither
 * offered nor retired, so a shoot re-dated after the client picked from it keeps every pick and its
 * submission, and is offered again as it was when the day comes. Keys as `sourceKey` writes them.
 */
function heldSourceKeys(deliverables, enabledByName = new Map()) {
  return new Set(deliverables
    .filter(selectableWith(enabledByName))
    .filter((deliverable) => deliverable.shoot && !shootDayReached(deliverable.shoot.dateCreated))
    .map((deliverable) => sourceKey({ projectShootDeliverableId: deliverable.id })));
}

// Every source is now an allocated post production deliverable, so each one is offered to
// the client unless the studio unchecks it.
const DEFAULT_ENABLED = true;

// `defaultSelectionLimit` is the studio-wide setting, used only when the allocation itself carries
// no quantity. It defaults to the constant so a caller with no settings to hand — and every test
// that predates the settings table — behaves exactly as before.
/**
 * How many photos the client may pick for one selection item, and where that number came from.
 *
 * Four answers in order of authority: the limit set on the allocated deliverable, then the No of
 * Photos on the allocation, then the quantity that was ordered, then the studio-wide default. The
 * first is the number both screens now share; the others only stand in for a deliverable that has
 * not been given a limit of its own.
 *
 * An allocation-derived item takes no notice of `selectionLimitOverride` at all. Honouring one would
 * put the number back in two places, and a stale override is precisely what used to hide a change made
 * in Project Management — an Album Selection allocated for 5000 photos still reading 50 in Selection
 * Items, with nothing the studio could do about it. The overrides left by that behaviour are cleared by
 * migration `20260817170000_add_deliverable_selection_limit`. The column stays in use for a selection
 * item the studio typed itself, which has no deliverable to hold its number.
 */
/** What the limit falls back to with nothing set on the deliverable: the No of Photos on the
 *  allocation, then the quantity ordered, then the studio-wide default. Saving this number means
 *  "no limit of your own" rather than pinning it. */
function fallbackLimitOf(source, defaultSelectionLimit) {
  return source.numberOfPhotos ?? source.quantity ?? defaultSelectionLimit;
}
function derivedLimitOf(source, defaultSelectionLimit) {
  return source.allocatedSelectionLimit ?? fallbackLimitOf(source, defaultSelectionLimit);
}
const isFromAllocation = (source) => Boolean(source.projectShootDeliverableId || source.projectPostProductionAllocationId);

function mapSource(source, config, defaultSelectionLimit = DEFAULT_SELECTION_LIMIT) {
  const derivedSelectionLimit = derivedLimitOf(source, defaultSelectionLimit);
  const selectionLimit = isFromAllocation(source) ? derivedSelectionLimit : config?.selectionLimitOverride ?? derivedSelectionLimit;
  return { id: config?.id || null, ...source, enabled: config ? config.enabled : DEFAULT_ENABLED, selectionLimitOverride: config?.selectionLimitOverride ?? null, fallbackSelectionLimit: fallbackLimitOf(source, defaultSelectionLimit), derivedSelectionLimit, selectionLimit, displayOrder: config?.displayOrder ?? null, selectionSubmittedAt: config?.selectionSubmittedAt ?? null, inactiveAt: config?.inactiveAt ?? null };
}

/** A limit as it is stored: a number, or null for "not set". */
const limitOrNull = (value) => (value === null || value === undefined ? null : Number(value));

// The settings service is injectable for the same reason the repository is: a unit test hands in a
// stub rather than reaching for a database to learn what the studio-wide default limit is.
function createDeliverableService(repo = repository, settings = createSettingsService()) {
  // Selection items are derived from the linked Project Management job, so a manual or
  // duplicated project simply has none. That is an empty list, not an error: the rest of
  // Selection Settings — validity, publishing, the client link, the PIN — works the same
  // either way, and failing here used to take the whole settings panel down with it.
  async function requireProject(imageSelectionProjectId) {
    const project = await repo.findImageSelectionProject(imageSelectionProjectId);
    if (!project) throw httpError(404, "Active Image Selection project not found.");
    return project;
  }
  async function enabledMapFor(store) {
    const definitions = await store.listDeliverableDefinitions();
    return new Map(definitions.map((definition) => [normalizeServiceName(definition.name), definition.imageSelectionEnabled]));
  }
  async function synchronize(imageSelectionProjectId) {
    const project = await requireProject(imageSelectionProjectId);
    if (!project.salesProjectId) return [];
    return repo.transaction(async (tx) => {
      const [deliverables, enabledByName] = await Promise.all([tx.listShootDeliverables(project.salesProjectId), enabledMapFor(tx)]);
      const sources = buildSources(deliverables, enabledByName);
      // Waiting for their shoot's day: neither offered nor retired below (`heldSourceKeys`).
      const held = heldSourceKeys(deliverables, enabledByName);
      const existing = await tx.listConfigs(project.id); const byKey = new Map(existing.map((config) => [sourceKey(config), config]));
      const activeKeys = new Set(); const configs = []; let addedNew = false;
      for (const [displayOrder, source] of sources.entries()) {
        const key = sourceKey(source); activeKeys.add(key); const config = byKey.get(key);
        if (!config) addedNew = true;
        configs.push(config ? await tx.updateConfig(config.id, { inactiveAt: null, displayOrder }) : await tx.createConfig({ imageSelectionProjectId: project.id, projectPostProductionAllocationId: source.projectPostProductionAllocationId, projectShootDeliverableId: source.projectShootDeliverableId, enabled: DEFAULT_ENABLED, selectionLimitOverride: null, displayOrder }));
      }
      // A new selection item arriving after the client submitted everything means the project is
      // no longer wholly submitted — the same invariant the reopen path maintains — so the
      // publication's all-submitted stamp is lifted and the gallery offers the new item.
      if (addedNew) await tx.clearPublicationSubmitted(project.id);
      for (const config of existing) if (!activeKeys.has(sourceKey(config)) && !held.has(sourceKey(config)) && !config.inactiveAt) await tx.updateConfig(config.id, { inactiveAt: new Date() });
      const byConfigKey = new Map(configs.map((config) => [sourceKey(config), config]));
      const { defaultSelectionLimit } = await settings.read();
      return sources.map((source) => mapSource(source, byConfigKey.get(sourceKey(source)), defaultSelectionLimit));
    });
  }
  // A manually named project has no allocation to derive selection items from, so the ones the
  // studio typed in Selection Settings are all it has. They are shaped exactly like a derived item
  // — same fields, same defaults — so nothing downstream has to know which kind it is reading.
  // The shoot each item is filed under stands in for a linked project's shoot: its key travels in
  // `shootId`, so the Selection Items table and the client gallery group by it — and submission
  // goes out one group at a time — exactly as a linked project's shoots do. Where the item points at
  // its root folder the key is that folder's id (`folder:<id>`) and the name is the folder's own,
  // read live - so a renamed folder is the same shoot under its new name. A typed group no folder
  // answers to yet keeps the name-made key it always had. The nested `shootId` stays null because
  // that slot is a shoot's DBS-SID business id, which a manual shoot lacks.
  function manualShootOf(config) {
    if (config.manualShootFolder) {
      const key = `folder:${config.manualShootFolder.id}`;
      return { shootId: key, shoot: { id: key, shootId: null, shoot: config.manualShootFolder.name, folderId: config.manualShootFolder.id } };
    }
    if (!config.manualShootName) return { shootId: null, shoot: null };
    const key = `manual:${normalizeServiceName(config.manualShootName)}`;
    return { shootId: key, shoot: { id: key, shootId: null, shoot: config.manualShootName, folderId: null } };
  }
  async function listManual(imageSelectionProjectId) {
    const configs = await repo.listManualConfigs(imageSelectionProjectId);
    if (!configs.length) return [];
    const { defaultSelectionLimit } = await settings.read();
    return configs.map((config) => mapSource(
      { projectPostProductionAllocationId: null, projectShootDeliverableId: null, name: config.name, ...manualShootOf(config), quantity: null, numberOfPhotos: null },
      config,
      defaultSelectionLimit,
    ));
  }

  async function list(imageSelectionProjectId) {
    const project = await requireProject(imageSelectionProjectId);
    if (!project.salesProjectId) return listManual(project.id);
    return synchronize(imageSelectionProjectId);
  }

  /**
   * One selection item on a manual project: a name, the number of photos the client may pick, and
   * the shoot group it is filed under. Names only have to be unique within their group — a
   * "Pre Wedding" and a "Wedding" can each hold an "Album" — because the group is how the client
   * gallery tells them apart.
   */
  async function addManualItem(imageSelectionProjectId, input) {
    const project = await requireProject(imageSelectionProjectId);
    if (project.salesProjectId) throw httpError(409, "This project takes its selection items from the linked Project Management job. Change them there instead.");
    const existing = await repo.listManualConfigs(project.id);
    const name = input.name.trim();
    // The shoot, by its folder's id where the screen sent one, else by name to the root folder of
    // that name. A shoot is always a folder: an item filed under a name no folder has would be an
    // orphan no folder delete could reach, so that is refused.
    let folder = null;
    if (input.shootFolderId) {
      folder = await repo.findRootFolder(project.id, input.shootFolderId);
      if (!folder) throw httpError(404, "That shoot's folder is not in this project any more.");
    } else if (input.shootName?.trim()) {
      const key = normalizeServiceName(input.shootName);
      folder = (await repo.listRootFolders(project.id)).find((entry) => normalizeServiceName(entry.name) === key) || null;
      if (!folder) throw httpError(404, `There is no "${input.shootName.trim()}" folder in this project any more.`);
    }
    const shootName = folder ? folder.name : input.shootName?.trim() || null;
    const groupKeyOf = (config) => (config.manualShootFolderId ? `folder:${config.manualShootFolderId}` : config.manualShootName ? normalizeServiceName(config.manualShootName) : null);
    const shootKey = folder ? `folder:${folder.id}` : shootName ? normalizeServiceName(shootName) : null;
    if (existing.some((config) => groupKeyOf(config) === shootKey && (config.name || "").trim().toLowerCase() === name.toLowerCase()))
      throw httpError(409, `"${name}" is already a selection item${shootName ? ` under ${shootName}` : ""}.`);
    await repo.createConfig({
      imageSelectionProjectId: project.id,
      projectPostProductionAllocationId: null,
      projectShootDeliverableId: null,
      name,
      manualShootName: shootName,
      manualShootFolderId: folder ? folder.id : null,
      enabled: DEFAULT_ENABLED,
      selectionLimitOverride: input.selectionLimit,
      displayOrder: existing.length,
    });
    // Same invariant as synchronize and the reopen path: a fresh item means the project's
    // selection is no longer wholly submitted, so the publication's stamp is lifted.
    await repo.clearPublicationSubmitted(project.id);
    return listManual(project.id);
  }

  /**
   * Removes one. A derived item is never deleted — it is retired with `inactiveAt` when the
   * allocation drops it — so this refuses anything but a typed one, and refuses a typed one the
   * client has already picked photos against rather than silently discarding that selection.
   */
  async function removeManualItem(imageSelectionProjectId, configId) {
    const project = await requireProject(imageSelectionProjectId);
    const config = await repo.findConfig(project.id, configId);
    if (!config) throw httpError(404, "Selection item not found.");
    if (config.projectPostProductionAllocationId || config.projectShootDeliverableId)
      throw httpError(409, "This selection item comes from the linked Project Management job and cannot be removed here.");
    if (await repo.countSelections(config.id))
      throw httpError(409, "The client has already selected photos for this item. Uncheck it instead of removing it.");
    await repo.deleteConfig(config.id);
    return listManual(project.id);
  }
  // The workspace tabs key off the raw Post Production Allocation: Signature Album is allocated
  // work that earns its own tab even though the client never picks photos against it, and
  // `selectable` - the Selection Items rule - is what earns Photo Selection. Names repeat across shoots,
  // so the list is deduplicated per service — but each service keeps the shoots it was
  // allocated to, so a tab can show exactly the shoots (Engagement, Pre Wedding, …) that carry
  // its work. The desktop app reads the same answer from the same endpoint. A shoot joins a
  // service's list from its own day, the same gate the folder tree and selection items apply
  // — a tab never offers a shoot whose root folder does not exist yet.
  async function listAllocatedServices(imageSelectionProjectId) {
    const project = await requireProject(imageSelectionProjectId);
    if (!project.salesProjectId) return [];
    const deliverables = await repo.listShootDeliverables(project.salesProjectId);
    const flagOf = flagWith(await enabledMapFor(repo));
    const byKey = new Map();
    for (const deliverable of deliverables) {
      const key = normalizeServiceName(deliverable.deliverableName);
      if (!key) continue;
      // `imageSelectionEnabled` is the table's answer read back: admitted, or not. The workspace
      // shows a tab only for an admitted service; "No", a blank answer and no definition at all
      // all keep the service off the workspace.
      if (!byKey.has(key)) byKey.set(key, { key, name: deliverable.deliverableName, selectable: !isTabOnlyService(deliverable.deliverableName) && flagOf(deliverable) === true, imageSelectionEnabled: flagOf(deliverable), shoots: [], shootIds: new Set() });
      const entry = byKey.get(key);
      const shoot = deliverable.shoot;
      if (shoot && shootDayReached(shoot.dateCreated) && !entry.shootIds.has(shoot.id)) {
        entry.shootIds.add(shoot.id);
        entry.shoots.push({ id: shoot.id, shootId: shoot.shootId, shoot: shoot.shoot });
      }
    }
    return [...byKey.values()].map(({ shootIds, ...entry }) => entry);
  }
  /**
   * Saves the Selection Items table.
   *
   * The checkbox is Image Selection's own business and stays on its row. The limit is not: for an
   * item that came from an allocated deliverable the number is written onto that deliverable, so
   * Project Management and Image Selection are reading and writing one value rather than each keeping
   * a copy that the other cannot see. Any override left on the row from before is cleared at the same
   * time, or it would go on outranking the number just saved.
   *
   * A selection item the studio typed has no deliverable behind it, so its number stays on the row.
   */
  async function saveOverrides(imageSelectionProjectId, items) {
    // Synchronising first is what keeps derived items in step with the allocation, so a deliverable
    // added or dropped in Project Management is accounted for before anything is written. What comes
    // back also says what each item's limit falls back to, which decides whether a saved number is a
    // limit of its own at all.
    const current = await list(imageSelectionProjectId);
    const fallbackByConfigId = new Map(current.filter((item) => item.id).map((item) => [item.id, item.fallbackSelectionLimit]));
    return repo.transaction(async (tx) => {
      const saved = [];
      let reopened = false;
      for (const item of items) {
        const config = await tx.findConfig(imageSelectionProjectId, item.configId);
        if (!config) throw httpError(404, "Deliverable configuration not found.");
        if (config.inactiveAt) throw httpError(409, "Cannot update an inactive deliverable configuration.");
        // Re-enabling a submitted item is the studio's reopen gesture: unchecking and checking it
        // again lifts the submitted lock, so the client may select once more — their earlier picks
        // stay exactly as they were — and the next submit locks the item again. Only the enable
        // transition reopens; unchecking alone keeps the record of what was submitted.
        const isReopen = Boolean(item.enabled && !config.enabled && config.selectionSubmittedAt);
        if (isReopen) reopened = true;
        const reopen = isReopen ? { selectionSubmittedAt: null } : {};
        const requested = limitOrNull(item.selectionLimit);
        if (config.projectShootDeliverableId) {
          // The limit belongs to the deliverable, which is where Project Management reads and writes
          // it too — one number, so a change on either screen is what the other sees. Any override
          // left on this row by an earlier version is cleared, or it would go on outranking it.
          //
          // A number equal to what the item falls back to anyway is stored as null rather than as a
          // limit of its own. Selection Settings posts every row on Save, not only the edited ones, so
          // writing each number as it stands would turn the quantity merely being *displayed* into a
          // hard limit — and then a quantity changed in Post Production Allocation could not reach
          // Image Selection any more. That is the bug this column was meant to end, and storing the
          // displayed number would only have moved it here.
          // Always written, including when it works out as null: that is how a limit set earlier is
          // handed back to the allocation once the studio types the quantity again.
          const fallback = fallbackByConfigId.get(config.id);
          const limit = requested !== null && fallback !== undefined && requested === Number(fallback) ? null : requested;
          await tx.setDeliverableSelectionLimit(config.projectShootDeliverableId, limit);
          saved.push(await tx.updateConfig(config.id, { enabled: item.enabled, selectionLimitOverride: null, ...reopen }));
          continue;
        }
        // A selection item the studio typed has no deliverable behind it, so the number it was given
        // is its limit and stays on the row.
        saved.push(await tx.updateConfig(config.id, { enabled: item.enabled, selectionLimitOverride: requested, ...reopen }));
      }
      // A reopened item means the project's selection is no longer wholly submitted, so the
      // publication's own submitted stamp is lifted too — otherwise the client gallery would keep
      // reading the everything-is-done state and never offer the reopened item.
      if (reopened) await tx.clearPublicationSubmitted(imageSelectionProjectId);
      return saved;
    });
  }
  return { list, listAllocatedServices, synchronize, saveOverrides, addManualItem, removeManualItem };
}

module.exports = { createDeliverableService, buildSources, heldSourceKeys, derivedLimitOf, DEFAULT_SELECTION_LIMIT, MIN_SELECTION_LIMIT, MAX_SELECTION_LIMIT };
