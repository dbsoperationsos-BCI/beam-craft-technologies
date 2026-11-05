const test = require("node:test");
const assert = require("node:assert/strict");
const { shootWindow, overlaps, busyCrew } = require("../src/modules/project-management/production/availability");
const { savePlan } = require("../src/modules/project-management/production/plan");
const { createProductionFake, productionRow, manager } = require("./production-fake-client");

/*
 * Who and what is free for a shoot's service crew: anybody - and any camera - not already on
 * another shoot whose TIME overlaps; never the day as such.
 */
const at = (date, start, end) => ({ dateCreated: new Date(`${date}T00:00:00.000Z`), eventStartTime: start, eventEndTime: end });

test("a shoot ending at 1:00 am leaves its crew free for one at 7:00 pm the same day", () => {
  const night = shootWindow(at("2026-10-06", "18:00", "01:00"));
  assert.equal(night.end - night.start, 7 * 60 * 60 * 1000, "an end before the start is the next morning");
  assert.equal(overlaps(night, shootWindow(at("2026-10-07", "19:00", "22:00"))), false);
  assert.equal(overlaps(night, shootWindow(at("2026-10-06", "23:00", "02:00"))), true);
  // From the evening before, into this morning.
  assert.equal(overlaps(night, shootWindow(at("2026-10-07", "00:30", "03:00"))), true);
});

test("back-to-back shoots do not clash, and a shoot without both times clashes with nothing", () => {
  assert.equal(overlaps(shootWindow(at("2026-10-06", "10:00", "14:00")), shootWindow(at("2026-10-06", "14:00", "16:00"))), false);
  assert.equal(shootWindow(at("2026-10-06", "10:00", null)), null);
  assert.equal(shootWindow({ dateCreated: null, eventStartTime: "10:00", eventEndTime: "12:00" }), null);
  assert.equal(shootWindow(at("2026-10-06", "25:00", "12:00")), null);
  assert.equal(overlaps(null, shootWindow(at("2026-10-06", "10:00", "12:00"))), false);
});

// The other shoot's seats: an employee id, or `[employeeId, ...cameraAssetIds]` for one with cameras.
const seat = (entry) => (Array.isArray(entry) ? { employeeId: entry[0], cameras: entry.slice(1).map((cameraAssetId) => ({ cameraAssetId })) } : { employeeId: entry });
const otherShoot = (crew, times = ["23:00", "02:00"]) => ({ id: "prod-2", shootId: "shoot-2", shoot: at("2026-10-06", ...times), serviceCrew: crew.map(seat) });

test("only another shoot's crew and cameras at an overlapping time are busy", async () => {
  // A camera is one object, so it is out on the other shoot exactly as the person holding it is.
  const client = createProductionFake({ productions: [productionRow(), otherShoot([[12, 3, 5], null])] });
  const me = { id: "prod-1", shoot: at("2026-10-06", "18:00", "01:00") };
  assert.deepEqual(await busyCrew(client, me), { employeeIds: [12], cameraAssetIds: [3, 5] });
  assert.deepEqual(await busyCrew(client, { id: "prod-1", shoot: at("2026-10-06", null, null) }), { employeeIds: [], cameraAssetIds: [] }, "no times, nothing busy");
  const later = createProductionFake({ productions: [productionRow(), otherShoot([[12, 3]], ["02:00", "04:00"])] });
  assert.deepEqual(await busyCrew(later, me), { employeeIds: [], cameraAssetIds: [] }, "after this shoot ends, free");
});

