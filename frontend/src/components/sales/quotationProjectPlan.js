/**
 * The shoots, services and deliverables a quotation was priced on, shaped for a project.
 *
 * A quotation is built in the same Service Creation section a project is - the same
 * `AddShootDialog`, the same service and deliverable definitions - so what was quoted is already
 * the plan the project starts from. Retyping it is a chance to plan something other than what the
 * client agreed to pay for.
 *
 * Two things have to be rewritten on the way across, and they are the whole reason this is not a
 * spread:
 *
 *   - A quoted shoot carries the generator's own ids (`quote-shoot-...`, `Q-SID-0004`). Those mean
 *     nothing to a project, whose shoot ids are issued by the server, so they are dropped and
 *     replaced with fresh client keys.
 *   - Services and deliverables point at their shoot by that dropped id. Copied unchanged they
 *     would point at nothing and every shoot would arrive empty, so each row is re-pointed at the
 *     new key its shoot was given.
 *
 * The same two rewrites are what duplicating a *project* needs, for the same reason: a project shoot
 * carries the server's own ids and its allocations point at those, so a copy that keeps them would
 * hang the new project's rows off the old project's shoots. `planFromProject` is therefore the same
 * function under a second name rather than a second implementation of it - see `SOURCES` below.
 *
 * Imported by relative path and free of React so `node --test` can run it, which is where the
 * re-pointing is actually checked.
 */

import { deliverableIdentityKey, deliverableRowVariant } from "../../lib/deliverableBrands.mjs";

/*
 * Where a plan came from, which shows up in nothing but the client-side row keys.
 *
 * Those keys never reach the server - `shootsPayload` strips them - so this is purely so a row
 * inspected in the browser says which of the two copies put it there.
 */
const SOURCES = { quotation: "from-quotation", project: "from-project" };

/*
 * A line the brand sells that the project catalogue does not describe carries a made-up
 * definition id (`brand-service:…`) so the generator's table can key it. A project cannot allocate
 * it - there is no definition to allocate - so it crosses with no definition, which the project
 * form reads as a line to leave out rather than one to fail on.
 */
const BRAND_ONLY_PREFIXES = ["brand-service:", "brand-deliverable:"];
export function projectDefinitionId(value) {
  const id = String(value || "");
  return BRAND_ONLY_PREFIXES.some((prefix) => id.startsWith(prefix)) ? "" : id;
}

/** The copied service fields a project allocation accepts, and nothing else. */
function serviceRow(quoted, shootKey, prefix) {
  return {
    id: `${prefix}-service-${shootKey}-${quoted.serviceDefinitionId || quoted.id}`,
    shootId: shootKey,
    serviceDefinitionId: projectDefinitionId(quoted.serviceDefinitionId),
    serviceName: quoted.serviceName || "",
    quantity: quoted.quantity ?? 1,
    sessionOptionId: quoted.sessionOptionId || "",
    durationHours: quoted.durationHours ?? "",
    durationMinutes: quoted.durationMinutes ?? "",
    workDays: quoted.workDays ?? "",
    timingMinutes: quoted.timingMinutes ?? "",
    sizeOptionValueId: quoted.sizeOptionValueId || "",
    remarks: quoted.remarks || "",
  };
}

/*
 * The copied deliverable fields a project allocation accepts - and the variant the line was sold
 * as, so "Painting - textra - 12x6 - 2" on the quotation is that on the project too rather than
 * arriving as "Painting". A quoted line keeps its variant as `deliverableBrandName` beside the
 * variant's id; a project line as `brandName`; `deliverableRowVariant` reads either, so a duplicated
 * project carries its variants the same way. The variant is part of the row's key, because two
 * variants of one deliverable on one shoot are two lines.
 */
function deliverableRow(quoted, shootKey, prefix) {
  const variant = deliverableRowVariant(quoted);
  const variantKey = variant ? `-${deliverableIdentityKey("", variant).replace(/[^a-z0-9]+/g, "-")}` : "";
  return {
    id: `${prefix}-deliverable-${shootKey}-${quoted.deliverableDefinitionId || quoted.id}${variantKey}`,
    shootId: shootKey,
    deliverableDefinitionId: projectDefinitionId(quoted.deliverableDefinitionId),
    deliverableName: quoted.deliverableName || "",
    quantity: quoted.quantity ?? 1,
    numberOfPhotos: quoted.numberOfPhotos ?? "",
    sizeOptionValueId: quoted.sizeOptionValueId || "",
    size: quoted.size || "",
    remarks: quoted.remarks || "",
    ...(variant ? {
      deliverableVariantId: quoted.deliverableVariantId || "",
      brandName: variant.brandName,
      frameInches: variant.frameInches,
      videoLength: variant.videoLength,
    } : {}),
  };
}

/**
 * What makes two shoots the same shoot, for deciding whether a project already has one.
 *
 * The name, the day and the place - the three a person would compare. Not the id: a quoted shoot
 * and the project shoot planned from it never share one, which is the whole problem this answers.
 * Not the whole row either, because a shoot whose timing or food owner was adjusted after the
 * quotation is still that shoot, and re-adding it would give the project the same day twice.
 */
export function shootSignature(shoot) {
  const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return [text(shoot?.shoot), String(shoot?.dateCreated ?? "").slice(0, 10), text(shoot?.shootPlace)].join("|");
}

