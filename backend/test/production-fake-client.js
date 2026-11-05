/*
 * An in-memory stand-in for the Prisma calls the production module makes, so its tests run
 * without MySQL. It honours only the parts of each `where` the module relies on: ids, the shoot,
 * the current step, soft-deletion, an asset's category and status, active vendors and active employees.
 */
/*
 * `templatesOff: ["production.started_from_studio"]` switches those message templates off, as the
 * studio does on Settings → Templates.
 *
 * `travelPhotos: true` gives every production the photos each photo step needs (one each for Started
 * to shoot, Reached venue, Shoot started and Happy clients; two for Happening now), for tests that
 * complete those steps while testing something else.
 */
function createProductionFake({ productions = [], shoots = [], employees = [], assets = [], services = [], vendors = [], files = [], messages = [], projects = [], travelPhotos = false, templatesOff = [] } = {}) {
  const rows = productions.map((row) => ({ currentStep: "STARTED_FROM_STUDIO", planSubmittedAt: null, shootStatus: null, productionCoordinatorEmployeeId: null, ...row }));
  const seeded = travelPhotos
    ? rows.flatMap((row) => ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPENING_NOW", "HAPPY_CLIENTS"].map((kind, index) => ({ id: `seed-${row.id}-${kind}-${index}`, productionId: row.id, kind, url: `https://cdn.example/${kind}-${index}.webp`, fileName: `${kind}-${index}.webp` })))
    : [];
  const state = {
    productions: rows,
    files: [...seeded, ...files.map((file) => ({ ...file }))],
    messages: messages.map((message) => ({ error: null, reason: null, sentFromUserId: null, updatedAt: new Date(), ...message })),
    activities: [],
    links: { team: [] },
    crew: [],
    footage: [],
    projects,
  };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;
  const idsIn = (where) => where?.id?.in || [];
  const byId = (id) => state.productions.find((row) => row.id === id);
  // `retryMessage`'s claim matches FAILED, or a SENDING row old enough to be stale (`updatedAt.lt`).
  const matchesMessageWhere = (message, where) => {
    if (where.productionId !== undefined && message.productionId !== where.productionId) return false;
    if (where.step !== undefined && message.step !== where.step) return false;
    const clauses = where.OR || [where];
    return clauses.some((clause) => {
      // `status` is a value or an `in` list (closing every message still waiting on a switched-off template).
      if (clause.status !== undefined && !(Array.isArray(clause.status.in) ? clause.status.in : [clause.status]).includes(message.status)) return false;
      if (clause.updatedAt?.lt !== undefined && !(message.updatedAt < clause.updatedAt.lt)) return false;
      return true;
    });
  };
  // The category list and status list a `where` names (CAMERA_WHERE, VEHICLE_WHERE); an asset with
  // no `status` in the fixture counts as ACTIVE.
  const assetMatches = (asset, where) => !asset.isDeleted
    // A query naming no category - looking a camera up by id, to name it - takes any asset.
    && (!where.category || (where.category?.name?.in || []).includes(asset.category))
    && (!where.status?.in || where.status.in.includes(asset.status || "ACTIVE"));
  const links = (bucket) => ({
    findMany: async ({ where }) => state.links[bucket].filter((link) => link.productionId === where.productionId),
    // `where.OR` is a list of `{ field: { not: null } }` clauses: only a row matching one of them goes.
    deleteMany: async ({ where }) => {
      const goes = (link) => link.productionId === where.productionId && (!where.OR || where.OR.some((clause) => Object.entries(clause).every(([field, check]) => link[field] != null && check.not === null)));
      state.links[bucket] = state.links[bucket].filter((link) => !goes(link));
      return { count: 0 };
    },
    createMany: async ({ data }) => { state.links[bucket].push(...data); return { count: data.length }; },
  });

  const client = {
    state,
    $transaction: async (work) => work(client),
    projectProduction: {
      findFirst: async ({ where }) => state.productions.find((row) => row.shootId === where.shootId) || null,
      findUnique: async ({ where }) => byId(where.id) || null,
      // `availability.js` reads every seat of the other shoots: its person, and the cameras it carries.
      findMany: async ({ where }) => state.productions.filter((row) => row.id !== where.id?.not && row.shoot)
        .map((row) => ({ shoot: row.shoot, serviceCrew: (row.serviceCrew || []).map((crew) => ({ employeeId: crew.employeeId ?? null, cameras: crew.cameras || [] })) })),
      update: async ({ where, data }) => Object.assign(byId(where.id), data),
      updateMany: async ({ where, data }) => {
        const rows = state.productions.filter((row) => row.id === where.id && (where.currentStep === undefined || row.currentStep === where.currentStep));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    // A shoot's date and times (`shoots`), and the other productions `availability.js` reads crew from:
    // a production's `shoot` and `serviceCrew` are given on its row.
    projectShoot: {
      findUnique: async ({ where }) => shoots.find((shoot) => shoot.id === where.id) || null,
    },
    projectProductionFootage: {
      createMany: async ({ data }) => { state.footage.push(...data); return { count: data.length }; },
      /*
       * `{ not: null }` on each answer is how the save counts the services that are fully filled in -
       * a part-filled row is held but is not one the step is waiting on.
       */
      count: async ({ where }) => state.footage.filter((row) => row.productionId === where.productionId
        && Object.entries(where).every(([field, test]) => field === "productionId" || !(test && test.not === null) || (row[field] !== null && row[field] !== undefined))).length,
      /*
       * Cleared by service, the way `execution.clearFootage` asks for it: a list of ids, or NULL on
       * its own (a shoot with no services booked), or the whole production when no service is named.
       */
      deleteMany: async ({ where }) => {
        const named = where.serviceDefinitionId;
        const matches = (row) => {
          if (row.productionId !== where.productionId) return false;
          if (named === undefined) return true;
          if (named && Array.isArray(named.in)) return named.in.includes(row.serviceDefinitionId);
          return (row.serviceDefinitionId ?? null) === (named ?? null);
        };
        const kept = state.footage.filter((row) => !matches(row));
        const count = state.footage.length - kept.length;
        state.footage.length = 0;
        state.footage.push(...kept);
        return { count };
      },
    },
    projectProductionFile: {
      count: async ({ where }) => state.files.filter((file) => file.productionId === where.productionId && (!where.kind || file.kind === where.kind)).length,
      findFirst: async ({ where }) => state.files.find((file) => file.id === where.id && file.productionId === where.productionId) || null,
      createMany: async ({ data }) => { data.forEach((file) => state.files.push({ id: nextId("file"), ...file })); return { count: data.length }; },
      delete: async ({ where }) => state.files.splice(state.files.findIndex((file) => file.id === where.id), 1)[0],
    },
    projectProductionActivity: { create: async ({ data }) => { state.activities.push(data); return data; } },
    projectProductionMessage: {
      upsert: async ({ where, create, update }) => {
        const key = where.productionId_step;
        const row = state.messages.find((message) => message.productionId === key.productionId && message.step === key.step);
        if (row) { Object.assign(row, update, { updatedAt: new Date() }); return row; }
        const created = { error: null, reason: null, sentFromUserId: null, updatedAt: new Date(), ...create };
        state.messages.push(created);
        return created;
      },
      updateMany: async ({ where, data }) => {
        const rows = state.messages.filter((message) => matchesMessageWhere(message, where));
        rows.forEach((message) => Object.assign(message, data, { updatedAt: new Date() }));
        return { count: rows.length };
      },
    },
    projectProductionTeamMember: links("team"),
    // The shoot's booked services (Edit Project's allocations): `{ shootId, serviceDefinitionId, serviceName }`.
    projectPostProductionAllocation: {
      // As Prisma answers it: the definition's "Deliverable added" comes back through the relation.
      // A fixture says `deliverableAdded: false` for a service that hands nothing over; the default
      // is a service that delivers, which is what the File in tests are about.
      findMany: async ({ where }) => services
        .filter((service) => service.shootId === where.shootId && !service.deletedAt && service.serviceDefinitionId)
        .map((service) => ({ ...service, serviceDefinition: { deliverableAdded: service.deliverableAdded !== false } })),
    },
    projectProductionServiceCrew: {
      findMany: async ({ where }) => state.crew.filter((row) => row.productionId === where.productionId),
      deleteMany: async ({ where }) => { state.crew = state.crew.filter((row) => !(row.productionId === where.productionId && (!where.role || row.role === where.role))); return { count: 0 }; },
      // A seat's cameras are rows of their own, written with it - `cameras: { create: [...] }`.
      create: async ({ data: { cameras, ...row } }) => {
        const created = { ...row, cameras: (cameras?.create || []).map((camera) => ({ ...camera })) };
        state.crew.push(created);
        return created;
      },
    },
    /*
     * The logins `projectSender.resolve` reads: it asks twice, first for the employee's login and
     * then for that login again under `ELIGIBLE_SENDER` (active, employee, Allow WhatsApp). Employee
     * 9 - the Pre-Production Coordinator - holds login 30, which is the id the sends are asserted on.
     */
    user: {
      findFirst: async ({ where }) => {
        const logins = state.logins || [{ id: 30, linkedEmployeeId: 9, status: "ACTIVE", whatsappRequired: true }];
        const found = logins.find((login) => (where.linkedEmployeeId ? login.linkedEmployeeId === where.linkedEmployeeId : login.id === where.id));
        if (!found) return null;
        // The eligibility pass: a login that may not use WhatsApp is refused, as the real query does.
        if (where.whatsappRequired === true && !found.whatsappRequired) return null;
        return found;
      },
    },
    employee: {
      // `departments` on a fixture employee are the departments they are in; without any, Technical -
      // a shooter, which is what most fixtures want of everybody on a plan.
      findMany: async ({ where }) => employees
        .filter((employee) => idsIn(where).includes(employee.id) && (where.archivedAt === undefined || employee.active !== false))
        .map(({ id, employeeName, departments }) => ({ id, employeeName: employeeName || `Employee ${id}`, departments: (departments ?? ["Technical"]).map((name) => ({ department: { name } })) })),
      findFirst: async ({ where }) => employees.find((employee) => employee.id === where.id && employee.active !== false) || null,
      // For a refusal that names who it is about.
      findUnique: async ({ where }) => { const found = employees.find((employee) => employee.id === where.id); return found ? { employeeName: found.employeeName || `Employee ${found.id}` } : null; },
    },
    asset: {
      // Its name and code come back too, for the refusals that name a camera.
      findMany: async ({ where }) => assets.filter((asset) => idsIn(where).includes(asset.id) && assetMatches(asset, where))
        .map(({ id, assetName, assetCode }) => ({ id, assetName: assetName || `Asset ${id}`, assetCode: assetCode || `AST-${id}` })),
      findFirst: async ({ where }) => assets.find((asset) => asset.id === where.id && assetMatches(asset, where)) || null,
    },
    vendor: {
      findUnique: async ({ where }) => { const found = vendors.find((vendor) => vendor.id === where.id); return found ? { vendorName: found.vendorName || `Vendor ${found.id}` } : null; },
      findMany: async ({ where }) => vendors.filter((vendor) => idsIn(where).includes(vendor.id) && vendor.status === "ACTIVE" && !vendor.isDeleted && (where.canBeProductionTeamMember === undefined || vendor.canBeProductionTeamMember === where.canBeProductionTeamMember)).map(({ id }) => ({ id })),
    },
    /*
     * The studio's message templates, as Settings → Templates holds them. `templatesOff` is the keys
     * switched off; every other key reads as a template nobody has written, which is on by default
     * (`messageTemplate.isMessageEnabled`).
     */
    messageTemplate: {
      findUnique: async ({ where }) => (templatesOff.includes(where.key) ? { key: where.key, enabled: false } : null),
      findMany: async ({ where }) => templatesOff.filter((key) => (where?.key?.in || []).includes(key)).map((key) => ({ key, enabled: false })),
    },
    salesProject: {
      findFirst: async ({ where }) => {
        if (where.whatsappGroupJid) return projects.find((project) => project.whatsappGroupJid === where.whatsappGroupJid && project.id !== where.id?.not && !project.deletedAt) || null;
        return projects.find((project) => project.id === where.id && !project.deletedAt) || null;
      },
      update: async ({ where, data }) => Object.assign(projects.find((project) => project.id === where.id), data),
    },
  };
  return client;
}

/** One shoot's production record as the module reads it, with everything a message needs. */
function productionRow(overrides = {}) {
  return {
    id: "prod-1",
    shootId: "shoot-1",
    currentStep: "STARTED_FROM_STUDIO",
    planSubmittedAt: new Date("2026-09-30T04:00:00Z"),
    // A mode that takes tickets, so the ticket tests are about tickets and not about the mode.
    travelMode: "Train",
    // When the crew leaves the studio, which an outdoor plan is submitted with.
    studioStartDate: new Date("2026-10-02T00:00:00Z"),
    studioStartTime: "07:00",
    shootStatus: null,
    productionCoordinatorEmployeeId: 9,
    /*
     * A project's step messages go from its **Pre-Production Coordinator** (`projectSender.resolve`),
     * not from whoever linked the group - so the project names one, and `user.findFirst` below gives
     * that employee the login the message is sent from. `whatsappGroupLinkedByUserId` stays because
     * the group is still addressed by the jid stored when it was linked.
     */
    salesProject: {
      productionManagerEmployeeId: 5,
      preProductionCoordinatorEmployeeId: 9,
      preProductionCoordinatorEmployee: { employeeName: "Ravi" },
      eventId: "DBS-EV-1",
      whatsappGroupName: "Asha weds Arun",
      whatsappGroupJid: "120363012345678901@g.us",
      whatsappGroupLinkedByUserId: 30,
    },
    shoot: { shoot: "Reception", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: null },
    productionCoordinatorEmployee: { employeeName: "Ravi" },
    ...overrides,
  };
}

// Each holds PROJECT / Production Execution, so being named is what the tests decide by.
// The Production Manager plans, so holds Production at Read / Write (`writesProduction`) - a ticket asks it.
const manager = { userId: 20, name: "Meena", employeeId: 5, superAdmin: false, runsExecution: true, writesProduction: true };
const coordinator = { userId: 21, name: "Ravi", employeeId: 9, superAdmin: false, runsExecution: true };
const stranger = { userId: 22, name: "Guest", employeeId: 77, superAdmin: false, runsExecution: true };
const superAdmin = { userId: 1, name: "Owner", employeeId: null, superAdmin: true };

module.exports = { createProductionFake, productionRow, manager, coordinator, stranger, superAdmin };
