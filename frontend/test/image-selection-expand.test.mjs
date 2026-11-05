import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Expand: the Projects sidebar's filter menu opens the reader's own dashboard - the same cards and
 * table - in a popup over the Projects page. The cards count the enabled projects; the table lists
 * every project with Activity (Enabled / Disabled) and a ⋮ to change it.
 */

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("Expand sits first in the sidebar's filter menu, above a rule, with the status filters unchanged beneath it", () => {
  const sidebar = read("components/image-selection/ProjectSidebar.js");
  const expand = sidebar.indexOf(">Expand</span>");
  const separator = sidebar.indexOf('role="separator"', expand);
  const all = sidebar.indexOf(">All</button>");
  assert.ok(expand > 0 && separator > expand && all > separator, "Expand, then the rule, then All");
  assert.match(sidebar, /\["notStarted", "Yet to Start"\],\s*\["inProgress", "In Progress"\],\s*\["partiallyCompleted", "Partially Completed"\],\s*\["completed", "Completed"\],/);
  assert.match(sidebar, /onClick=\{\(\) => \{ setOpenMenu\(null\); onOpenExpand\(\); \}\}/, "opens the popup and leaves the status filter where it was");
  assert.doesNotMatch(sidebar, /Short List/);
});

test("the popup opens over the Projects page and closing it leaves the open project, filters and search as they were", () => {
  const page = read("app/(app)/image-selection/projects/page.js");
  assert.match(page, /onOpenExpand=\{\(\) => setExpandOpen\(true\)\}/);
  assert.match(page, /\{expandOpen && <ExpandDialog onClose=\{\(\) => setExpandOpen\(false\)\} onOpenProject=\{openExpandProject\} canWrite=\{canWrite\} onProjectChanged=\{expandChanged\} \/>\}/);
  const dialog = read("components/image-selection/dashboard/ExpandDialog.js");
  assert.match(dialog, /title="Expand"/);
  assert.match(dialog, /description="Every Image Selection project\. Disabling a project pauses its client link and stops uploads and link sending until it is enabled again; its photos and selections are kept\."/);
  assert.match(dialog, /headerActions=\{<div className="flex shrink-0 items-center gap-1"><div className="w-32"><Dropdown ariaLabel="Date range"/, "the period selector in the header");
  assert.match(dialog, /useImageSelectionDashboard\(\{ expand: true/);
  // The summary cards are drawn in one grid with Enabled and Disabled (`ExpandCards`).
  assert.match(dialog, /<ExpandCards /);
  assert.match(dialog, /<DashboardRecentProjects /);
  assert.doesNotMatch(dialog, /SelectionProgressCard|StorageCard/, "only the cards and the projects table");
});

test("a pressed card narrows the table to the enabled projects it counted", () => {
  const dialog = read("components/image-selection/dashboard/ExpandDialog.js");
  // A summary card's view narrows to enabled projects first; the Enabled / Disabled cards' own
  // `{ expand }` view narrows in the table, so a disabled project can be shown.
  assert.match(dialog, /view && !view\.expand \? \(allRows \|\| \[\]\)\.filter\(\(row\) => row\.expandEnabled !== false\) : allRows \|\| \[\]/);
});

test("the Dashboard and Expand read the same request, Expand with expand=true", () => {
  const service = read("services/image-selection/image-selection.service.js");
  assert.match(service, /dashboardQuery\(\{ range, expand: expand \? "true" : undefined \}\)/);
  assert.match(service, /\/expand\/\$\{encodeURIComponent\(projectId\)\}`, \{ method: "PUT", body: JSON\.stringify\(\{ enabled \}\) \}/);
  assert.match(read("components/image-selection/dashboard/useImageSelectionDashboard.js"), /getImageSelectionDashboard\(\{ range, expand \}\)/);
  const page = read("components/image-selection/dashboard/ImageSelectionDashboardPage.js");
  assert.match(page, /useImageSelectionDashboard\(\{ onRefreshError: showError \}\)/);
  assert.doesNotMatch(page, /expand=\{/, "the Dashboard page's table has no Activity column or ⋮");
});

test("Activity follows Last Activity, then the ⋮ holding an Enabled switch", () => {
  const table = read("components/image-selection/dashboard/DashboardRecentProjects.js");
  const activity = table.indexOf('{ id: "activity", header: "Last Activity"');
  const expandActivity = table.indexOf('{ id: "expandActivity", header: "Activity"');
  const actions = table.indexOf("{ ...ACTIONS_COLUMN");
  assert.ok(activity > 0 && expandActivity > activity && actions > expandActivity);
  assert.match(table, /\{ label: "Enabled", switchOn: enabled, disabled: expand\.busyId !== null, onSelect: \(\) => expand\.toggle\(row\.original, !enabled\) \}/);
  assert.match(table, /const enabled = row\.original\.expandEnabled !== false;/, "on unless the server says it was turned off");
  const toggle = read("components/image-selection/dashboard/useExpandToggle.js");
  assert.match(toggle, /if \(pending\.current\) return;/, "a second press while one is on its way is ignored");
  assert.match(toggle, /expandEnabled: enabled/);
});

test("the row ⋮ and the header's Table Options open above the popup, not behind it", () => {
  assert.match(read("components/image-selection/dashboard/ExpandDialog.js"), /menuZIndexClassName=\{layers\.menuOverPanel\}/);
  const table = read("components/image-selection/dashboard/DashboardRecentProjects.js");
  assert.match(table, /<OptionsMenu ariaLabel=\{`Expand actions for \$\{row\.original\.projectName\}`\} \{\.\.\.\(menuZIndexClassName \? \{ menuZIndexClassName \} : \{\}\)\}/);
  assert.match(table, /ariaLabel=\{ariaLabel\}\n\s+menuZIndexClassName=\{menuZIndexClassName\}/, "the DataTable's own header menu gets the same layer");
});

test("a menu item can be an on/off switch", () => {
  const menu = read("components/ui/OptionsMenu.js");
  assert.match(menu, /const switchable = item\.switchOn !== undefined;/);
  assert.match(menu, /aria-checked=\{checkable \? Boolean\(switchable \? item\.switchOn : item\.selected\) : undefined\}/);
});

test("a disabled project stays in the sidebar and its search, marked Disabled", () => {
  const sidebar = read("components/image-selection/ProjectSidebar.js");
  assert.match(sidebar, /\{project\.disabledAt && <span [^>]*>.*Disabled<\/span>\}/);
  const visible = sidebar.match(/const visibleProjects = [^;]+;/)[0];
  assert.doesNotMatch(visible, /disabled/, "the list never drops a disabled project");
});

test("a disabled project's workspace holds back uploading, publishing and the client link, and says why", () => {
  const workspace = read("components/image-selection/ImageSelectionProjectWorkspace.js");
  assert.match(workspace, /const clientWrite = canWrite && !projectDisabled;/);
  assert.match(workspace, /This project is disabled\. Enable it from Expand to upload photos or send the client link\./);
  assert.match(workspace, /onUploadReady=\{refreshGallery\}\s+canWrite=\{clientWrite\}/, "no upload box");
  assert.match(workspace, /folder=\{path\[0\] \|\| null\}\s+canWrite=\{clientWrite\}/, "no Publish or new PIN");
  assert.match(workspace, /<WhatsAppTemplatePanel\s+project=\{project\}\s+canWrite=\{clientWrite\}/, "no send");
  assert.match(workspace, /projectDisabled=\{projectDisabled\}/);
  const settings = read("components/image-selection/ImageSelectionSettingsPanel.js");
  assert.match(settings, /const canEditSettings = moduleCanWrite && !projectDisabled;/);
});

test("the switch is offered only to Project Management Read / Write, and the page follows a change", () => {
  const dialog = read("components/image-selection/dashboard/ExpandDialog.js");
  assert.match(dialog, /\(\{ \.\.\.toggle, canToggle: canWrite \}\)/);
  assert.match(read("components/image-selection/dashboard/DashboardRecentProjects.js"), /expand\.canToggle === false \? \[\] :/);
  assert.match(read("app/(app)/image-selection/projects/page.js"), /disabledAt: enabled \? null : new Date\(\)\.toISOString\(\)/);
});