test("saving the plan refuses a newly named crew member or camera that is busy, but keeps one already on it", async () => {
  const SERVICES = [{ shootId: "shoot-1", serviceDefinitionId: "def-booth", serviceName: "360 Video Booth" }];
  const make = (crewRows = []) => {
    const client = createProductionFake({
      productions: [productionRow({ planSubmittedAt: null }), otherShoot([[12, 3]])],
      assets: [{ id: 3, category: "Cameras", assetName: "Sony A7", assetCode: "AST-3" }, { id: 5, category: "Cameras", assetName: "Canon R5", assetCode: "AST-5" }],
      shoots: [{ id: "shoot-1", ...at("2026-10-06", "18:00", "01:00") }],
      employees: [{ id: 12 }, { id: 13 }],
      services: SERVICES,
    });
    client.state.crew = crewRows;
    client.projectProductionServiceCrew = {
      findMany: async () => client.state.crew,
      deleteMany: async () => { client.state.crew = []; return { count: 0 }; },
      create: async ({ data: { cameras, ...row } }) => { client.state.crew.push({ ...row, cameras: cameras?.create || [] }); return row; },
    };
    return client;
  };
  const deps = (client) => ({ client, statuses: async () => ["active"], now: () => new Date("2026-10-01T06:00:00Z") });
  const lead = (employeeId, cameraAssetIds = []) => [{ serviceDefinitionId: "def-booth", role: "LEAD", employeeId, cameraAssetIds }];
  await assert.rejects(savePlan("shoot-1", { crew: lead(12) }, manager, deps(make())), (error) => error.status === 400 && /another shoot at that time/.test(error.message));
  await savePlan("shoot-1", { crew: lead(13) }, manager, deps(make()));
  // A camera out on that shoot is refused the same way, by name, and a free one is taken.
  await assert.rejects(savePlan("shoot-1", { crew: lead(13, [3]) }, manager, deps(make())), (error) => error.status === 400 && /Sony A7 \(AST-3\) is on another shoot at that time/.test(error.message));
  await savePlan("shoot-1", { crew: lead(13, [5]) }, manager, deps(make()));
  // Already on this plan before the clash came about: kept, not refused.
  await savePlan("shoot-1", { crew: lead(12) }, manager, deps(make([{ employeeId: 12, serviceDefinitionId: "def-booth", role: "LEAD" }])));
  await savePlan("shoot-1", { crew: lead(13, [3]) }, manager, deps(make([{ employeeId: 13, serviceDefinitionId: "def-booth", role: "LEAD", cameras: [{ cameraAssetId: 3 }] }])));
});

test("only an employee in the Technical department can be put on a service; one already on it stays", async () => {
  /*
   * Who may work a service is the **department**, not a list of skills.
   *
   * It was nine skill names matched against Settings → Skills, which meant somebody the studio
   * sends on shoots could not be put on one until a skill was ticked on their profile, and the list
   * had to be kept in step with the services the studio sells.
   */
  const C = require("../src/modules/project-management/production/crew");
  assert.equal(C.isShooter(["Operations", "Technical"]), true);
  assert.equal(C.isShooter(["technical"]), true, "any case");
  assert.equal(C.isShooter([" Technical "]), true, "and whatever spacing the name was saved with");
  assert.equal(C.isShooter(["Operations", "Sales"]), false);
  assert.equal(C.isShooter([]), false);
  // A department of its own, and not this one - the word being inside it means nothing.
  assert.equal(C.isShooter(["Non Technical"]), false);
  // The skills that used to decide it decide nothing now.
  assert.equal(C.isShooter(["Candid Photographer", "Drone"]), false);

  const SERVICES = [{ shootId: "shoot-1", serviceDefinitionId: "def-booth", serviceName: "360 Video Booth" }];
  const make = (crewRows = []) => {
    const client = createProductionFake({
      productions: [productionRow({ planSubmittedAt: null })],
      employees: [{ id: 12, employeeName: "Ravi", departments: ["Operations"] }, { id: 13, departments: ["Technical"] }],
      services: SERVICES,
    });
    client.state.crew = crewRows;
    client.projectProductionServiceCrew = {
      findMany: async () => client.state.crew,
      deleteMany: async () => { client.state.crew = []; return { count: 0 }; },
      create: async ({ data: { cameras, ...row } }) => { client.state.crew.push({ ...row, cameras: cameras?.create || [] }); return row; },
    };
    return client;
  };
  const deps = (client) => ({ client, statuses: async () => ["active"], now: () => new Date("2026-10-12T06:00:00Z") });
  const lead = (employeeId) => [{ serviceDefinitionId: "def-booth", role: "LEAD", employeeId, cameraAssetIds: [] }];
  await assert.rejects(savePlan("shoot-1", { crew: lead(12) }, manager, deps(make())), (error) => error.status === 400 && /Ravi is not in the Technical department/.test(error.message));
  await savePlan("shoot-1", { crew: lead(13) }, manager, deps(make()));
  await savePlan("shoot-1", { crew: lead(12) }, manager, deps(make([{ employeeId: 12, serviceDefinitionId: "def-booth", role: "LEAD" }])));
});