/**
 * The shoot fields a project's form holds, and nothing the server issued or stamped.
 *
 * A quoted shoot arrives carrying only these already, so this changes nothing on that path. A
 * *project* shoot arrives as a database row - `projectId`, `deletedAt`, `createdAt`, `updatedAt`,
 * and the relation counts read alongside it - none of which describe the shoot being planned, and
 * all of which would otherwise sit in the new form's state and be sent with it. The create schema
 * strips what it does not know, so this is not the only thing standing between them and the
 * database; it is what keeps the copied shoot the same shape as one the dialog just made, so that
 * editing it behaves identically.
 */
const SHOOT_FIELDS = [
  "dateCreated", "shoot", "shootPlace", "shootLocations", "shootType", "shootTypes", "isMainEvent", "district", "state",
  "eventStartTime", "eventEndTime", "sessionTiming", "sessionTimings", "sessionDurationHours",
  "sessionDurationMinutes", "foodTakenCareBy", "accommodation", "travel", "preference",
];

const shootFields = (shoot) => Object.fromEntries(
  SHOOT_FIELDS.filter((field) => shoot?.[field] !== undefined).map((field) => [field, shoot[field]]),
);

/**
 * One `{ shoots, services, deliverables }` source re-keyed for a project form.
 *
 * `makeKey` supplies each new shoot's client key, so the caller decides what those look like and a
 * test can make them predictable.
 */
function replan(source, makeKey, prefix) {
  const sourceShoots = Array.isArray(source?.shoots) ? source.shoots : [];
  const sourceServices = Array.isArray(source?.services) ? source.services : [];
  const sourceDeliverables = Array.isArray(source?.deliverables) ? source.deliverables : [];

  const shoots = [];
  const services = [];
  const deliverables = [];

  for (const original of sourceShoots) {
    // The source's own ids go no further than this line.
    const key = makeKey();
    shoots.push({ ...shootFields(original), id: key, clientKey: key });
    for (const service of sourceServices.filter((row) => row.shootId === original.id)) {
      services.push(serviceRow(service, key, prefix));
    }
    for (const deliverable of sourceDeliverables.filter((row) => row.shootId === original.id)) {
      deliverables.push(deliverableRow(deliverable, key, prefix));
    }
  }

  return { shoots, services, deliverables };
}

/** One quotation payload as `{ shoots, services, deliverables }` ready for a project form. */
export function planFromQuotation(payload, makeKey) {
  return replan(payload, makeKey, SOURCES.quotation);
}

/**
 * One existing project's plan, ready for the form that books its duplicate.
 *
 * The same rewrite as a quotation's, because the problem is the same one: the allocations point at
 * their shoot by the id the *old* project's shoot holds, and the new project's shoots do not exist
 * yet. Copied unchanged, every shoot would arrive empty - which reads as a project that was sold
 * with no services rather than as a copy that lost them.
 */
export function planFromProject(plan, makeKey) {
  return replan(plan, makeKey, SOURCES.project);
}

/**
 * The part of a quoted plan a project does not already hold.
 *
 * Additive on purpose, and that is a safety rule rather than a preference: a project shoot carries
 * cash entries, payment request expenses, client storage records and post-production allocations,
 * and its deliverables are removed with it by `ON DELETE CASCADE`. Replacing a live project's
 * shoots with a quotation's would take real money records with them, so a shoot the project
 * already has is left exactly as it is - adjustments made since the quotation are kept - and only
 * genuinely new shoots come across, bringing their own services and deliverables with them.
 */
export function unplannedPart(plan, existingShoots = []) {
  const held = new Set((existingShoots || []).map(shootSignature));
  const shoots = plan.shoots.filter((shoot) => !held.has(shootSignature(shoot)));
  const keys = new Set(shoots.map((shoot) => shoot.id));
  return {
    shoots,
    services: plan.services.filter((row) => keys.has(row.shootId)),
    deliverables: plan.deliverables.filter((row) => keys.has(row.shootId)),
  };
}

/**
 * Whether the quoted plan should be fetched and applied right now.
 *
 * Extracted from the effect and given its own tests because getting it wrong fails *silently* -
 * nothing appears, no error is raised, and the feature simply looks unbuilt. That is exactly what
 * happened once already: the guard consulted `useProjectPlan`'s `loadingMasterData`, which is
 * initialised to `true` and only cleared by a `load()` that returns early when there is no project
 * - so on Create Project, where there is no project by definition, it was `true` for ever and the
 * shoots never came across.
 *
 * `masterDataLoading` must therefore be the flag belonging to the mode being used: the form's own
 * on a create, the plan's on an edit. The caller decides which; this only insists that one is
 * given and that it is finished.
 */
export function readyToBringPlan({ quotationId, quotationRowId, appliedQuotationId, masterDataLoading }) {
  if (!String(quotationId || "").trim()) return false;
  // No row id means a reopened project stating the quotation it was sold on, rather than somebody
  // choosing one now. Nothing to fetch, and nothing to mark as fetched.
  if (!String(quotationRowId || "").trim()) return false;
  if (String(quotationId).trim() === String(appliedQuotationId || "").trim()) return false;
  return !masterDataLoading;
}
