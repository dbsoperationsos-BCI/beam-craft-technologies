import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  activityActorLabel, activityDestinationLabel, activityFailureLabel, activityFiltersFromColumns, activityModeLabel, activityRecipientLabel, activitySenderLabel, activityStatusLabel, activitySubjectLabel, activitySummaryTiles, activityTriggerLabel,
  buildActivityQuery, dayStart, hasActivityFilters, humaniseKey, ACTIVITY_STATUSES, ACTIVITY_STATUS_COLORS, ACTIVITY_TRIGGER_LABELS, ACTIVITY_MODULE_LABELS,
} from "../src/lib/whatsappActivity.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("every status the backend writes has a label and a pill colour", () => {
  const backend = fs.readFileSync(new URL("../../backend/src/services/whatsappActivity.js", import.meta.url), "utf8");
  const match = /const STATUS = Object\.freeze\(\{([^}]+)\}\)/.exec(backend);
  const statuses = [...match[1].matchAll(/(\w+): "/g)].map((hit) => hit[1]);
  assert.deepEqual(Object.keys(ACTIVITY_STATUSES), statuses);
  assert.deepEqual(Object.keys(ACTIVITY_STATUS_COLORS), statuses);
  assert.notEqual(ACTIVITY_STATUS_COLORS.SENT, ACTIVITY_STATUS_COLORS.DELIVERED, "accepted and delivered read as two different things");
  assert.notEqual(ACTIVITY_STATUS_COLORS.FAILED, ACTIVITY_STATUS_COLORS.SENT);
  assert.equal(activityStatusLabel("PROCESSING"), "Sending");
  assert.equal(activityStatusLabel("SOMETHING"), "something");
});

test("the query carries only the filters that are set, widens a day range to whole days, and pages by offset", () => {
  assert.deepEqual(buildActivityQuery({}), {});
  assert.deepEqual(buildActivityQuery({ search: "  Ravi ", mode: "MANUAL", status: "", module: "HRM" }, { offset: 0, limit: 50 }), { search: "Ravi", mode: "MANUAL", module: "HRM", limit: "50" });
  const query = buildActivityQuery({ from: "2026-10-17", to: "2026-10-17" }, { offset: 100, limit: 50 });
  assert.equal(query.offset, "100");
  const from = new Date(query.from);
  const to = new Date(query.to);
  assert.equal(from.getTime(), dayStart("2026-10-17").getTime());
  assert.equal(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000 - 1, "the same day on both sides is that whole day");
  const sentOn = buildActivityQuery({ sentOn: "2026-10-17" });
  assert.equal(new Date(sentOn.sentTo).getTime() - new Date(sentOn.sentFrom).getTime(), 24 * 60 * 60 * 1000 - 1, "a day in the Sent At box is that whole day, against sentAt");
  assert.equal(sentOn.from, undefined, "and not the row's creation day");
  assert.deepEqual(buildActivityQuery({ sender: " Priya " }), { sender: "Priya" });
  assert.deepEqual(activityFiltersFromColumns({ trigger: ["ONBOARDING_INVITE", "CRD_DOCUMENT_LINK"], actor: ["Priya", "System"], sentAt: "2026-10-17", recipient: ["Kavya"], status: [] }), { trigger: "ONBOARDING_INVITE,CRD_DOCUMENT_LINK", module: "", recipient: "Kavya", mode: "", sender: "Priya,System", status: "", sentOn: "2026-10-17" }, "each multi-select box maps to one comma-joined parameter by its column id");
  assert.equal(dayStart("17/10/2026"), null);
  assert.equal(buildActivityQuery({ from: "nonsense" }).from, undefined);
});

test("hasActivityFilters decides between 'nothing yet' and 'nothing matches'", () => {
  assert.equal(hasActivityFilters({}), false);
  assert.equal(hasActivityFilters({ search: "   " }), false);
  assert.equal(hasActivityFilters({ status: "FAILED" }), true);
});

