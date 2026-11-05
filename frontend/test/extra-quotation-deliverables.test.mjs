import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { OTHER_SERVICE, serviceAndDeliverableOptions } from "../src/lib/extraQuotationOptions.mjs";

/*
 * Raise an Extra Quotation → Service / Deliverable: every active service and every active
 * deliverable from Project Settings, each under its own heading, and Others last.
 */

test("services, then deliverables, each under its heading, and Others last", () => {
  const options = serviceAndDeliverableOptions(["360 Video Booth", "Candid Photography"], ["Album 01", "3 Sheet Calendar"]);
  assert.deepEqual(options, [
    { heading: "Services" },
    { value: "360 Video Booth", label: "360 Video Booth" },
    { value: "Candid Photography", label: "Candid Photography" },
    { separator: true },
    { heading: "Deliverables" },
    { value: "Album 01", label: "Album 01" },
    { value: "3 Sheet Calendar", label: "3 Sheet Calendar" },
    { separator: true },
    { value: OTHER_SERVICE, label: "Others" },
  ]);
});

test("a name on both lists is offered once; an empty list leaves no empty heading", () => {
  const options = serviceAndDeliverableOptions(["Drone"], ["Drone", "Frame"]);
  assert.equal(options.filter((option) => option.value === "Drone").length, 1);
  assert.deepEqual(serviceAndDeliverableOptions([], ["Frame"]).map((option) => option.heading || option.value || "-"), ["-", "Deliverables", "Frame", "-", OTHER_SERVICE]);
  assert.deepEqual(serviceAndDeliverableOptions([], []), [{ value: OTHER_SERVICE, label: "Others" }]);
});

test("the form and the server offer and accept both", () => {
  const form = fs.readFileSync(new URL("../src/components/project-management/ExtraQuotationFormPanel.js", import.meta.url), "utf8");
  assert.match(form, /label: "Service \/ Deliverable"/);
  assert.match(form, /services: serviceAndDeliverableOptions\(options\.services, options\.deliverables\)/);
  // Editing an extra whose name is on neither list reopens it as Others, typed.
  assert.match(form, /!\[\.\.\.\(data\.services \|\| \[\]\), \.\.\.\(data\.deliverables \|\| \[\]\)\]\.includes\(storedService\)/);
  const server = fs.readFileSync(new URL("../../backend/src/modules/sales/extra-quotations/controller.js", import.meta.url), "utf8");
  assert.match(server, /prisma\.projectDeliverableDefinition\.findMany\(\{ where: \{ isActive: true \}, orderBy: DEFINITION_ORDER, select: \{ name: true \} \}\)/);
  assert.match(server, /deliverables: deliverables\.map\(\(deliverable\) => deliverable\.name\)/);
});
