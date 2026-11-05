"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import OptionsMenu from "@/components/ui/OptionsMenu";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import useCompactView from "@/components/shared/useCompactView";
import { layers } from "@/constants/layers";
import ServiceDefinitionDialog from "./ServiceDefinitionDialog";
import { SHOOT_TYPE_OPTIONS } from "./definitionTimingFields";
import { kindLabel, pricingShapeFor } from "@/lib/deliverablePricing.mjs";
import { deliverableAnswerText } from "@/lib/deliverableAnswers.mjs";
import { takenDefinitionNameKeys } from "@/lib/projectDefinitionNames.mjs";
import DeliverableDefinitionDialog from "./DeliverableDefinitionDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import {
  createProjectDeliverableDefinition,
  createProjectOptionSetValue,
  createProjectServiceDefinition,
  getProjectDeliverableDefinitions,
  getProjectOptionSets,
  getProjectServiceDefinitions,
  updateProjectDeliverableDefinition,
  deleteProjectDeliverableDefinition,
  updateProjectOptionSetValue,
  deleteProjectOptionSetValue,
  updateProjectServiceDefinition,
  deleteProjectServiceDefinition,
} from "@/services/project-management/project-workflow.service";

const sections = [["services", "Services"], ["deliverables", "Deliverables"]];
/*
 * How a service may be booked.
 *
 * Half and Full Session are separate, because they are separate things to sell: a service offered
 * only as a full session could not say so while the two shared one tick box. Their values are the
 * option value codes in the Service Session Timing set, so the tick boxes here and the dropdown on a
 * shoot line up without anything in between translating.
 */
const serviceTimingOptions = [
  { label: "Not Available", value: "NONE" },
  { label: "Half Session", value: "HALF_SESSION" },
  { label: "Full Session", value: "FULL_SESSION" },
  { label: "Hours / Minutes", value: "HOURS_MINUTES" },
];
const booleanOptions = [{ label: "Yes", value: "true" }, { label: "No", value: "false" }];
/*
 * The same two answers, written as the words rather than as a boolean's `"true"` / `"false"`.
 *
 * A service's Remarks is still a boolean column and its dropdown still carries `booleanOptions`;
 * a deliverable's No. of Count and Image Selection are text, and hold the word that was chosen. The
 * two lists are kept apart because the value each writes has to match the column behind it.
 */
const yesNoOptions = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];

/**
 * Alphabetical, and only alphabetical.
 *
 * These three lists were ordered by a Sort Order typed against each row, with the name as the
 * tie-break. It was a number somebody had to keep in their head across forty services: adding one
 * between two others meant renumbering the rest, an unanswered box meant a row silently sorting to
 * the top, and nothing on screen explained why the list was in the order it was in. A studio
 * looking for "Candid Video" looks for it under C. The name is the order now, so a new row lands
 * where the reader will look for it and there is nothing to maintain.
 *
 * Case-insensitive, because "album designing" and "Album Designing" are the same word to whoever is
 * scanning the list, and a capital letter is not a reason to file one above the other.
 */
const byText = (key) => (a, b) => String(a?.[key] || "").localeCompare(String(b?.[key] || ""), undefined, { sensitivity: "base" });
const byName = byText("name");
const byLabel = byText("label");

/*
 * The name is typed, and nothing is offered while it is.
 *
 * Both rows used to be a combo box listing every service, or every deliverable, the studio already
 * had - so a name that existed was chosen rather than retyped into a second spelling. The list is
 * gone at the studio's request: the box asks for a name and takes whatever is written, and the
 * table below is where the existing ones are read.
 */
/*
 * Enter adds, the way it does on every other name-and-Add row (`MasterDataSettingsPanel`, the
 * option-list editor): the box is the whole form here, and reaching for the button after typing a
 * name is exactly the pause these rows exist to remove. Held to the button's own rule - a name,
 * and nothing already being added - so Enter can never do what the button would refuse. An Enter
 * that is finishing an IME composition belongs to the composition and is left alone.
 */
