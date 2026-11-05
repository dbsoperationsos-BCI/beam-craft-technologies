import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_TABS, PRODUCTS, inTab, clientRow } from "../src/constants/subscriptionProducts.mjs";

test("the tabs, in order", () => {
  assert.deepEqual(CLIENT_TABS, ["All", "Form Pending", "Submitted", "Active", "Update Pending", "Expired", "Link Expired/Cancelled"]);
  assert.deepEqual(PRODUCTS, { MEDIA_STUDIO_OPERATIONS: "Media Studio Operations", ACCOUNT_MANAGER: "Account Manager" });
});

test("each row sits in All and in exactly one other tab", () => {
  const rows = {
    "Form Pending": { state: "Pending" },
    Submitted: { state: "Submitted", client: { subscription: null } },
    Active: { state: "Submitted", client: { subscription: "Active" } },
    "Update Pending": { state: "Submitted", client: { subscription: "Active", pendingChanges: { usersAllowed: 8 } } },
    Expired: { state: "Submitted", client: { subscription: "Expired" } },
    "Link Expired/Cancelled": { state: "Expired" },
  };
  for (const [tab, invite] of Object.entries(rows)) {
    const row = clientRow({ id: tab, ...invite });
    assert.deepEqual(CLIENT_TABS.filter((name) => inTab(row, name)), ["All", tab], tab);
  }
  const cancelled = clientRow({ id: "x", state: "Cancelled" });
  assert.deepEqual(CLIENT_TABS.filter((name) => inTab(cancelled, name)), ["All", "Link Expired/Cancelled"]);
});

test("a submitted invite reads as its company; a pending one as its contact", () => {
  const submitted = clientRow({ id: "i1", state: "Submitted", contactName: "Arun", contactEmail: "a@x.in", contactPhone: "+91 98765 43210", client: { companyName: "Velava Agencies", mainContactName: "Arun", mainContactPhone: "+91 98765 43210", usersNeeded: 10, gstNumber: "33ABCDE1234F1Z5" } });
  assert.equal(submitted.companyName, "Velava Agencies");
  assert.equal(submitted.usersNeeded, 10);
  assert.equal(submitted.status, "Submitted");
  const pending = clientRow({ id: "i2", state: "Pending", contactName: "Priya", contactEmail: "p@x.in", contactPhone: "9876500000", client: null });
  assert.equal(pending.companyName, "");
  assert.equal(pending.mainContactName, "Priya");
  assert.equal(pending.mainContactPhone, "9876500000");
  assert.equal(pending.status, "Form Pending");
});

test("the table's columns are the onboarding form's fields, in its order, and nothing else", async () => {
  const { clientTableFieldsFor, clientInfoSections } = await import("../src/constants/subscriptionProducts.mjs");
  const FORM = ["companyName", "address", "mainContactName", "mainContactPhone", "mainContactDesignation", "secondaryContactName", "secondaryContactPhone", "secondaryContactDesignation", "gstNumber", "panNumber", "logoUrl", "faviconUrl", "usersNeeded"];
  // Client Details: the company, where it stands, then the rest of the form.
  assert.deepEqual(clientTableFieldsFor(null).map(([key]) => key), [FORM[0], "status", ...FORM.slice(1)]);
  assert.equal(clientTableFieldsFor(null)[1][2], "status");
  // A product's own page under SUBSCRIBE is a short list: the company and its contact number.
  for (const product of ["ACCOUNT_MANAGER", "MEDIA_STUDIO_OPERATIONS"]) {
    assert.deepEqual(clientTableFieldsFor(product).map(([key, label]) => [key, label]), [["companyName", "Company Name"], ["status", "Status"], ["mainContactPhone", "Contact Number"], ["versionLabel", "Version"], ["healthStatus", "Health"], ["responseLabel", "Response"], ["lastCheckedLabel", "Last Checked"], ["uptimeLabel", "Uptime (24h)"]]);
  }
  // The details panel: the form's fields, then the account Beam Craft set up.
  const HEALTH = ["healthStatus", "responseLabel", "lastCheckedLabel", "uptimeLabel", "siteVersion", "healthError"];
  const SUBSCRIPTION = ["subdomain", "usersAllowed", "adminUsername", "validFrom", "validUntil", "modulesSummary"];
  assert.deepEqual(clientInfoSections.flatMap((section) => section.fields.map(([key]) => key)).sort(), [...FORM, ...SUBSCRIPTION, ...HEALTH].sort());
});

