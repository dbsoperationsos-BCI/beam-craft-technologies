const test = require("node:test");
const assert = require("node:assert/strict");
// Stood in before the resolver is used: it asks which statuses count as working.
require("../src/services/employeeOptionLists").workingEmployeeStatuses = async () => ["Active"];
const { resolvePeople } = require("../src/services/importPeople");

/*
 * The people cells of a sheet import. Asha (id 1, E001) works here; Ravi (id 2, E009) has left;
 * "Sam" is the name of two employees, so it names neither.
 */
const asha = { id: 1, employeeName: "Asha" };
const ravi = { id: 2, employeeName: "Ravi" };
const refs = {
  employee: (text) => ({
    E001: { kind: "employee-id", target: asha },
    asha: { kind: "exact", target: asha },
    ashalogin: { kind: "username", target: asha },
    E009: { kind: "employee-id", target: ravi },
    sam: { kind: "ambiguous" },
    "former name": { kind: "former-name", target: asha },
  }[text] || { kind: "unmatched" }),
};
const transaction = { employee: { findMany: async ({ where }) => where.id.in.filter((id) => id === 1).map(() => ({ id: 1, employeeName: "Asha" })) } };

test("a code, a login or an exact name of a working employee links them under their own name", async () => {
  assert.deepEqual(await resolvePeople(transaction, refs, ["E001", "asha", "ashalogin"]), [
    { id: 1, name: "Asha" }, { id: 1, name: "Asha" }, { id: 1, name: "Asha" },
  ]);
});

test("somebody who has left, or no employee at all, is kept by name and linked to nobody", async () => {
  assert.deepEqual(await resolvePeople(transaction, refs, ["E009", "Sudeep"]), [
    // A leaver's code resolves to their own name, not to the code.
    { id: null, name: "Ravi" },
    { id: null, name: "Sudeep" },
  ]);
});

test("a name two people share, or a former name, is never linked to either", async () => {
  assert.deepEqual(await resolvePeople(transaction, refs, ["sam", "former name"]), [
    { id: null, name: "sam" }, { id: null, name: "former name" },
  ]);
});

test("a long name is cut to the column and no query is made when nobody can be linked", async () => {
  const [kept] = await resolvePeople({ employee: { findMany: async () => { throw new Error("should not be asked"); } } }, refs, ["x".repeat(300)]);
  assert.equal(kept.id, null);
  assert.equal(kept.name.length, 191);
});