const addOnEnter = (allowed, onAdd) => (event) => {
  if (event.key !== "Enter" || !allowed || event.nativeEvent?.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  onAdd();
};

function AddServiceForm({ value, onChange, onAdd, saving }) {
  const named = value.trim();
  return <div className="mb-5 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
    <TextField
      label="Service Name"
      className="min-w-0 flex-1"
      value={value}
      maxLength={191}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Type a service name"
      disabled={saving}
      onKeyDown={addOnEnter(!saving && Boolean(named), onAdd)}
    />
    <Button type="button" variant="primary" disabled={saving || !named} onClick={() => onAdd()}>
      {saving ? "Adding..." : "Add"}
    </Button>
  </div>;
}

/** The Deliverables row: the same control as `AddServiceForm`, and typed for the same reason. */
function AddDeliverableForm({ value, onChange, onAdd, saving }) {
  const named = value.trim();
  return <div className="mb-5 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
    <TextField
      label="Deliverable Name"
      className="min-w-0 flex-1"
      value={value}
      maxLength={191}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Type a deliverable name"
      disabled={saving}
      onKeyDown={addOnEnter(!saving && Boolean(named), onAdd)}
    />
    <Button type="button" variant="primary" disabled={saving || !named} onClick={() => onAdd()}>
      {saving ? "Adding..." : "Add"}
    </Button>
  </div>;
}

/**
 * A Project Settings table, drawn by the component every other module's table uses.
 *
 * It used to be a hand-rolled `<table>` here: a header row, static cells, and nothing else. That was
 * enough while these lists were short, and stopped being enough at forty services - there was no way
 * to sort by name, no way to filter down to the one row you meant, and no Manage Columns to put away
 * the columns you were not looking at. All of that already exists in `DataTable`, and every list in
 * the application behaves that way, so a settings list that did not was simply the odd one out.
 *
 * `filtering`, `sorting` and `columnVisibility` are the same three the Assets, Quotation and CRD
 * tables turn on. Column resize is left off, as it is there, so the percentage widths hold and the
 * table fills the panel rather than scrolling sideways.
 *
 * ── One scroll, not four ──────────────────────────────────────────────────────────────────────
 *
 * No height cap, so each table draws every row it has and the panel is the only thing that
 * scrolls. It was capped at 32rem, which put a scrollbar inside each of the three sections: forty
 * services were read through a window ten rows tall, the section's own heading and the Add box
 * stayed put while the rows moved under them, and reaching Deliverables meant scrolling one thing
 * to its end before scrolling another. Three lists a reader moves between are one document, and a
 * document scrolls once.
 *
 * The rows are safe to draw in full because these are studio master lists - tens of rows, not the
 * thousands a lead board carries, which is why this table asks for no `infiniteScroll` either.
 */
function SettingsDataTable({ columns, data, ariaLabel, emptyMessage, density, getRowId, expandable }) {
  return <DataTableShell>
    {/* `overflow-hidden` stays: the table's own scroller inside it is what carries a wide table
        sideways, and this only holds the rounded corners to the rows. */}
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <DataTable
        columns={columns}
        data={data}
        density={density}
        ariaLabel={ariaLabel}
        emptyMessage={emptyMessage}
        noMatchMessage="No matching rows found."
        getRowId={getRowId}
        // The header's ⋮ - Manage Columns, compact, Export CSV - is portalled to `body`, so inside
        // a settings panel it has to name a layer that clears it. The same reason the row menus
        // below take `menuOverPanel`.
        menuZIndexClassName={layers.menuOverPanel}
        features={{ filtering: true, sorting: true, columnVisibility: true, ...(expandable ? { expandable } : {}) }}
      />
    </div>
  </DataTableShell>;
}

const ProjectSettingsPanel = forwardRef(function ProjectSettingsPanel({
  onClose,
  onChanged,
  /*
   * Embedded, the panel is only its body: the three sections stacked as one scrolling document.
   * The frame around them - the title, the rail, the footer with the single Save - belongs to
   * whoever is holding it, which is Settings.
   */
  embedded = false,
  // What the host calls these three sections, so its own rail can scroll to them by id.
  idPrefix = "",
  onEmbeddedStateChange,
}, actionsRef) {
  const [services, setServices] = useState([]);
  /*
   * The service being configured, or null.
   *
   * `{}` means a new one - the dialog is open with the typed name and nothing else. A row object
   * means that row is being edited.
   */
  const [serviceDraft, setServiceDraft] = useState(null);
  const [deliverables, setDeliverables] = useState([]);
  // The deliverable being configured, on the same footing as `serviceDraft`.
  const [deliverableDraft, setDeliverableDraft] = useState(null);
  const [optionSets, setOptionSets] = useState([]);
  const [selectedOptionSetId, setSelectedOptionSetId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [deliverableName, setDeliverableName] = useState("");
  // Shared with every other table in the application, so compact stays compact across the app.
  const { density } = useCompactView();
  /*
   * Says so when something has been written.
   *
   * There is no Save button here - each dialog writes when it is submitted - and without a word back
   * that is indistinguishable from nothing having happened. The row does change behind the dialog,
   * but a row among forty is not an answer to "did that save?".
   */
  const { notice, showSuccess, clearNotice } = useNotice();

  /*
   * Everything typed but not yet written, per section.
   *
   * `creates` are rows that do not exist on the server yet, held under a temporary id so they can be
   * listed, edited and dropped again before anything is sent. `updates` are patches to rows that do,
   * keyed by their real id. `deletes` are ids to retire.
   *
   * One rule for all three kinds - nothing reaches the server until Save - because a panel where
   * adding wrote immediately and editing did not is a panel where Save means something different
   * depending on what you just did.
   */
  const emptyStage = () => ({ creates: [], updates: {}, deletes: [] });
  const [pending, setPending] = useState({ services: emptyStage(), deliverables: emptyStage(), optionValues: emptyStage() });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const stageCount = (stage) => stage.creates.length + Object.keys(stage.updates).length + stage.deletes.length;
  const dirty = Object.values(pending).some((stage) => stageCount(stage) > 0);

  /** Files one change into a section's staging area. */
  const stage = useCallback((section, change) => {
    setPending((current) => ({ ...current, [section]: change(current[section]) }));
  }, []);

  /**
   * The rows a section shows: what the server has, with the staged edits laid over it.
   *
   * Deleted rows drop out, updated rows carry their patch, and created rows are appended - so the
   * table shows what Save is about to produce rather than what the server currently holds.
   */
  const withStaged = useCallback((rows, sectionStage, blank) => [
    ...rows
      .filter((row) => !sectionStage.deletes.includes(row.id))
      .map((row) => (sectionStage.updates[row.id] ? { ...row, ...sectionStage.updates[row.id] } : row)),
    ...sectionStage.creates.map((entry) => ({ ...blank, ...entry.values, id: entry.tempId, isNew: true })),
  ], []);
  const [loading, setLoading] = useState(true);
  // True only while Save is writing - the dialogs no longer talk to the server themselves.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /*
   * What an embedding screen needs to know about this panel.
   *
   * Embedded, the footer belongs to whoever is holding this - Settings - so it has to be told what
   * that footer's Save should do: whether there is anything staged, whether a save is running, and
   * anything that failed. The error travels with the rest because the panel only draws its own
   * notice line when it is a screen of its own; embedded, that line is the host's. `loading` goes
   * with them because the sections do not exist in the page until the rows arrive, and a host whose
   * rail scrolls to one of them has to wait for that.
   *
   * `onEmbeddedStateChange` must be stable - it is a dependency here, so a handler rebuilt on every
   * render would re-run this effect on every render.
   */
  useEffect(() => {
    if (embedded) onEmbeddedStateChange?.({ dirty, busy, error, loading });
  }, [busy, dirty, embedded, error, loading, onEmbeddedStateChange]);
  /*
   * The row waiting on a "remove this?" answer, one per section. Removing is retiring - the row is
   * marked inactive and the work that already used it keeps it.
   */
  const [confirmRemoveService, setConfirmRemoveService] = useState(null);
  const [confirmRemoveDeliverable, setConfirmRemoveDeliverable] = useState(null);

  /*
   * There is no staging any more, and so no Save button.
   *
   * Every section used to edit in place, commit each cell on change, and stage the result for a Save
   * that applied to all three at once. Configuring a row in a dialog writes it when the dialog is
   * submitted, which is both simpler and more honest: nothing is half-saved, and closing the panel
   * cannot lose work because there is never any unwritten work to lose.
   */

  const stagedServices = useMemo(() => withStaged(services, pending.services, { remarksEnabled: true }), [pending.services, services, withStaged]);
  // No blank of its own: Remarks is a note now, and a new deliverable starts without one.
  const stagedDeliverables = useMemo(() => withStaged(deliverables, pending.deliverables, {}), [deliverables, pending.deliverables, withStaged]);
  const sortedServices = useMemo(() => [...stagedServices].sort(byName), [stagedServices]);
  const sortedDeliverables = useMemo(() => [...stagedDeliverables].sort(byName), [stagedDeliverables]);
  const sizeOptionSets = useMemo(() => optionSets.filter((set) => set.code?.includes("SIZE")), [optionSets]);
  const selectedOptionSet = useMemo(() => sizeOptionSets.find((set) => set.id === selectedOptionSetId) || sizeOptionSets[0] || null, [selectedOptionSetId, sizeOptionSets]);
  const selectedOptionValues = useMemo(() => {
    // Only this set's staged rows, since the table shows one set at a time.
    const setId = selectedOptionSet?.id;
    const forSet = {
      creates: pending.optionValues.creates.filter((entry) => entry.setId === setId),
      updates: pending.optionValues.updates,
      deletes: pending.optionValues.deletes,
    };
    // By label, for the same reason the two lists above are by name.
    return withStaged(selectedOptionSet?.values || [], forSet, {}).sort(byLabel);
  }, [pending.optionValues, selectedOptionSet, withStaged]);

  /*
   * The company names already typed on other deliverables, suggested as a brand is named.
   *
   * A list rather than a rule - anything can still be typed. The Deliverable Name box above offers
   * nothing at all; this one does, because a company is named once and then used again, and two
   * spellings of Canvera are two companies to every screen that reads them.
   */
  const deliverableBrandSuggestions = useMemo(
    () => [...new Set(deliverables.flatMap((item) => (item.brands || []).map((brand) => brand.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [deliverables],
  );

  /*
   * The deliverables a service's booking may be mapped to: the ones the server holds, less any
   * staged for removal.
   *
   * Not the staged list. A mapping is three ids - deliverable, brand, variant - or nothing, and a
   * deliverable added or edited on this page has no ids for its brands and variants until Save
   * writes them. Offering the staged list meant a choice that read perfectly well in the dialog
   * and was dropped, without a word, on the way to the server; and a deliverable whose brands had
   * merely been edited made every service already mapped to it read "no longer offered" until the
   * page was saved. A deliverable added here is offered the moment it has been saved.
   */
  const mappableDeliverables = useMemo(
    () => deliverables.filter((row) => !pending.deliverables.deletes.includes(row.id)),
    [deliverables, pending.deliverables.deletes],
  );

  const optionSetOptions = useMemo(() => [{ label: "Not Available", value: "" }, ...optionSets.map((set) => ({ label: set.name, value: set.id }))], [optionSets]);
  // The studio's Service Session Timing set, which every session-timed service is booked from now
  // that the service dialog no longer asks which set to use. Seeded under this code.
  const defaultTimingOptionSetId = useMemo(() => optionSets.find((set) => set.code === "SERVICE_FULL_HALF_SESSION")?.id || "", [optionSets]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [serviceResult, deliverableResult, optionSetResult] = await Promise.all([
        getProjectServiceDefinitions(),
        getProjectDeliverableDefinitions(),
        getProjectOptionSets(),
      ]);
      setServices(serviceResult.data || []);
      setDeliverables(deliverableResult.data || []);
      const nextOptionSets = optionSetResult.data || [];
      setOptionSets(nextOptionSets);
      setSelectedOptionSetId((current) => current || nextOptionSets.find((set) => set.code?.includes("SIZE"))?.id || "");
    } catch (loadError) {
      setError(loadError.message || "Unable to load project settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void load());
  }, []);

  /**
   * Creates or updates one service, with every setting written together.
   *
   * The create endpoint takes only a name - the rest of a service's settings are a PATCH - so a new
   * one is two calls. They are made back to back rather than staged, because a row that appeared
   * with none of its settings applied is exactly the confusion the dialog exists to remove.
   */
  /**
   * Retires a service.
   *
   * It stops appearing in every list from now on, and the projects that already used it keep it -
   * the row is marked inactive rather than deleted, because deleting it would blank the service on
   * work that has already happened.
   */
  /*
   * Staging, one shape for all six actions.
   *
   * A row that exists is patched by id; a row that does not is edited in place in `creates`; a row
   * being retired joins `deletes`, unless it was only ever staged, in which case it simply leaves.
   * Nothing here talks to the server - `saveAll` does that.
   */
  const stageSubmit = (section, draft, values, done) => {
    const editing = draft?.id ? draft : null;
    stage(section, (current) => {
      if (editing?.isNew) {
        return { ...current, creates: current.creates.map((entry) => (entry.tempId === editing.id ? { ...entry, values } : entry)) };
      }
      if (editing) {
        return { ...current, updates: { ...current.updates, [editing.id]: { ...current.updates[editing.id], ...values } } };
      }
      // `crypto.randomUUID` so a temporary id can never collide with a real one from the server.
      return { ...current, creates: [...current.creates, { tempId: `new-${crypto.randomUUID()}`, setId: draft?.optionSetId, values }] };
    });
    done();
  };

  const stageRemove = (section, row, done) => {
    stage(section, (current) => (row.isNew
      ? { ...current, creates: current.creates.filter((entry) => entry.tempId !== row.id) }
      : { ...current, deletes: [...current.deletes, row.id], updates: Object.fromEntries(Object.entries(current.updates).filter(([id]) => id !== row.id)) }));
    done();
  };

  function submitService(values) {
    stageSubmit("services", serviceDraft, values, () => {
      setServiceDraft(null);
      setServiceName("");
    });
  }

  function removeService(row) {
    stageRemove("services", row, () => setConfirmRemoveService(null));
  }

  function submitDeliverable(values) {
    stageSubmit("deliverables", deliverableDraft, values, () => {
      setDeliverableDraft(null);
      setDeliverableName("");
    });
  }

  function removeDeliverable(row) {
    stageRemove("deliverables", row, () => setConfirmRemoveDeliverable(null));
  }

  /**
   * Writes everything staged, then reloads.
   *
   * Per section, creates first, then updates, then deletes - so a row added and then edited in the
   * same sitting is created before its patch is sent, and a row deleted last cannot be patched
   * after it is gone. Deliverables go before services, for the reason on the writer below.
   *
   * Whatever saves clean leaves the staging area, so a failure part-way keeps only what still needs
   * saving and pressing Save again retries just that.
   */
  /** Which set an option value belongs to - the tables are per set, but staging is not. */
  function optionSetIdForValue(valueId) {
    const owner = optionSets.find((set) => (set.values || []).some((value) => value.id === valueId));
    return owner?.id || selectedOptionSet?.id;
  }

  async function saveAll() {
    setBusy(true);
    setError("");
    const failures = [];
    /*
     * What this save is writing, taken once. What the staging area holds by the time it finishes
     * is asked again below, so a row staged while the save was running is kept rather than being
     * overwritten by a snapshot taken before it existed.
     */
    const snapshot = pending;
    /*
     * What was written, per section, so only that leaves the staging area: a created row's real id
     * by its temporary one, an update by the patch object that was sent, a delete by id. The patch
     * object rather than the id, because staging a further edit to the same row replaces the
     * object - so a patch staged while this save was running is not mistaken for the one sent.
     */
    const done = { services: { creates: {}, updates: new Map(), deletes: [] }, deliverables: { creates: {}, updates: new Map(), deletes: [] }, optionValues: { creates: {}, updates: new Map(), deletes: [] } };
    /*
     * Settings still owed to a row that now exists, keyed by its real id.
     *
     * A service or deliverable is two calls - the name makes the row, the settings are a PATCH to
     * it - and when the second fails the row is on the server all the same. Left in `creates`, the
     * next Save would try to make it again and be refused as a duplicate, forever. It becomes a
     * staged edit to the row it made instead, so the next Save sends exactly what is still missing.
     */
    const carried = { services: {}, deliverables: {}, optionValues: {} };

    const writers = {
      /*
       * Deliverables before services: a service's pricing lines may name a deliverable's variants,
       * and the server keeps a mapping only where the deliverable exists - so anything a
       * deliverable is owed goes first.
       */
      deliverables: {
        create: async (values) => (await createProjectDeliverableDefinition({ name: values.name }))?.data?.id,
        settle: (id, settings) => updateProjectDeliverableDefinition(id, settings),
        update: (id, values) => updateProjectDeliverableDefinition(id, values),
        remove: (id) => deleteProjectDeliverableDefinition(id),
        label: "deliverable",
      },
      services: {
        create: async (values) => (await createProjectServiceDefinition({ name: values.name }))?.data?.id,
        settle: (id, settings) => updateProjectServiceDefinition(id, settings),
        update: (id, values) => updateProjectServiceDefinition(id, values),
        remove: (id) => deleteProjectServiceDefinition(id),
        label: "service",
      },
      optionValues: {
        // One call: a value is created with everything it holds.
        create: async (values, entry) => (await createProjectOptionSetValue(entry.setId || selectedOptionSet?.id, values))?.data?.id,
        settle: null,
        update: (id, values) => updateProjectOptionSetValue(optionSetIdForValue(id), id, values),
        remove: (id) => deleteProjectOptionSetValue(optionSetIdForValue(id), id),
        label: "option value",
      },
    };

    for (const [section, writer] of Object.entries(writers)) {
      for (const entry of snapshot[section].creates) {
        let id = null;
        try {
          id = await writer.create(entry.values, entry);
        } catch (saveError) {
          failures.push(saveError.message || `Unable to add a ${writer.label}.`);
          continue;
        }
        done[section].creates[entry.tempId] = { id, entry };
        if (!writer.settle || !id) continue;
        const { name, ...settings } = entry.values;
        try {
          await writer.settle(id, settings);
        } catch (saveError) {
          failures.push(saveError.message || `Unable to save a ${writer.label}.`);
          carried[section][id] = settings;
        }
      }
      for (const [id, values] of Object.entries(snapshot[section].updates)) {
        try {
          await writer.update(id, values);
          done[section].updates.set(id, values);
        } catch (saveError) { failures.push(saveError.message || `Unable to save a ${writer.label}.`); }
      }
      for (const id of snapshot[section].deletes) {
        try {
          await writer.remove(id);
          done[section].deletes.push(id);
        } catch (saveError) { failures.push(saveError.message || `Unable to remove a ${writer.label}.`); }
      }
    }

    setPending((current) => Object.fromEntries(Object.entries(current).map(([section, stageState]) => {
      const updates = { ...carried[section] };
      for (const entry of stageState.creates) {
        const created = done[section].creates[entry.tempId];
        /*
         * A row created during this save, and then edited again while it ran, is on the server
         * under the values it was created with. The edit becomes a patch to that row - it cannot
         * stay a row to add, because the server would refuse the second copy.
         */
        if (created && created.entry !== entry && created.id) updates[created.id] = entry.values;
      }
      for (const [id, values] of Object.entries(stageState.updates)) {
        if (done[section].updates.get(id) !== values) updates[id] = { ...(updates[id] || {}), ...values };
      }
      return [section, {
        creates: stageState.creates.filter((entry) => !done[section].creates[entry.tempId]),
        updates,
        deletes: stageState.deletes.filter((id) => !done[section].deletes.includes(id)),
      }];
    })));
    await load();
    if (failures.length) setError(failures[0]);
    else showSuccess("Project settings saved.");
    onChanged?.();
    setBusy(false);
  }

  useImperativeHandle(actionsRef, () => ({ save: saveAll }));

  /** Close asks first when edits are staged; they exist nowhere else, so closing is losing them. */
  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  /*
   * How a stored value reads on the page.
   *
   * The table shows what a service *is*; the dialog is where it is changed. A dropdown in a cell
   * says "change me", and seven of them across a row say it seven times over a value nobody was
   * looking to change.
   */
  /**
   * A price as an amount, or a dash when there is not one.
   *
   * Nothing rather than zero for an unpriced row: zero would read as free, which is a different
   * claim. Grouped in the Indian convention the rest of the CRM's money uses.
   */
  const money = useCallback((value) => {
    if (value == null || value === "") return "—";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }, []);
  const labelOf = useCallback((options, value, fallback = "—") => {
    const match = options.find((option) => String(option.value) === String(value ?? ""));
    return match?.label || fallback;
  }, []);

  /**
   * A list of stored values as one readable cell.
   *
   * Empty is not nothing here - a service with no shoot types ticked is offered for every shoot, and
   * one with no timings is not timed at all - so each caller says what its own empty means.
   */
  const labelsOf = useCallback((options, values, fallback = "—") => {
    const list = (Array.isArray(values) ? values : []).filter((value) => value && value !== "NONE");
    if (!list.length) return fallback;
    return list.map((value) => options.find((option) => String(option.value) === String(value))?.label || value).join(", ");
  }, []);

  /*
   * One field per column, derived here rather than in the cells.
   *
   * The shared table builds a hidden column for every field it is handed that no column claims, and
   * offers them all in Manage Columns. Handing it the records as they come back would put `code`,
   * `isActive`, `createdAt` and the nested option sets in that list - and `timingMode` and
   * `defaultDurationHours` beside them, as columns of their own, which is exactly what these
   * settings were just deliberately folded *out* of.
   *
   * Deriving the text here also means the table sorts and filters on the words on screen: typing
   * "Outdoor" matches the row that reads Outdoor, not the `OUTDOOR` stored behind it.
   */
  /**
   * The pricing lines of one service, as the rows that hang under it.
   *
   * A service is sold as several bookings - studio full session, studio half session, outdoor full
   * session - each at its own figure, and the table used to run all three together into one Price
   * cell: "Studio Full ₹9,000 · Studio Half ₹4,000 · Outdoor Full ₹10,000". That is a sentence, not
   * a table. Each booking is a row of its own now, under the service it belongs to, so the shoot
   * type, the timing, how long it runs, the size and the price each sit in their own column and a
   * fourth shoot type is a fourth row rather than more text in one cell.
   *
   * Every value is what Settings holds for the line; nothing is derived beyond naming the codes.
   */
  const lineRowsOf = useCallback((service) => {
    const priced = (Array.isArray(service.pricing) ? service.pricing : []).filter((entry) => entry && entry.price != null);
    return priced.map((entry, index) => ({
      // Unique across the table: the row key is the record's own id, and two services' first lines
      // would otherwise collide.
      id: `${service.id}:${index}`,
      // Carried rather than blanked, so filtering the Services column keeps a line with its
      // service; the cell itself draws nothing on a line - see the column's `render`.
      name: service.name || "",
      isLine: true,
      shootType: labelOf(SHOOT_TYPE_OPTIONS, entry.shootType, "—"),
      sessionTiming: labelOf(serviceTimingOptions, entry.timingMode, "—"),
      duration: entry.timingMode === "HOURS_MINUTES"
        ? (entry.hours ? `${entry.hours} hour${Number(entry.hours) === 1 ? "" : "s"}` : "—")
        : (entry.duration || "—"),
      /*
       * The size this booking is priced at. Blank - not "No" - where the service is not sold by
       * size: the head row above already answered that question once, and repeating "No" down
       * every line reads as an answer about the line rather than about the service.
       */
      size: service.sizeEnabled === true ? (entry.size || "—") : "",
      price: money(entry.price),
      // Both belong to the service, not to one of its bookings - the head row above has answered
      // them once, and repeating either down every line reads as an answer about the line.
      deliverableAdded: "",
      complimentary: "",
      remarks: "",
    }));
  }, [labelOf, money]);

  /*
   * One row per service, derived here rather than in the cells.
   *
   * The shared table builds a hidden column for every field it is handed that no column claims, and
   * offers them all in Manage Columns. Handing it the records as they come back would put `code`,
   * `isActive`, `createdAt` and the nested option sets in that list - and `timingMode` and
   * `defaultDurationHours` beside them, as columns of their own, which is exactly what these
   * settings were just deliberately folded *out* of.
   *
   * Deriving the text here also means the table sorts and filters on the words on screen: typing
   * "Outdoor" matches the row that reads Outdoor, not the `OUTDOOR` stored behind it.
   *
   * Every priced service is a heading over its bookings, a single one included. The head answers
   * the questions that belong to the service - the shoot types it covers, whether it is sold by
   * size, the range its lines are priced in - and each booking inside it answers its own, the size
   * it is priced at among them. Folding one line as well as three is what keeps that reading the
   * same everywhere: a Size of "Yes" always means "the sizes are on the rows inside".
   */
  const serviceRows = useMemo(() => sortedServices.map((row) => {
    const lines = lineRowsOf(row);
    const prices = (Array.isArray(row.pricing) ? row.pricing : []).map((entry) => Number(entry?.price)).filter((value) => Number.isFinite(value));
    const range = prices.length ? `${money(Math.min(...prices))}${Math.max(...prices) === Math.min(...prices) ? "" : ` – ${money(Math.max(...prices))}`}` : money(row.price);
    return {
      id: row.id,
      name: row.name || "",
      /*
       * The shoot types this service is sold for. Read off the priced lines, which is where a
       * shoot type is now answered; a service with no lines falls back to the list it carries, and
       * one carrying neither is offered for every shoot, which is what an older row means.
       */
      shootType: lines.length
        ? [...new Set(lines.map((line) => line.shootType))].join(", ")
        : labelsOf(SHOOT_TYPE_OPTIONS, row.shootTypes, "All"),
      // The timing and its length belong to a booking, not to the service: they are on the rows
      // inside, and a head row claiming one of them would be claiming all of them.
      sessionTiming: "—",
      duration: "—",
      // Whether the service is sold by size at all. Each line inside names the size it is priced at.
      size: row.sizeEnabled === true ? "Yes" : "No",
      price: range,
      /*
       * Whether this service brings deliverables with it - the question the dialog asks beside
       * Remarks and Size. Only Yes does, so a service nobody has answered reads as No, which is
       * what every service saved before it was asked means.
       */
      deliverableAdded: row.deliverableAdded === true ? "Yes" : "No",
      // Whether it is given rather than charged for. Only Yes is; one nobody has answered reads No.
      complimentary: row.complimentary === true ? "Yes" : "No",
      // The note, as typed. It was a Yes and a No; it is words now, so the cell shows the words.
      remarks: deliverableAnswerText(row.remarksEnabled) || "—",
      lines,
    };
  }), [labelsOf, lineRowsOf, money, sortedServices]);

  /*
   * The record behind a row, for the ⋮ menu.
   *
   * The dialog needs the whole service - every setting it is about to show - and the row the table
   * hands back is only the words that were on screen.
   */
  /*
   * The record behind a row, for the ⋮ menu - taken from the staged list, not the server's.
   *
   * A row added but not yet saved exists only in staging, under a temporary id the server has never
   * heard of. Looking it up in the server list would hand the dialog `undefined`, so Edit would open
   * blank and Delete would be asked to remove nothing.
   */
  const servicesById = useMemo(() => new Map(stagedServices.map((row) => [row.id, row])), [stagedServices]);

  const serviceColumns = useMemo(() => [
    /* A line draws nothing here: the rule down its chevron cell already says which service it
       belongs to, and the name repeated three times reads as three services. */
    { id: "name", header: "Services", accessorKey: "name", width: "20%", minWidth: 180, render: (row) => (row.isLine ? null : <span className="font-medium text-slate-800">{row.name}</span>) },
    { id: "shootType", header: "Shoot Type", accessorKey: "shootType", width: "19%", minWidth: 180 },
    { id: "sessionTiming", header: "Session Timing", accessorKey: "sessionTiming", width: "13%", minWidth: 140 },
    { id: "duration", header: "Duration", accessorKey: "duration", width: "15%", minWidth: 150 },
    { id: "size", header: "Size", accessorKey: "size", width: "11%", minWidth: 120 },
    { id: "price", header: "Price", accessorKey: "price", width: "11%", minWidth: 120, filterFn: "includesString", sortingFn: "alphanumeric", render: (row) => <span className="tabular-nums">{row.price}</span> },
    { id: "deliverableAdded", header: "Deliverable Added", accessorKey: "deliverableAdded", width: "10%", minWidth: 130 },
    { id: "complimentary", header: "Complimentary", accessorKey: "complimentary", width: "9%", minWidth: 120 },
    { id: "remarks", header: "Remarks", accessorKey: "remarks", width: "12%", minWidth: 140 },
    {
      id: "actions",
      header: "",
      width: "4%",
      minWidth: 56,
      // Neither sorted nor filtered nor resized - it holds a menu, not a value. Its header is where
      // the shared table puts its own ⋮, for Manage Columns and the compact toggle.
      sortable: false,
      filterable: false,
      resizable: false,
      /*
       * The ⋮ menu every table in this application uses, so a row is changed the same way here as
       * anywhere else. Delete retires the service rather than erasing it - see `removeService`.
       *
       * `menuOverPanel` because this table is inside the settings panel, which is `formPanel` (110).
       * The menu was on `menu` (80) and so opened *behind* the panel: pressing ⋮ appeared to do
       * nothing, because Edit and Delete were being painted underneath the thing they belong to.
       */
      // A pricing line is edited inside its service's own dialog, so it carries no menu: Edit and
      // Delete here mean the service, and offering them on a line would name the wrong record.
      render: (row) => (row.isLine ? null : <OptionsMenu
        ariaLabel={`Actions for ${row.name}`}
        menuClassName="w-36"
        menuZIndexClassName={layers.menuOverPanel}
        items={[
          { label: "Edit", onSelect: () => { setServiceDraft(servicesById.get(row.id)); } },
          { label: "Delete", tone: "danger", onSelect: () => setConfirmRemoveService(servicesById.get(row.id)) },
        ]}
      />),
    },
  ], [servicesById]);

  /*
   * What a deliverable costs, as its kind prices it: "8x10 ₹1,200 · 12x18 ₹2,000" for an image
   * kind, "Half ₹5,000 · Full ₹9,000" for a full-length video, one figure for a teaser or a
   * candid - and the flat price where the kind has not been asked yet.
   */
  const deliverablePricingLabel = useCallback((row) => {
    const rows = Array.isArray(row.pricing) ? row.pricing.filter((entry) => entry && entry.price != null && entry.kind) : [];
    if (!rows.length) return money(row.price);
    const sizes = new Map([...(row.pricedSizeOptions || []), ...(row.sizeOptionSet?.values || [])].map((value) => [value.id, value.label]));
    const short = { HALF_SESSION: "Half", FULL_SESSION: "Full" };
    const byKind = new Map();
    for (const entry of rows) {
      const shape = pricingShapeFor(entry.kind);
      const part = shape === "SIZE" ? `${entry.size || sizes.get(entry.sizeOptionValueId) || "Size"} ${money(entry.price)}`
        : shape === "SESSION" ? `${short[entry.timingMode] || entry.timingMode} ${money(entry.price)}` : money(entry.price);
      byKind.set(entry.kind, [...(byKind.get(entry.kind) || []), part]);
    }
    return [...byKind].map(([kind, parts]) => `${kindLabel(kind)}: ${parts.join(" · ")}`).join(" | ");
  }, [money]);

  /**
   * What a set of variants costs, as one cell: the figure where they agree, the range where they
   * do not. The rule a service's head row prices by - see `serviceRows` - over a deliverable's
   * variants instead of a service's pricing lines.
   */
  const priceRangeOf = useCallback((variants) => {
    const prices = (variants || []).map((variant) => Number(variant?.price)).filter((value) => Number.isFinite(value));
    if (!prices.length) return "";
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return `${money(low)}${high === low ? "" : ` – ${money(high)}`}`;
  }, [money]);

  /**
   * The variants one brand sells a deliverable in, as the rows that hang under that brand.
   *
   * The deepest of the three levels, and the only one carrying a figure. What a variant is asked
   * for follows the deliverable's type and nothing else, so the columns the other type owns are
   * left **blank** rather than dashed: a dash on a video's Frame Inches would read as an answer
   * about the variant, when the question was never put to it. The same reading a service's Size
   * cell has on a service not sold by size.
   */
  const variantRowsOf = useCallback((deliverable, brand, brandIndex) => {
    const isVideo = deliverable.mediaType === "VIDEO";
    const isImage = deliverable.mediaType === "IMAGE";
    return (brand.variants || []).map((variant, index) => ({
      // Unique across the table: two deliverables' first variants would otherwise collide, and so
      // would two brands' on the same deliverable.
      id: `${deliverable.id}:brand:${brandIndex}:variant:${index}`,
      isLine: true,
      isVariant: true,
      // Carried rather than blanked, so filtering the Deliverables or Company column keeps a
      // variant with the deliverable and the brand it belongs to; the cells themselves draw
      // nothing on a variant - see each column's `render`.
      name: deliverable.name || "",
      brandName: brand.name || "",
      type: "",
      imageSize: isVideo ? "" : (variant.size || "—"),
      videoLength: isImage ? "" : (variant.videoLength || "—"),
      frameInches: isVideo ? "" : (variant.frameInches || "—"),
      price: variant.price == null ? "—" : money(variant.price),
      photoCount: "",
      imageSelection: "",
      complimentary: "",
      remarks: "",
    }));
  }, [money]);

  /**
   * The companies that sell one deliverable, as the rows that hang under it - each opening in turn
   * into the variants it sells.
   *
   * Three levels rather than a service's two, because a deliverable genuinely has three: the same
   * album is sold by Canvera and by Pictoo, and each sells it in several sizes at several prices.
   * Running them together would put "Canvera 12x18 ₹2,000 · Canvera 16x24 ₹3,500 · Pictoo 8x10
   * ₹1,200" in one cell, which is a sentence, not a table.
   *
   * A brand row answers only the question that is the brand's own - its name - and prices itself as
   * the range its variants cover. Everything else belongs either to the deliverable above it or to
   * the variants below, and is left blank in between.
   */
  const brandRowsOf = useCallback((deliverable) => (deliverable.brands || []).map((brand, index) => ({
    id: `${deliverable.id}:brand:${index}`,
    isLine: true,
    isBrand: true,
    name: deliverable.name || "",
    // An unnamed brand is a real one - a studio selling its own albums has nobody to name - so the
    // cell says so rather than leaving the row looking like it lost its name.
    brandName: brand.name || "—",
    type: "",
    imageSize: "",
    videoLength: "",
    frameInches: "",
    price: priceRangeOf(brand.variants) || "—",
    photoCount: "",
    imageSelection: "",
    complimentary: "",
    remarks: "",
    variants: variantRowsOf(deliverable, brand, index),
  })), [priceRangeOf, variantRowsOf]);

  /*
   * One row per deliverable, derived here rather than in the cells - see `serviceRows` for why.
   *
   * The head row answers the questions that belong to the deliverable - what it is, whose it is,
   * and the three asked of every deliverable - and each level inside it answers its own. Size,
   * Length and Frame Inches read "—" here for the same reason Session Timing and Duration do on a
   * service: they belong to a variant, and a head row claiming one of them would be claiming all
   * of them.
   *
   * With one exception, and it is the honest one: a deliverable with no brands at all has nowhere
   * else to show the five columns it still carries, so it shows them itself. That is every
   * deliverable saved before brands existed and not yet reopened.
   */
  const deliverableRows = useMemo(() => sortedDeliverables.map((row) => {
    const brands = brandRowsOf(row);
    const variants = brands.flatMap((brand) => brand.variants);
    return {
      id: row.id,
      name: row.name || "",
      // What it is: Image or Video; a dash before it is asked.
      type: row.mediaType ? (row.mediaType === "VIDEO" ? "Video" : "Image") : "—",
      /*
       * The companies this deliverable is sold by. Read off the brand rows, which is where a
       * company is now named - the same way a service's Shoot Type is read off its priced lines.
       */
      brandName: brands.length
        ? [...new Set(brands.map((brand) => brand.brandName))].join(", ")
        : (row.brandName || "—"),
      imageSize: brands.length ? "—" : (row.imageSize || "—"),
      videoLength: brands.length ? "—" : (row.videoLength || "—"),
      frameInches: brands.length ? "—" : (row.frameInches || "—"),
      /*
       * What the deliverable costs, over every variant every brand sells it in. A deliverable
       * priced under the kinds the dialog used to ask about still reads as it did - see
       * `deliverablePricingLabel` - because nothing rewrote those rows and a quotation raised
       * against them still prices from them.
       */
      price: brands.length ? (priceRangeOf(variants) || "—") : deliverablePricingLabel(row),
      /*
       * The three common answers, as typed. They were a Yes and a No; they are words now, so the
       * cell shows the words. Blank is unanswered - which for Image Selection is a real state, and
       * keeps the deliverable out of that module.
       */
      photoCount: deliverableAnswerText(row.photoCountEnabled) || "—",
      imageSelection: deliverableAnswerText(row.imageSelectionEnabled) || "—",
      // Its own answer, and nothing to do with any service's - see the service row above.
      complimentary: row.complimentary === true ? "Yes" : "No",
      remarks: deliverableAnswerText(row.remarksEnabled) || "—",
      brands,
    };
  }), [brandRowsOf, deliverablePricingLabel, priceRangeOf, sortedDeliverables]);

  // From the staged list - see `servicesById` on why the server's own is not enough.
  const deliverablesById = useMemo(() => new Map(stagedDeliverables.map((row) => [row.id, row])), [stagedDeliverables]);

  const deliverableColumns = useMemo(() => [
    /* The dialog's own order, so the table reads as the form that filled it in. A brand and a
       variant draw nothing here: the rule down their chevron cell already says which deliverable
       they belong to, and the name repeated four times reads as four deliverables. */
    { id: "name", header: "Deliverables", accessorKey: "name", width: "15%", minWidth: 160, render: (row) => (row.isLine ? null : <span className="font-medium text-slate-800">{row.name}</span>) },
    /* Whose it is. The head row lists the companies, a brand row names itself, and a variant draws
       nothing - the brand row directly above it has already said whose variant it is, and repeating
       the company down every size reads as a company per size. */
    { id: "brandName", header: "Company / Brand Name", accessorKey: "brandName", width: "12%", minWidth: 150, render: (row) => (row.isVariant ? null : row.brandName) },
    { id: "type", header: "Deliverable Type", accessorKey: "type", width: "8%", minWidth: 110 },
    { id: "imageSize", header: "Size", accessorKey: "imageSize", width: "9%", minWidth: 110 },
    { id: "videoLength", header: "Length", accessorKey: "videoLength", width: "9%", minWidth: 110 },
    { id: "frameInches", header: "Frame Inches", accessorKey: "frameInches", width: "9%", minWidth: 110 },
    { id: "price", header: "Price", accessorKey: "price", width: "9%", minWidth: 110, sortingFn: "alphanumeric", render: (row) => <span className="tabular-nums">{row.price}</span> },
    { id: "photoCount", header: "No.of.Count", accessorKey: "photoCount", width: "8%", minWidth: 110 },
    { id: "imageSelection", header: "Image Selection", accessorKey: "imageSelection", width: "10%", minWidth: 130 },
    { id: "complimentary", header: "Complimentary", accessorKey: "complimentary", width: "9%", minWidth: 120 },
    { id: "remarks", header: "Remarks", accessorKey: "remarks", width: "7%", minWidth: 100 },
    {
      id: "actions",
      header: "",
      width: "4%",
      minWidth: 56,
      sortable: false,
      filterable: false,
      resizable: false,
      // `menuOverPanel` for the same reason as the services table - see that column's note.
      // A brand and a variant are edited inside their deliverable's own dialog, so neither carries
      // a menu: Edit and Delete here mean the deliverable, and offering them on a brand would name
      // the wrong record.
      render: (row) => (row.isLine ? null : <OptionsMenu
        ariaLabel={`Actions for ${row.name}`}
        menuClassName="w-36"
        menuZIndexClassName={layers.menuOverPanel}
        items={[
          { label: "Edit", onSelect: () => { setDeliverableDraft(deliverablesById.get(row.id)); } },
          { label: "Delete", tone: "danger", onSelect: () => setConfirmRemoveDeliverable(deliverablesById.get(row.id)) },
        ]}
      />),
    },
  ], [deliverablesById]);

  const servicesContent = <>
    <AddServiceForm
      value={serviceName}
      onChange={setServiceName}
      onAdd={() => { setServiceDraft({ name: serviceName.trim() }); }}
    />
    {/* One row per service, its pricing lines folded under a chevron - the arrangement the
        quotation register uses for a chain's earlier versions. A service priced as one booking has
        no chevron: its line is the row. */}
    <SettingsDataTable
      columns={serviceColumns}
      data={serviceRows}
      ariaLabel="Project service settings"
      emptyMessage="No services configured."
      density={density}
      getRowId={(row) => row.id}
      expandable={{ label: "the pricing lines of this service", getSubRows: (row) => row.lines || [], canExpand: (row) => (row.lines || []).length > 0 }}
    />
  </>;

  const deliverablesContent = <>
    <AddDeliverableForm
      value={deliverableName}
      onChange={setDeliverableName}
      onAdd={() => { setDeliverableDraft({ name: deliverableName.trim() }); }}
    />
    {/* One row per deliverable, the companies that sell it folded under a chevron, and each
        company's variants folded under one of its own - the arrangement the Services table uses for
        a service's pricing lines, over the three levels a deliverable actually has. A deliverable
        sold by nobody has no chevron: the row is all there is. */}
    <SettingsDataTable
      columns={deliverableColumns}
      data={deliverableRows}
      ariaLabel="Project deliverable settings"
      emptyMessage="No deliverables configured."
      density={density}
      getRowId={(row) => row.id}
      expandable={{
        label: "what is sold under this row",
        getSubRows: (row) => row.brands || row.variants || [],
        canExpand: (row) => (row.brands || row.variants || []).length > 0,
      }}
    />
  </>;

  const overlays = <>
    {serviceDraft && <ServiceDefinitionDialog
      service={serviceDraft.id ? serviceDraft : null}
      initialName={serviceDraft.id ? "" : (serviceDraft.name || "")}
      defaultTimingOptionSetId={defaultTimingOptionSetId}
      sizeOptionSets={sizeOptionSets.filter((set) => String(set.code || "").startsWith("SERVICE_"))}
      timingOptions={serviceTimingOptions}
      booleanOptions={booleanOptions}
      // So a pricing row can name the exact deliverable variants that booking brings with it -
      // the saved ones, which are the only ones with ids to name; see `mappableDeliverables`.
      deliverableDefinitions={mappableDeliverables}
      // Every other service's name, so a second "Demo Drone" is refused in the dialog rather than
      // at Save - the staged list, because a name staged twice is refused by the server just once.
      takenNames={takenDefinitionNameKeys(stagedServices, serviceDraft.id || null)}
      onClose={() => { setServiceDraft(null); }}
      onSubmit={(values) => void submitService(values)}
    />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {deliverableDraft && <DeliverableDefinitionDialog
      deliverable={deliverableDraft.id ? deliverableDraft : null}
      initialName={deliverableDraft.id ? "" : (deliverableDraft.name || "")}
      brandSuggestions={deliverableBrandSuggestions}
      yesNoOptions={yesNoOptions}
      booleanOptions={booleanOptions}
      // Every other deliverable's name - see the service dialog's `takenNames`.
      takenNames={takenDefinitionNameKeys(stagedDeliverables, deliverableDraft.id || null)}
      onClose={() => { setDeliverableDraft(null); }}
      onSubmit={(values) => void submitDeliverable(values)}
    />}
    {confirmDiscard && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title="Discard unsaved changes?"
      message="Your edits have not been saved. Close anyway and they will be lost."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onCancel={() => setConfirmDiscard(false)}
      onConfirm={() => { setConfirmDiscard(false); onClose?.(); }}
    />}
    {confirmRemoveDeliverable && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title={`Remove "${confirmRemoveDeliverable.name}"?`}
      message="It stops appearing when a project is set up. Projects that already use it keep it, and adding a deliverable with the same name later brings it back."
      confirmLabel="Remove"
      busyLabel="Removing..."
      onCancel={() => setConfirmRemoveDeliverable(null)}
      onConfirm={() => void removeDeliverable(confirmRemoveDeliverable)}
    />}
    {confirmRemoveService && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title={`Remove "${confirmRemoveService.name}"?`}
      message="It stops appearing when a project is set up. Projects that already use it keep it, and adding a service with the same name later brings it back."
      confirmLabel="Remove"
      busyLabel="Removing..."
      onCancel={() => setConfirmRemoveService(null)}
      onConfirm={() => void removeService(confirmRemoveService)}
    />}
  </>;

  /**
   * The two sections, stacked, as one scrolling document.
   *
   * Services and Deliverables one under the other, read by scrolling, with a single Save beneath
   * them that writes both together. Size Options used to be a third section here; the size lists
   * are still read by the pickers and suggested on pricing lines, but are not edited on this
   * screen any more. It
   * matters that they are one page rather than three - the Save is one Save, and a Save at the foot
   * of a screen showing only Services reads as Services' own however many sections it actually
   * covers.
   *
   * `idPrefix` lets the host name the anchors. Embedded in Settings, its rail entries scroll to
   * these ids, so they have to be the rail's own - `project-services` rather than `services`.
   */
  const stackedSections = (idPrefix = "") => <>
    <SchemaFormSection id={`${idPrefix}services`} title="Services" wide>
      {servicesContent}
    </SchemaFormSection>
    <SchemaFormSection id={`${idPrefix}deliverables`} title="Deliverables" wide>
      {deliverablesContent}
    </SchemaFormSection>
  </>;

  if (embedded) return <>
    {overlays}
    {loading ? <Loader label="Loading project settings..." size="lg" className="h-full" /> : stackedSections(idPrefix)}
  </>;

  return <SchemaFormPanel
    title="Project Settings"
    description="Configure project service and deliverable master data."
    sections={sections}
    sidebarAriaLabel="Project settings sections"
    closeAriaLabel="Close project settings"
    onClose={requestClose}
    onSubmit={(event) => event.preventDefault()}
    error={error}
    footer={<>
      <Button type="button" onClick={requestClose} disabled={busy}>Close</Button>
      {/* Disabled until there is something to write, which is what says whether anything is staged. */}
      <Button type="button" variant="primary" className="ml-auto" onClick={() => void saveAll()} disabled={!dirty || busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
    </>}
  >
    {overlays}
    {loading ? <Loader label="Loading project settings..." size="lg" className="h-full" /> : stackedSections()}
  </SchemaFormPanel>;
});

export default ProjectSettingsPanel;
