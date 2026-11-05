const test = require("node:test");
const assert = require("node:assert/strict");
const { swapSeats, clash } = require("../src/modules/project-management/production/swap");

/*
 * The Production Schedule's drag: two services' people swapped, on one shoot or across two. A small
 * fake of its own, answering only the reads and writes the swap makes.
 */
const statuses = async () => ["Active"];
const manager = { userId: 20, name: "Meena", employeeId: 5, superAdmin: false };
const coordinator = { userId: 21, name: "Ravi", employeeId: 9, superAdmin: false };

const day = (date) => new Date(`${date}T00:00:00Z`);
const production = (id, shootId, date, start, end, overrides = {}) => ({
  id, shootId, planSubmittedAt: null, productionCoordinatorEmployeeId: 9,
  salesProject: { productionManagerEmployeeId: 5, eventId: `EVT-${id}`, whatsappGroupName: `Project ${id}` },
  shoot: { shootId: `SID-${id}`, shoot: `Shoot ${id}`, dateCreated: day(date), eventStartTime: start, eventEndTime: end },
  ...overrides,
});
const SERVICES = { candid: "Candid Photo", video: "Traditional Video", drone: "Drone", led: "LED Wall" };

function fake({ productions, crew, team = [], allocations }) {
  const state = { productions, crew: crew.map((row, index) => ({ id: `crew-${index}`, vendorStatus: null, ...row })), team, activities: [], cameraClears: [] };
  const people = { 12: "Ajeesh", 13: "Sridhar", 14: "Anand" };
  const vendors = { 7: "Venu Videos" };
  const seatOut = (row) => row && { ...row, employee: row.employeeId ? { employeeName: people[row.employeeId] } : null, vendor: row.vendorId ? { vendorName: vendors[row.vendorId] } : null };
  const client = {
    state,
    $transaction: async (work) => work(client),
    projectProduction: {
      findFirst: async ({ where }) => state.productions.find((row) => row.shootId === where.shootId) || null,
      update: async ({ where, data }) => Object.assign(state.productions.find((row) => row.id === where.id), data),
      // The lock: a write on the shoot's row, recorded in order so the test can see it comes first.
      updateMany: async ({ where }) => { state.locks = [...(state.locks || []), where.shootId]; return { count: 1 }; },
      findMany: async ({ where }) => {
        const employeeId = where.OR[0].serviceCrew.some.employeeId;
        return state.productions.filter((row) => row.id !== where.id.not).map((row) => ({
          id: row.id,
          shoot: row.shoot,
          salesProject: row.salesProject,
          serviceCrew: state.crew.filter((seat) => seat.productionId === row.id && seat.employeeId === employeeId).map((seat) => ({ ...seat, serviceDefinition: { name: SERVICES[seat.serviceDefinitionId] } })),
          teamMembers: state.team.filter((member) => member.productionId === row.id && member.employeeId === employeeId),
        })).filter((row) => row.serviceCrew.length || row.teamMembers.length);
      },
    },
    projectShoot: { findUnique: async ({ where }) => state.productions.find((row) => row.shootId === where.id)?.shoot || null },
    projectPostProductionAllocation: {
      findMany: async ({ where }) => (allocations[where.shootId] || []).map((id) => ({ serviceDefinitionId: id, serviceName: SERVICES[id] })),
    },
    projectProductionServiceCrew: {
      // A seat by its service, or - `{ not }` - one of the person's on another service of the shoot.
      findFirst: async ({ where }) => {
        const service = (row) => (where.serviceDefinitionId?.not !== undefined ? row.serviceDefinitionId !== where.serviceDefinitionId.not : row.serviceDefinitionId === where.serviceDefinitionId);
        const person = (row) => (where.employeeId === undefined || row.employeeId === where.employeeId) && (where.vendorId === undefined || row.vendorId === where.vendorId);
        const found = state.crew.find((row) => row.productionId === where.productionId && row.role === where.role && service(row) && person(row));
        return found ? { ...seatOut(found), serviceDefinition: { name: SERVICES[found.serviceDefinitionId] } } : null;
      },
      findMany: async ({ where }) => state.crew.filter((row) => row.productionId === where.productionId && row.role === where.role && (where.employeeId === undefined || row.employeeId === where.employeeId))
        .map((row) => ({ serviceDefinitionId: row.serviceDefinitionId, serviceDefinition: { name: SERVICES[row.serviceDefinitionId] } })),
      update: async ({ where, data }) => Object.assign(state.crew.find((row) => row.id === where.id), data),
      delete: async ({ where }) => { state.crew = state.crew.filter((row) => row.id !== where.id); },
      create: async ({ data }) => { const row = { id: `crew-new-${state.crew.length}`, ...data }; state.crew.push(row); return row; },
    },
    projectProductionServiceCrewCamera: { deleteMany: async ({ where }) => { state.cameraClears.push(where.crewId); return { count: 0 }; } },
    employee: {
      // Everybody here is in the Technical department, which is what lets them work a service
      // (`crew.isShooter`); it used to be a shooting skill on their profile.
      findMany: async ({ where, select }) => where.id.in.filter((id) => people[id]).map((id) => (select.departments ? { id, employeeName: people[id], departments: [{ department: { name: "Technical" } }] } : { id })),
    },
    vendor: { findMany: async ({ where }) => where.id.in.filter((id) => vendors[id]).map((id) => ({ id })) },
    projectProductionActivity: { create: async ({ data }) => { state.activities.push(data); return data; } },
  };
  return client;
}

