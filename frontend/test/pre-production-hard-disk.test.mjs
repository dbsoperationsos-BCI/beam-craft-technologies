import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The project's hard disk, as the pre production coordinator tracks it on General.
 *
 * Three answers - Not Received, Received, Handed Over - where Client Storage runs on eight. Pre
 * production's part is the disk coming back and being handed on; handing it over is the one answer
 * that reaches Client Storage, where it starts the record off at Yet to Start. From there the disk
 * is Client Storage's, and a status corrected here never pulls it back.
 */
const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

test("the coordinator is offered three answers and no more, beside Storage Needed on General", async () => {
  const { HARD_DISK_STATUS_OPTIONS } = await import("../src/constants/formPanelConfig.js");
  assert.deepEqual(HARD_DISK_STATUS_OPTIONS.map((option) => option.label), ["Not Received", "Received", "Handed Over"]);
  const general = src("components", "project-management", "PreProductionGeneral.js");
  assert.match(general, /name: "hardDiskStatus",\n\s+label: "Hard Disk Status",/);
  // Asked only where the project said it needs storage, and saved with the project's own answers.
  assert.match(general, /when: \(values\) => values\.storageNeeded === "Yes",/);
  assert.match(general, /"storageNeeded", "hardDiskStatus", "crdDocumentStatus"/);
  // One answer for the project: the shoot's form does not ask it, and nothing counts it as planned.
  const { preProductionFormSectionsFor } = await import("../src/constants/formPanelConfig.js");
  assert.equal(preProductionFormSectionsFor("WED").flatMap((section) => section.fields).find((item) => item.name === "hardDiskStatus"), undefined);
});

test("handing a disk over starts its Client Storage record, and only from the beginning", () => {
  const controller = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "project-management", "pre-production", "controller.js"), "utf8");
  // Only a record still waiting to arrive is moved - one already backed up stays where it is.
  assert.match(controller, /where: \{ projectId, isDeleted: false, status: STORAGE_NOT_ARRIVED \}/);
  assert.match(controller, /data: \{ status: STORAGE_STARTED \}/);
  // In the same transaction as the answer: the disk is handed over and its record started, or neither.
  assert.match(controller, /if \(parsed\.data\.hardDiskStatus === HANDED_OVER\) await startStorageForHandover\(transaction, project\.id, req\.user\.id\);/);
  // And logged against the shoot, so the record still says who started it and when.
  assert.match(controller, /action: "STORAGE_STATUS_CHANGED",\n\s+detail: `Hard disk handed over/);
  // Nothing else here writes a storage status, so the other two answers are the coordinator's alone.
  assert.equal((controller.match(/clientStorage\.update\(/g) || []).length, 1);
});

test("General shows where the disk is and offers no move: this board runs no storage flow", () => {
  const general = src("components", "project-management", "PreProductionGeneral.js");
  // The buttons that walked a disk through Yet to Start, Hand In and the rest are gone, with the
  // hook that drew them: one status, set from the shoot, is all this board sets.
  assert.doesNotMatch(general, /useClientStorageMoves|movesFor|changePreProductionStorageStatus/);
  assert.match(general, /Each shoot&apos;s Hard Disk answer is on the shoot itself/);
  // And the route behind them is unmounted, so hiding the control is not the only protection.
  const routes = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "project-management", "pre-production", "routes.js"), "utf8");
  assert.doesNotMatch(routes, /storage\/:storageId\/status/);
  assert.match(routes, /router\.get\("\/projects\/:projectId\/storage\/:storageId"/, "reading it is still allowed");
  assert.doesNotMatch(src("services", "project-management", "pre-production.service.js"), /changePreProductionStorageStatus|getPreProductionStorageOptions/);
});

test("the General bar reads the disk's own status", () => {
  const general = src("components", "project-management", "PreProductionGeneral.js");
  assert.match(general, /\["Hard Disk", project\.storageNeeded === "Yes" \? hardDiskLabel\(project\.hardDiskStatus\) : project\.storageNeeded\]/);
});
