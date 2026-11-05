import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";

/*
 * HRM → Payslip: the signed-in employee's own payslips, on the sidebar behind `HRM / My Payslip`.
 * The page is empty for now.
 */

test("HRM → Payslip keeps its route, off the sidebar", () => {
  const hrm = SIDEBAR_MODULES.find((group) => group.id === "hrm");
  const item = hrm.items.find((entry) => entry.id === "payslip");
  // Off the menu - a My Profile tab now - with its route kept.
  assert.deepEqual(item, { id: "payslip", label: "Payslip", href: "/hrm/payslip", activePath: "/hrm/payslip", hidden: true });
});

test("it answers to its own permission, not to Employee Management", () => {
  assert.deepEqual(permissionForRoute("/hrm/payslip"), { module: "HRM", feature: "My Payslip" });
});

test("the page lists the employee's own months, each with a Download", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "MyPayslipPage.js"), "utf8");
  const service = fs.readFileSync(path.join(process.cwd(), "src", "services", "hrm", "myPayslips.service.js"), "utf8");
  assert.match(page, /<ModulePageHeader title="Payslip" \/>/);
  assert.match(page, /setPayslips\(response\?\.data \|\| \[\]\);\s+setUpcoming\(response\?\.upcoming \|\| null\);/);
  // A table: the month, its pay cycle, what it pays, its status, when it was generated, and Download.
  for (const header of ["Month", "Pay Cycle", "Paid Days", "LOP Days", "Net Pay", "Status", "Generated On", "Payslip"]) assert.ok(page.includes(`header: "${header}"`), header);
  assert.match(page, /<DataTable\s+columns=\{columns\}\s+data=\{payslips\}/);
  assert.match(page, /onClick=\{\(\) => download\(row\.original\)\}>Download<\/Button>/);
  // The month being paid now, and the day its payslip is generated.
  assert.match(page, /will be generated on <span className="font-semibold">\{day\(upcoming\.generatesOn\)\}<\/span>/);
  // The server answers for this login alone - nothing in the request names whose.
  assert.match(service, /return downloadPdf\(`\$\{ROOT\}\/\$\{year\}\/\$\{month\}\/pdf`/);
  assert.doesNotMatch(service, /employeeId/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src", "app", "(app)", "hrm", "payslip", "page.js"), "utf8"), /return <MyPayslipPage \/>;/);
});

test("My Profile shows Payslip next to My Details, to whoever holds HRM / My Payslip, with Change Password last", () => {
  const profile = fs.readFileSync(path.join(process.cwd(), "src", "components", "profile", "ProfilePage.js"), "utf8");
  assert.match(profile, /\{ id: "personal", label: "My Details" \},\s+\.\.\.\(hasPermission\("HRM", "My Payslip", "READ"\) \? \[\{ id: "payslip", label: "Payslip" \}\] : \[\]\),[\s\S]{0,300}\{ id: "org-chart", label: "Org Chart" \},\s+\{ id: "password", label: "Change Password" \},\s+\];/);
  assert.match(profile, /\{tab === "payslip" && hasPermission\("HRM", "My Payslip", "READ"\) && <MyPayslipList \/>\}/);
});