const seat = (client, productionId, serviceDefinitionId) => {
  const row = client.state.crew.find((entry) => entry.productionId === productionId && entry.serviceDefinitionId === serviceDefinitionId);
  return row ? [row.employeeId || null, row.vendorId || null, row.vendorStatus || null] : null;
};
const deps = (client) => ({ client, statuses });

test("two services on one shoot swap their people, and the shoot logs it", async () => {
  const client = fake({
    productions: [production("p1", "s1", "2026-11-04", "09:00", "13:00")],
    crew: [{ productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 }, { productionId: "p1", serviceDefinitionId: "video", role: "LEAD", vendorId: 7, vendorStatus: "CONFIRMED" }],
    allocations: { s1: ["candid", "video"] },
  });
  await swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s1", serviceDefinitionId: "video" }, manager, deps(client));
  // A vendor moved within the shoot keeps the answer they gave for it, and takes no camera.
  assert.deepEqual(seat(client, "p1", "candid"), [null, 7, "CONFIRMED"]);
  assert.deepEqual(seat(client, "p1", "video"), [12, null, null]);
  assert.equal(client.state.cameraClears.length, 1);
  assert.equal(client.state.activities.length, 1);
  assert.match(client.state.activities[0].detail, /Ajeesh \(Candid Photo\) swapped with EXT-Venu Videos \(Traditional Video\)/);
});

test("across two shoots both are logged, and a person dropped on an empty service moves there", async () => {
  const client = fake({
    productions: [production("p1", "s1", "2026-11-04", "09:00", "13:00"), production("p2", "s2", "2026-11-05", "09:00", "13:00")],
    crew: [{ productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 }],
    allocations: { s1: ["candid"], s2: ["drone"] },
  });
  await swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, manager, deps(client));
  assert.equal(seat(client, "p1", "candid"), null);
  assert.deepEqual(seat(client, "p2", "drone"), [12, null, null]);
  assert.deepEqual(client.state.activities.map((row) => row.productionId), ["p1", "p2"]);
});

