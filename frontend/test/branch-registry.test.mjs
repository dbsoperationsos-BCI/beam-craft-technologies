import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { branchRegistryChanged, branchRegistryRevision, subscribeToBranchRegistry } from "../src/lib/branchRegistry.mjs";

/*
 * A branch added, renamed or disabled reaches every branch picker already on the screen.
 *
 * Settings is a portal overlay, so the screen the register is edited over stays mounted holding the
 * branch list it fetched when it opened. Nothing told it otherwise, so the CRM's Assigned Branch, a
 * quotation's Source Branch, an asset's Location and the rest went on offering the old list until
 * the page was reloaded.
 *
 * Two halves, and both have to hold: the register says when it has changed, and every picker
 * listens. The second half is the one that rots - a picker added later reads its branches, nobody
 * remembers this file exists, and it is stale from the day it ships - so the call sites are checked
 * against the source rather than trusted.
 */

test("the revision starts at nothing having changed", () => {
  // Load-bearing: a picker that already fetches on mount tells its first render from a refresh by
  // this being 0, and would otherwise fetch the same list twice every time it opened.
  assert.equal(typeof branchRegistryRevision(), "number");
});

test("a change is announced to every listener at once", () => {
  const heard = [];
  const stopFirst = subscribeToBranchRegistry(() => heard.push("first"));
  const stopSecond = subscribeToBranchRegistry(() => heard.push("second"));
  const before = branchRegistryRevision();

  branchRegistryChanged();

  assert.deepEqual(heard, ["first", "second"]);
  assert.equal(branchRegistryRevision(), before + 1, "the revision must move, or a dependency array sees no change");
  stopFirst();
  stopSecond();
});

test("a listener that has stopped hears nothing further", () => {
  let heard = 0;
  const stop = subscribeToBranchRegistry(() => { heard += 1; });
  branchRegistryChanged();
  stop();
  branchRegistryChanged();
  assert.equal(heard, 1, "an unmounted picker must not be told about a branch");
});

test("a listener may unsubscribe while it is being told", () => {
  // A React root unmounting inside a notification is an ordinary way for this to happen, and
  // walking the live set while it is edited silently skips whichever listener follows.
  const heard = [];
  let stopSecond = () => {};
  const stopFirst = subscribeToBranchRegistry(() => { heard.push("first"); stopSecond(); });
  stopSecond = subscribeToBranchRegistry(() => heard.push("second"));
  const stopThird = subscribeToBranchRegistry(() => heard.push("third"));

  branchRegistryChanged();

  assert.deepEqual(heard, ["first", "second", "third"]);
  stopFirst();
  stopThird();
});

test("every revision is a new one, so repeated saves each refresh the pickers", () => {
  const seen = new Set();
  for (let count = 0; count < 3; count += 1) {
    branchRegistryChanged();
    seen.add(branchRegistryRevision());
  }
  assert.equal(seen.size, 3, "two saves in a row must not read as the same revision");
});

/* ─────────────────────────── the wiring, read off the source ─────────────────────────── */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

test("the register announces a change after a save and after a disable, and only on success", () => {
  const panel = read("components", "settings", "BranchesPanel.js");
  assert.match(panel, /branchRegistryChanged/, "BranchesPanel no longer announces branch changes");
  assert.equal((panel.match(/branchRegistryChanged\(\)/g) || []).length, 2,
    "both writes - saving a branch and disabling or re-enabling one - must announce the change");
  /*
   * Inside the `try`, after the write has been awaited. Announced from a `catch` or a `finally` - a
   * `finally` is the easy mistake, sitting right there beside the `setSaving(false)` - a branch the
   * server refused would have every picker on the page fetch the list it already holds.
   */
  let from = 0;
  for (let found = panel.indexOf("branchRegistryChanged()", from); found !== -1; found = panel.indexOf("branchRegistryChanged()", from)) {
    const opensTry = panel.lastIndexOf("try {", found);
    assert.ok(opensTry > panel.lastIndexOf("} catch", found) && opensTry > panel.lastIndexOf("} finally", found),
      "the change must be announced from inside the try, so a write the server refused announces nothing");
    from = found + 1;
  }
});

test("every screen that reads the branch list subscribes to the register", () => {
  /*
   * The branch-reading call sites, each with the file that holds it. Adding a picker means adding
   * it here, which is the point: this test is the reminder that a new one has to subscribe.
   */
  const readers = [
    ["components/sales/useBranchOptions.js", "getCrmBranches"],
    ["components/admin/AdminPage.js", "getMasterData"],
    ["components/assets/AssetManagementPage.js", "getMasterData"],
    ["components/employees/useCredentialForm.js", "getMasterData"],
    ["components/sales/WhatsappGroupNameDialog.js", "getMasterData"],
    ["components/sales/SaleDetailsSection.js", "getSalesSourceBranches"],
    // Attendance office locations: the branch picker for the point a branch is measured from.
    ["components/hrm/EmployeeAttendancePage.js", "getMasterData"],
    // The studio-wide register's branch filter.
    ["components/hrm/AttendanceRegisterPage.js", "getMasterData"],
  ];
  for (const [file, call] of readers) {
    const source = read(...file.split("/"));
    assert.match(source, new RegExp(`${call}\\(`), `${file} no longer reads the branch list with ${call}()`);
    assert.match(source, /useBranchRegistry\(\)/, `${file} reads branches but does not subscribe to the register`);
    assert.match(source, /branchRegistryRevision\]/, `${file} subscribes but never re-reads on a change`);
  }
});

test("no branch reader is left out of that list", () => {
  // The other half of the test above: it proves the listed files subscribe, and this proves the
  // list is all of them, so a sixth picker cannot be added without one of the two failing.
  const roots = ["components", "lib", "services"];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), "src", dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.(js|mjs)$/.test(entry.name)) files.push(next);
    }
  };
  roots.forEach(walk);

  const known = new Set([
    "components/sales/useBranchOptions.js",
    "components/admin/AdminPage.js",
    "components/assets/AssetManagementPage.js",
    "components/employees/useCredentialForm.js",
    "components/sales/WhatsappGroupNameDialog.js",
    "components/sales/SaleDetailsSection.js",
    "components/hrm/EmployeeAttendancePage.js",
    "components/hrm/AttendanceRegisterPage.js",
    // The register itself, which re-reads its own list after writing and then announces it.
    "components/settings/BranchesPanel.js",
    // The service layer: where the calls are declared rather than made.
    "services/admin/branches.service.js",
    "services/sales/crm-leads.service.js",
    "services/hrm/master-data.service.js",
    "services/sales/projects.service.js",
    // Names the branch call only to say it does not carry one of its own.
    "services/admin/admin.service.js",
  ]);

  const unlisted = files.filter((file) => {
    if (known.has(file)) return false;
    const source = fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");
    return /getMasterData\(\s*["']branches["']|getCrmBranches\(|getBranches\(|getSalesSourceBranches\(/.test(source);
  });
  assert.deepEqual(unlisted, [], "these files read the branch list but are not listed as subscribing to the register");
});
