const test = require("node:test");
const assert = require("node:assert/strict");
const { projectClientNames, clientNameOf } = require("../src/services/projectClientNames");

/*
 * Every staff screen names a project's client by its WhatsApp group name, in all three verticals.
 * It used to prefer the generator's Client Name, which only Qua Qua and Corp have, so one column read
 * "Kavya" on one row and the whole group name on the next.
 */
test("a project's client is its WhatsApp group name, whatever its vertical or the generator holds", async () => {
  const projects = [
    { vertical: "WED", whatsappGroupName: "WED 3t3 ERD Kavin & Thangamani | SM | Namakkal", whatsappGroupNameId: "g1" },
    { vertical: "QQ", whatsappGroupName: "QQ ERD Kavya | Birthday | Erode | 05-03-2026", whatsappGroupNameId: "g2" },
    { vertical: "CORP", whatsappGroupName: "CORP Adveka Hospitals Yedappadi", whatsappGroupNameId: null },
  ];
  const names = await projectClientNames(projects);
  assert.deepEqual(projects.map((project) => clientNameOf(project, names)), projects.map((project) => project.whatsappGroupName));
  assert.equal(clientNameOf(null, names), null);
});