test("somebody already on another shoot at that time is refused, named with the shoot, project and service", async () => {
  const client = fake({
    productions: [
      production("p1", "s1", "2026-11-04", "09:00", "13:00"),
      production("p2", "s2", "2026-11-05", "09:00", "13:00"),
      production("p3", "s3", "2026-11-05", "11:00", "15:00"),
    ],
    crew: [{ productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 }, { productionId: "p3", serviceDefinitionId: "video", role: "LEAD", employeeId: 12 }],
    allocations: { s1: ["candid"], s2: ["drone"], s3: ["video"] },
  });
  await assert.rejects(
    swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, manager, deps(client)),
    (error) => error.status === 409 && /Ajeesh already has a shoot at that time: Shoot p3 \(SID-p3\) of Project p3, on Traditional Video/.test(error.message)
      && error.details.service === "Traditional Video" && error.details.project === "Project p3",
  );
  // Nothing moved.
  assert.deepEqual(seat(client, "p1", "candid"), [12, null, null]);
});

test("a clash on a shoot the caller cannot change is said without naming it", async () => {
  const client = fake({
    productions: [
      production("p1", "s1", "2026-11-04", "09:00", "13:00"),
      production("p2", "s2", "2026-11-05", "09:00", "13:00"),
      production("p3", "s3", "2026-11-05", "11:00", "15:00", { salesProject: { productionManagerEmployeeId: 77, eventId: "EVT-p3", whatsappGroupName: "Someone else's project" } }),
    ],
    crew: [{ productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 }, { productionId: "p3", serviceDefinitionId: "video", role: "LEAD", employeeId: 12 }],
    allocations: { s1: ["candid"], s2: ["drone"], s3: ["video"] },
  });
  await assert.rejects(
    swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, manager, deps(client)),
    (error) => error.status === 409 && /Ajeesh already has another shoot at that time/.test(error.message)
      && !/Someone else|SID-p3|Traditional Video/.test(error.message) && JSON.stringify(error.details) === JSON.stringify({ person: "Ajeesh" }),
  );
});

test("both shoots are locked before anything is read, always in the same order", async () => {
  const client = fake({
    productions: [production("p1", "s1", "2026-11-04", "09:00", "13:00"), production("p2", "s2", "2026-11-05", "09:00", "13:00")],
    crew: [{ productionId: "p2", serviceDefinitionId: "drone", role: "LEAD", employeeId: 12 }],
    allocations: { s1: ["candid"], s2: ["drone"] },
  });
  await swapSeats({ shootId: "s2", serviceDefinitionId: "drone" }, { shootId: "s1", serviceDefinitionId: "candid" }, manager, deps(client));
  assert.deepEqual(client.state.locks, ["s1", "s2"]);
});

test("the seat being left never counts against the person leaving it", () => {
  const window = { start: Date.UTC(2026, 10, 4, 9), end: Date.UTC(2026, 10, 4, 13) };
  const others = [{ id: "p1", shoot: { dateCreated: day("2026-11-04"), eventStartTime: "10:00", eventEndTime: "12:00" }, serviceCrew: [{ employeeId: 12, serviceDefinitionId: "candid", serviceDefinition: { name: "Candid Photo" } }], teamMembers: [] }];
  assert.equal(clash(12, window, others, { productionId: "p1", serviceDefinitionId: "candid" }), null);
  assert.equal(clash(12, window, others)?.service, "Candid Photo");
  // On the shoot's Assist instead, they are still there.
  others[0].teamMembers = [{ employeeId: 12 }];
  assert.equal(clash(12, window, others, { productionId: "p1", serviceDefinitionId: "candid" })?.service, "Assist");
});

test("both plans must be the caller's, and a submitted plan may be left with an empty service", async () => {
  const make = (overrides = {}) => fake({
    productions: [production("p1", "s1", "2026-11-04", "09:00", "13:00", overrides), production("p2", "s2", "2026-11-05", "09:00", "13:00")],
    crew: [{ productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 }],
    allocations: { s1: ["candid"], s2: ["drone"] },
  });
  await assert.rejects(swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, coordinator, deps(make())), (error) => error.status === 403);
  // Dropped on an empty service: the submitted plan it leaves is saved with that service empty.
  const submitted = make({ planSubmittedAt: new Date() });
  await swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, manager, deps(submitted));
  assert.equal(seat(submitted, "p1", "candid"), null);
  assert.deepEqual(seat(submitted, "p2", "drone"), [12, null, null]);
  await assert.rejects(swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s1", serviceDefinitionId: "candid" }, manager, deps(make())), (error) => error.status === 400);
});

