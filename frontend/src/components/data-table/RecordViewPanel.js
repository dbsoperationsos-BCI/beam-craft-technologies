"use client";

import { useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import Tabs from "@/components/ui/Tabs";
import RecordDetails, { sectionsWithContent } from "./RecordDetails";

/**
 * One record, read back in full, opened by double-clicking its row.
 *
 * Every table in the OS answers a double-click the same way: it shows the record, it never opens it
 * for editing. A double-click is too easy to trigger by accident — a slow second click on a row you
 * only meant to select — for it to be the gesture that puts a live form on screen. Editing is asked
 * for by name, from the row's ⋮ menu, which is also where the rules about who may edit what already
 * live.
 *
 * It draws the same `entity` and `sections` the module's info panel is given, so a field added to
 * one appears in the other without this file learning about the module. The difference is room: the
 * panel is a 20rem column and shows every field, dash and all, because it is read by scanning to a
 * known position; this is the full width of the screen and read once, top to bottom, so a field the
 * record has nothing to say for is dropped rather than shown as an empty line. That is `hideEmpty`,
 * and `sectionsWithContent` asks the same question of the rail, so it cannot list a section that
 * turns out to be empty.
 *
 * `extraTabs` is for a part of the record that is not a field of the row in hand — a project's
 * payments, read from Accounts. Each is `{ id, label, render }` and becomes a tab of its own beside
 * **Details**, which holds everything drawn from the row. A tab rather than one more entry on the
 * rail: the rail answers "where in this record", and something fetched from another module is not a
 * place within the record, it is a second thing to read about the same one. With none given the
 * panel has no tab bar at all and reads exactly as it always has.
 */
const DETAILS_TAB = "details";

// `detailsLabel` names the first tab where a module calls its record something else (Projects: Identification).
export default function RecordViewPanel({ title, titleAddon, description, entity, sections = [], extraTabs = [], detailsLabel = "Details", formatters, onClose, hideEmpty = true, sidebarAriaLabel = "Record sections", zIndexClassName, aside, asideAriaLabel, footer, initialTab }) {
  // `initialTab` opens the panel on one of its extra tabs (a row menu's "View activity"); an id the
  // record does not have falls back to the details below, like any other stale tab.
  const [activeTab, setActiveTab] = useState(initialTab || DETAILS_TAB);

  const detailSections = useMemo(() => sectionsWithContent(entity, sections, hideEmpty).map((section) => ({
    id: section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "section",
    title: section.title,
    // A locked section (`RecordDetails`) is listed in the rail, shut, with its reason, and not drawn.
    disabled: section.locked || false,
    render: () => <RecordDetails entity={entity} sections={[section]} formatters={formatters} variant="rows" hideEmpty={hideEmpty} />,
  })), [entity, formatters, hideEmpty, sections]);

  // The open tab is looked up rather than trusted. The panel stays mounted as the row behind it
  // changes, so a tab left open on one record can name something the next record does not have —
  // and a record with no extra tabs must fall back to its details rather than to a blank pane.
  const openExtra = extraTabs.find((tab) => tab.id === activeTab) || null;
  const tabItems = extraTabs.length
    ? [{ id: DETAILS_TAB, label: detailsLabel }, ...extraTabs.map((tab) => ({ id: tab.id, label: tab.label }))]
    : null;

  if (!entity) return null;

  return <SchemaFormPanel
    title={title}
    titleAddon={titleAddon}
    description={description}
    /*
     * Left to the panel's own default in the ordinary case: a record opened from a table is the only
     * thing on screen and has nothing to stack against.
     *
     * It is named where a record is opened from *inside* something else - CRM's Converted History
     * sits in the lead popup, which is itself a higher layer - because a record view that lands
     * underneath the thing that opened it is a click that appears to do nothing at all.
     */
    zIndexClassName={zIndexClassName}
    // What belongs to the whole record rather than to this view of it, beside the body — see
    // `SchemaFormPanel`'s `aside`.
    aside={aside}
    asideAriaLabel={asideAriaLabel}
    tabs={tabItems && <Tabs
      tabs={tabItems}
      value={openExtra ? activeTab : DETAILS_TAB}
      onChange={setActiveTab}
      ariaLabel={`${title} sections`}
    />}
    // Details keeps the rail over its own sections; an extra tab is one thing to read, so it is
    // handed over as the body with no sections of its own for the rail to list.
    sections={openExtra ? [] : detailSections}
    values={entity}
    // The panel is the shell of a form being read back, not filled in: nothing here reports a
    // change, and a stray Enter must not act like a submit that was never offered.
    onChange={() => {}}
    onSubmit={(event) => event.preventDefault()}
    onClose={onClose}
    closeAriaLabel={`Close ${title}`}
    sidebarAriaLabel={sidebarAriaLabel}
    // A record with something to be decided passes its own verbs, the way a task's panel does; the
    // × still closes it. Everything else gets the one Close.
    footer={footer ?? <Button className="max-sm:w-full" type="button" variant="primary" onClick={onClose}>Close</Button>}
  >
    {/* Full width, unlike the record's own sections. Those are label-and-value pairs that get harder
        to read the wider the line, which is what the 1040px cap on a section is for. A tab is
        whatever it draws — Payments is three columns side by side — and capping it left the panel
        two thirds used with empty screen beside it. */}
    {openExtra ? <div className="w-full px-4 py-4 sm:px-6 sm:py-5">{openExtra.render()}</div> : null}
  </SchemaFormPanel>;
}