test("a pending invite already shows the company the team entered", () => {
  const row = clientRow({ id: "i3", state: "Pending", contactName: "Arun", contactPhone: "9876500000", client: null, company: { companyName: "Velava Agencies", usersNeeded: 10, mainContactName: "Arun K", gstNumber: "33ABCDE1234F1Z5" } });
  assert.equal(row.companyName, "Velava Agencies");
  assert.equal(row.usersNeeded, 10);
  assert.equal(row.mainContactName, "Arun K");
  assert.equal(row.status, "Form Pending");
});

test("saved modules read as screens: old whole-module picks open with every screen ticked", async () => {
  const { screensFrom, modulesSummary } = await import("../src/constants/subscriptionProducts.mjs");
  assert.deepEqual(screensFrom("MEDIA_STUDIO_OPERATIONS", ["accounts", "hrm/interview"]), ["hrm/interview", "accounts/accounts-manager", "accounts/payment-requests"]);
  assert.deepEqual(screensFrom("MEDIA_STUDIO_OPERATIONS", ["nope", "hrm/nope"]), []);
  assert.equal(modulesSummary("MEDIA_STUDIO_OPERATIONS", ["hrm/interview", "hrm/tasks", "visual-curation/ai-feature"]), "Human Resource Management (HRM): Tasks, Interview · Visual Curation: AI Feature");
  assert.equal(modulesSummary("ACCOUNT_MANAGER", []), "");
  // Account Manager clients saved before the full list: their Users screen is HRM's User Management.
  assert.deepEqual(screensFrom("ACCOUNT_MANAGER", ["user-management/users", "accounts/accounts-manager"]), ["hrm/employee-repository", "accounts/accounts-manager"]);
});

test("the version live on the client's site reads as v1, v2, ...; nothing before setup", () => {
  assert.equal(clientRow({ id: "a", state: "Submitted", client: { liveVersion: 2 } }).versionLabel, "v2");
  assert.equal(clientRow({ id: "b", state: "Submitted", client: { liveVersion: 0 } }).versionLabel, "");
});

test("a product's live page: live clients only, tabs All / Active / Expired, a pending change still reads Active", async () => {
  const { LIVE_TABS, liveRow } = await import("../src/constants/subscriptionProducts.mjs");
  assert.deepEqual(LIVE_TABS, ["All", "Active", "Expired"]);
  const pending = liveRow(clientRow({ id: "p", state: "Submitted", client: { activatedAt: "x", subscription: "Active", pendingChanges: { usersAllowed: 8 } } }));
  assert.equal(pending.tab, "Active");
  assert.equal(pending.status, "Active");
  assert.equal(liveRow(clientRow({ id: "e", state: "Submitted", client: { activatedAt: "x", subscription: "Expired" } })).tab, "Expired");
  assert.equal(liveRow(clientRow({ id: "s", state: "Submitted", client: { subscription: null } })), null);
  assert.equal(liveRow(clientRow({ id: "f", state: "Pending" })), null);
});

test("a live site's health reads plainly: Up / Down / Not checked yet, its speed, when, and its uptime", () => {
  const up = clientRow({ id: "u", state: "Submitted", client: { liveVersion: 1, health: { status: "Up", responseMs: 230, lastCheckedAt: "2026-11-04T14:05:00Z", uptime24h: 99.8, siteVersion: "1.4.2" } } });
  assert.equal(up.healthStatus, "Up");
  assert.equal(up.responseLabel, "230 ms");
  assert.equal(up.uptimeLabel, "99.8%");
  assert.equal(up.siteVersion, "1.4.2");
  assert.match(up.lastCheckedLabel, /4 Nov/);
  const never = clientRow({ id: "n", state: "Submitted", client: { liveVersion: 1 } });
  assert.equal(never.healthStatus, "Not checked yet");
  assert.equal(never.responseLabel, "");
  assert.equal(never.uptimeLabel, "");
});

test("a term's last day: a year from 4 Nov ends 3 Nov; no start date means no end date (never a crash)", async () => {
  const { termEnd } = await import("../src/constants/subscriptionProducts.mjs");
  assert.equal(termEnd("2026-11-04", 12), "2027-11-03");
  assert.equal(termEnd("2026-11-04", 6), "2027-05-03");
  assert.equal(termEnd("", 12), "");
  assert.equal(termEnd("not a date", 12), "");
});
