const test = require("node:test");
const assert = require("node:assert/strict");
const { withHandedFrom, projectHandedFrom, productionHandedFrom, withProjectHandovers } = require("../src/services/handoverNames");

/*
 * "New (Old)": a role handed over at offboarding reads with the leaver's name beside the new
 * holder's, for as long as the new holder still has it.
 */

const client = ({ handovers = [], projects = [], productions = [], crew = [] }) => ({
  employeeHandover: { findMany: async ({ where }) => handovers.filter((row) => (where.projectId ? where.projectId.in.includes(row.projectId) : where.productionId.in.includes(row.productionId))) },
  salesProject: { findMany: async () => projects },
  projectProduction: { findMany: async () => productions },
  projectProductionServiceCrew: { findMany: async () => crew },
});
const ravi = { fromEmployee: { employeeName: "Ravi" } };

test("a name reads New (Old) only where something was handed over", () => {
  assert.equal(withHandedFrom("Asha", "Ravi"), "Asha (Ravi)");
  assert.equal(withHandedFrom("Asha", undefined), "Asha");
  assert.equal(withHandedFrom(null, "Ravi"), null);
});

test("a project role shows its leaver while the person it was handed to still holds it", async () => {
  const fake = client({
    handovers: [
      { projectId: "p1", role: "projectManagerEmployeeId", toEmployeeId: 9, ...ravi },
      { projectId: "p1", role: "creativeManagerEmployeeId", toEmployeeId: 9, ...ravi },
    ],
    // Project Manager still Asha (9); Creative Manager since changed by hand to somebody else (12).
    projects: [{ id: "p1", projectManagerEmployeeId: 9, creativeManagerEmployeeId: 12 }],
  });
  assert.deepEqual((await projectHandedFrom(["p1"], fake)).get("p1"), { projectManager: "Ravi" });
  const [row] = await withProjectHandovers([{ id: "p1", projectManager: "Asha", creativeManager: "Kiran" }], (entry) => entry.id, fake);
  assert.deepEqual([row.projectManager, row.creativeManager], ["Asha (Ravi)", "Kiran"]);
});

test("a shoot's coordinator and crew places show their leaver while still the new holder's", async () => {
  const fake = client({
    handovers: [
      { productionId: "s1", role: "productionCoordinatorEmployeeId", toEmployeeId: 9, crewId: null, ...ravi },
      { productionId: "s1", role: "crew", crewId: "c1", toEmployeeId: 9, ...ravi },
      { productionId: "s1", role: "crew", crewId: "c2", toEmployeeId: 9, ...ravi },
    ],
    productions: [{ id: "s1", productionCoordinatorEmployeeId: 9 }],
    crew: [{ id: "c1", employeeId: 9 }, { id: "c2", employeeId: 15 }],
  });
  const handed = (await productionHandedFrom(["s1"], fake)).get("s1");
  assert.equal(handed.coordinator, "Ravi");
  assert.equal(handed.crew.get("c1"), "Ravi");
  assert.equal(handed.crew.has("c2"), false, "a crew place changed by hand since");
});