test("every trigger and module the backend writes has a label here, so the table never shows a key", () => {
  const backend = fs.readFileSync(new URL("../../backend/src/services/whatsappActivity.js", import.meta.url), "utf8");
  const triggers = [...backend.matchAll(/^  ([A-Z_]+): \{ module: "([A-Z_]+)"/gm)];
  assert.ok(triggers.length >= 19);
  for (const [, trigger, module] of triggers) {
    assert.ok(ACTIVITY_TRIGGER_LABELS[trigger], `${trigger} has a label`);
    assert.ok(ACTIVITY_MODULE_LABELS[module], `${module} has a label`);
  }
  assert.equal(activityTriggerLabel("ONBOARDING_INVITE", { ONBOARDING_INVITE: "Served label" }), "Served label");
  assert.equal(activityTriggerLabel("SOMETHING_NEW"), "Something new");
  assert.equal(humaniseKey(""), "");
});

test("the table's words: recipient, subject and actor read from what the row carries", () => {
  assert.equal(activityRecipientLabel({ recipientKind: "PERSON", recipientName: "Kavya", recipientMasked: "+91••••••3210" }), "Kavya · +91••••••3210");
  assert.equal(activityRecipientLabel({ recipientKind: "LEAD", recipientMasked: "+91••••••3210", crmLead: { name: "Arun" } }), "Arun · +91••••••3210");
  assert.equal(activityRecipientLabel({ recipientKind: "GROUP", recipientName: "Arun & Meera", recipientMasked: "WhatsApp group" }), "Arun & Meera (group)");
  assert.equal(activityRecipientLabel({ recipientKind: "GROUP", recipientMasked: "WhatsApp group" }), "WhatsApp group");
  assert.equal(activitySubjectLabel({ salesProject: { whatsappGroupName: "Arun & Meera", eventId: "DBS-0001" } }), "Arun & Meera · DBS-0001");
  assert.equal(activitySubjectLabel({ imageSelectionProject: { projectName: "Reception gallery" } }), "Reception gallery");
  assert.equal(activitySubjectLabel({ employee: { employeeName: "Kavya" } }), "Kavya");
  assert.equal(activitySubjectLabel({}), "");
  assert.equal(activityActorLabel({ mode: "AUTOMATIC" }), "System", "an automatic send is the system's");
  assert.equal(activityActorLabel({ mode: "MANUAL", initiatedByUser: { name: "Priya" } }), "Priya", "a manual send names the login that pressed Send");
  assert.equal(activityActorLabel({ mode: "MANUAL" }), "Unknown", "never a guess");
  assert.equal(activityModeLabel({ mode: "MANUAL" }), "Manual");
  assert.equal(activityModeLabel({ mode: "AUTOMATIC" }), "Automatic");
  assert.equal(activityModeLabel({}), "Unknown");
  assert.equal(activityDestinationLabel({ recipientKind: "PERSON", recipientMasked: "+91••••••3210" }), "+91••••••3210");
  assert.equal(activityDestinationLabel({ recipientKind: "LEAD", recipientMasked: "+91••••••3210" }), "+91••••••3210 (lead's WhatsApp)");
  assert.equal(activityDestinationLabel({ recipientKind: "GROUP", recipientName: "Arun & Meera" }), "WhatsApp group · Arun & Meera");
  assert.equal(activityDestinationLabel({ recipientKind: "PERSON" }), "—", "nothing is invented");
  assert.equal(activitySenderLabel({ senderUser: { name: "Priya" } }), "Priya's WhatsApp");
  assert.equal(activitySenderLabel({ provider: "meta" }), "Studio number (Meta)");
  assert.equal(activityFailureLabel({ status: "FAILED" }), "Could not send. Open the message to see why.");
  assert.equal(activityFailureLabel({ status: "SENT" }), "");
});

test("the tiles are three - total, delivered, failed - from the live counts, and never NaN", () => {
  const tiles = activitySummaryTiles({ total: 12, sent: 2, delivered: 7, read: 3, pending: 1, failed: 2 });
  assert.deepEqual(tiles.map((tile) => [tile.key, tile.value]), [["total", 12], ["delivered", 7], ["failed", 2]]);
  assert.ok(tiles.every((tile) => tile.note === undefined), "a label and a number each, no line under them");
  assert.deepEqual(activitySummaryTiles(null).map((tile) => tile.value), [0, 0, 0]);
});

test("the panel composes the shared components and types no raw control of its own", () => {
  const panel = read("components/settings/WhatsAppActivityLogPanel.js");
  for (const name of ["DataTable", "DataTableShell", "StatTile", "ProgressChip", "Button"]) {
    assert.match(panel, new RegExp(`import ${name} from`), `${name} is imported`);
  }
  assert.doesNotMatch(panel, /<(button|input|select|table|textarea)\b/, "raw markup where a component exists");
  assert.match(panel, /infiniteScroll: \{ onEndReached/, "the server pages the history");
  assert.doesNotMatch(panel, /renderActions=|>View</, "no View button: the row itself opens the message");
  assert.doesNotMatch(panel, /useAutoRefresh|setInterval|REFRESH_MS/, "no timer or polling: Refresh is the only re-read after the first load");
  assert.doesNotMatch(panel, />Every WhatsApp message|Updated \$\{/, "no helper text and no Updated line drawn on the screen");
  assert.doesNotMatch(panel, /useAutoRefresh|setInterval/, "nothing re-reads on its own");
  assert.match(panel, /focusableRows/, "the row is reachable by Tab and opened by Enter");
  assert.doesNotMatch(panel, /SearchField|Dropdown|DateField|>Refresh</, "no search box, dropdowns or Refresh above the table: the table's own boxes filter it");
  assert.match(panel, /filtering: true, filters: columnFilters, onColumnFilters: setColumnFilters/, "the table's boxes are reported to the server, which re-reads");
  const filterKinds = [...panel.matchAll(/id: "(\w+)",[^\n]*?filter: "(\w+)"/g)].map((hit) => [hit[1], hit[2]]);
  assert.deepEqual(filterKinds, [["sentAt", "date"]], "only Sent At names a kind - a day; every other column is a multi-select fed by the server");
  assert.doesNotMatch(panel, /filterOptions|ACTIVITY_MODES|ACTIVITY_STATUSES/, "no catalogue list is offered: a box shows only the values the log holds");
  assert.match(panel, /filterValues, infiniteScroll/, "the boxes' values come from the server");
  assert.match(panel, /getWhatsAppActivityFacets\(facet\)/, "asked when a box opens");
  for (const id of ["trigger", "module", "recipient", "mode", "actor", "status", "sentAt"]) {
    assert.match(panel, new RegExp(`id: "${id}",[^\\n]*?(accessorKey|value): `), `${id} has an accessor, without which the table draws no filter box for it`);
  }
  assert.match(panel, /aria-label="Message counts"[^>]*grid-cols-1 gap-2 sm:grid-cols-3/, "three equal tiles in one row");
  const headers = [...panel.matchAll(/header: "([^"]*)"/g)].map((hit) => hit[1]).filter(Boolean);
  assert.deepEqual(headers, ["Action", "Module", "To", "Sent", "Sent By", "Status", "Sent At"], "the columns, in the order the studio asked for - Status stays, it is the main thing");
  assert.match(panel, /accessorKey: "sentAt"/, "Sent At is the moment WhatsApp accepted the message, not when the row was created");
  const widths = [...panel.matchAll(/header: "([^"]+)", width: (\d+), minWidth: (\d+)/g)].map((hit) => [hit[1], Number(hit[2]), Number(hit[3])]);
  assert.equal(widths.length, 7, "every column declares a floor as well as a width");
  for (const [name, width, minWidth] of widths) assert.ok(minWidth <= width, `${name}'s floor is at most its width`);
  assert.match(panel, /header: "Sent At", width: 190, minWidth: 190/, "the timestamp column cannot be squeezed under the ⋮ column");
  const table = read("components/data-table/DataTable.js");
  assert.match(table, /focusableRows = false/, "opt-in on the shared table, so other tables are unchanged");
  assert.match(table, /event\.key !== "Enter" && event\.key !== " "/, "Enter and Space open the row");
  assert.doesNotMatch(panel, /By a person|By the app|By anyone/, "the sender is named, never described generically");
  const dialog = read("components/settings/WhatsAppActivityDetailDialog.js");
  assert.match(dialog, /useSubmitOnce/, "Resend cannot be double-pressed");
  assert.doesNotMatch(dialog, /providerMessageId|errorCode|templateKey/, "internal ids and codes stay out of the dialog");
  assert.match(dialog, />Message Details<[\s\S]*>Message Template</, "two sections, in that order");
  assert.doesNotMatch(dialog, /SimpleTable|ACTIVITY_ATTEMPT_KINDS|aria-label="Every try"|description=/, "no tries table, no helper text, no subtitle");
  const labels = [...dialog.matchAll(/^\s*\["([^"]+)", /gm)].map((hit) => hit[1]);
  assert.deepEqual(labels, ["Action", "Module", "To", "Sent", "Sent To", "Sent At", "Status"], "exactly the seven details, in order");
  assert.match(dialog, /activity\.sentAt \? formatDateTime\(activity\.sentAt\) : "—"/, "Sent At is the accepted-at time, a dash otherwise");
  const overlay = read("components/settings/SettingsOverlay.js");
  assert.match(overlay, /useModuleAccess\("SETTINGS", "WhatsApp Activity Log"\)/);
  assert.match(overlay, /id: "whatsapp-activity-log"/);
});