test("somebody moved onto a shoot where they already work another service is refused", async () => {
  const client = fake({
    productions: [production("p1", "s1", "2026-11-04", "09:00", "13:00"), production("p2", "s2", "2026-11-05", "09:00", "13:00")],
    crew: [
      { productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 },
      { productionId: "p2", serviceDefinitionId: "video", role: "LEAD", employeeId: 12 },
      { productionId: "p2", serviceDefinitionId: "led", role: "LEAD", employeeId: 13 },
    ],
    allocations: { s1: ["candid"], s2: ["video", "led"] },
  });
  await assert.rejects(
    swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "led" }, manager, deps(client)),
    (error) => error.status === 400 && /Ajeesh is already on Traditional Video of that shoot/.test(error.message),
  );
  assert.deepEqual(seat(client, "p2", "led"), [13, null, null]);
});

test("a drone service is not held to one person, one service: moved onto one, or already on one", async () => {
  const make = () => fake({
    productions: [production("p1", "s1", "2026-11-04", "09:00", "13:00"), production("p2", "s2", "2026-11-05", "09:00", "13:00")],
    crew: [
      { productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", employeeId: 12 },
      { productionId: "p2", serviceDefinitionId: "video", role: "LEAD", employeeId: 12 },
      { productionId: "p2", serviceDefinitionId: "drone", role: "LEAD", employeeId: 13 },
      { productionId: "p2", serviceDefinitionId: "led", role: "LEAD", employeeId: 14 },
    ],
    allocations: { s1: ["candid"], s2: ["video", "drone", "led"] },
  });
  // Onto the drone, though on Traditional Video there too.
  const onto = make();
  await swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, manager, deps(onto));
  assert.deepEqual(seat(onto, "p2", "drone"), [12, null, null]);
  // Already flying the drone there, onto another of its services: still one non-drone service.
  const already = make();
  already.state.crew.find((row) => row.serviceDefinitionId === "video").serviceDefinitionId = "drone";
  already.state.crew = already.state.crew.filter((row) => !(row.serviceDefinitionId === "drone" && row.employeeId === 13));
  await swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "led" }, manager, deps(already));
  assert.deepEqual(seat(already, "p2", "led"), [12, null, null]);
});

test("a vendor moves onto a shoot where they already work another service, at a time they are out elsewhere", async () => {
  const client = fake({
    productions: [
      production("p1", "s1", "2026-11-04", "09:00", "13:00"),
      production("p2", "s2", "2026-11-05", "09:00", "13:00"),
      production("p3", "s3", "2026-11-05", "11:00", "15:00"),
    ],
    crew: [
      { productionId: "p1", serviceDefinitionId: "candid", role: "LEAD", vendorId: 7, vendorStatus: "CONFIRMED" },
      { productionId: "p2", serviceDefinitionId: "video", role: "LEAD", vendorId: 7, vendorStatus: "CONFIRMED" },
      { productionId: "p2", serviceDefinitionId: "drone", role: "LEAD", employeeId: 13 },
      { productionId: "p3", serviceDefinitionId: "video", role: "LEAD", vendorId: 7, vendorStatus: "CONFIRMED" },
    ],
    allocations: { s1: ["candid"], s2: ["video", "drone"], s3: ["video"] },
  });
  await swapSeats({ shootId: "s1", serviceDefinitionId: "candid" }, { shootId: "s2", serviceDefinitionId: "drone" }, manager, deps(client));
  assert.deepEqual(seat(client, "p2", "drone"), [null, 7, "WAITING"]);
  assert.deepEqual(seat(client, "p1", "candid"), [13, null, null]);
});
