"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import OptionsMenu from "@/components/ui/OptionsMenu";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import { settingsHelpFor } from "@/constants/settingsHelp";
import KanbanBoard, { NO_VALUE, columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { rowReorderColumn } from "@/components/data-table/rowReorderColumn";
import useCompactView from "@/components/shared/useCompactView";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
import { layers } from "@/constants/layers";
import ServiceDefinitionDialog from "./ServiceDefinitionDialog";
import { kindLabel, pricingShapeFor } from "@/lib/deliverablePricing.mjs";
import { deliverableAnswerText } from "@/lib/deliverableAnswers.mjs";
import { takenDefinitionNameKeys } from "@/lib/projectDefinitionNames.mjs";
import { columnCount } from "@/lib/kanbanSummary.mjs";
import DeliverableDefinitionDialog from "./DeliverableDefinitionDialog";
import { duplicateDeliverableValues } from "@/lib/definitionDuplicate.mjs";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import {
  createProjectDeliverableDefinition,
  createProjectServiceDefinition,
  getProjectDeliverableDefinitions,
  getProjectServiceDefinitions,
  updateProjectDeliverableDefinition,
  deleteProjectDeliverableDefinition,
  updateProjectServiceDefinition,
  deleteProjectServiceDefinition,
  reorderProjectDeliverableDefinitions,
  reorderProjectServiceDefinitions,
} from "@/services/project-management/project-workflow.service";

const sections = [["services", "Services"], ["deliverables", "Deliverables"]];
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
 * The order the rows are in is the studio's own, set by dragging a row's grip.
 *
 * These lists were once ordered by a Sort Order typed against each row, which nobody could keep in
 * their head across forty services, and then alphabetically. Neither was the order the studio sells
 * in. Now the grip in front of each row moves it - drag it, or focus it and press the arrow keys, or
 * on a phone use Move up / Move down - and the order is saved the moment it is dropped, as every
 * other change on this panel is. The server keeps it, and the quotation generator, Create Project
 * and the pickers all list the rows in it. A new row joins at the end. Nothing else about a row
 * changes when it moves.
 *
 * The tables still sort by a header for reading, but the grip waits while they do: dropping a row
 * among rows on screen in some other order would move it somewhere the reader cannot see.
 */
const SORTED_HINT = "Clear the column sort to put the rows in order.";

/*
 * The name is typed, and nothing is offered while it is.
 *
 * Both rows used to be a combo box listing every service, or every deliverable, the studio already
 * had - so a name that existed was chosen rather than retyped into a second spelling. The list is
 * gone at the studio's request: the box asks for a name and takes whatever is written, and the
 * table below is where the existing ones are read.
 */
/*
 * Enter adds, the way it does on every other name-and-Add row (the
 * option-list editor): the box is the whole form here, and reaching for the button after typing a
 * name is exactly the pause these rows exist to remove. Held to the button's own rule - nothing
 * already being added, and a blank name marked under the box - so Enter can never do what the
 * button would refuse. An Enter that is finishing an IME composition belongs to the composition
 * and is left alone.
 */
const addOnEnter = (allowed, onAdd) => (event) => {
  if (event.key !== "Enter" || !allowed || event.nativeEvent?.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  onAdd();
};

function AddServiceForm({ value, onChange, onAdd, saving }) {
  const fields = useFormErrors();
  const add = () => fields.check({ name: value.trim() ? "" : "Enter a service name." }) && onAdd();
  return <div className="mb-5 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
    <TextField
      label="Service Name"
      helperText="A new service the team can add to a project's shoots."
      className="min-w-0 flex-1"
      value={value}
      maxLength={191}
      onChange={(event) => { fields.clear("name"); onChange(event.target.value); }}
      placeholder="Type a service name"
      disabled={saving}
      error={fields.errors.name}
      onKeyDown={addOnEnter(!saving, add)}
    />
    <Button type="button" variant="primary" disabled={saving} onClick={add}>
      {saving ? "Adding..." : "Add"}
    </Button>
  </div>;
}

/** The Deliverables row: the same control as `AddServiceForm`, and typed for the same reason. */
function AddDeliverableForm({ value, onChange, onAdd, saving }) {
  const fields = useFormErrors();
  const add = () => fields.check({ name: value.trim() ? "" : "Enter a deliverable name." }) && onAdd();
  return <div className="mb-5 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-end">
    <TextField
      label="Deliverable Name"
      helperText="A new deliverable the team can add to a project's shoots."
      className="min-w-0 flex-1"
      value={value}
      maxLength={191}
      onChange={(event) => { fields.clear("name"); onChange(event.target.value); }}
      placeholder="Type a deliverable name"
      disabled={saving}
      error={fields.errors.name}
      onKeyDown={addOnEnter(!saving, add)}
    />
    <Button type="button" variant="primary" disabled={saving} onClick={add}>
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
function SettingsDataTable({ columns, data, ariaLabel, emptyMessage, density, getRowId, expandable, onSortChange }) {
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
        // Whether a header sort is on, which the row grip waits out.
        onSortChange={onSortChange}
      />
    </div>
  </DataTableShell>;
}

/*
 * The Board half of each section's Table / Board switch: the same rows, stood in columns by a
 * category they carry. Order is set by the table's grip; a card opens the row's Edit dialog, as
 * its menu's Edit does, and a card dropped on another column opens it with that answer chosen. Held at a fixed height so its columns scroll inside it
 * while the panel stays the one document that scrolls.
 */
// A service with no deliverable set up yet: the Services board's tag, and what its column counts.
const serviceFlag = (row) => (row.deliverableAdded === "No" ? "No deliverable" : "");

function SettingsBoard({ rows, groupOf, card, columnAmount, cardFlag, onOpen, onMove, cardActions, noun, ariaLabel }) {
  return <div className="flex h-110 min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white">
    <KanbanBoard
      rows={rows}
      columns={columnsFromRows(rows, groupOf)}
      statusOf={(row) => groupValue(groupOf(row))}
      // The figure under each column, when the section has one to show (Services does).
      columnAmount={columnAmount}
      // The tag on each card that figure counts.
      cardFlag={cardFlag}
      card={card}
      getRowId={(row) => String(row.id)}
      onOpen={onOpen}
      // The card's ⋮ is the row's ⋮, lifted over the settings panel as the row's is.
      cardActions={cardActions}
      cardMenuProps={{ menuZIndexClassName: layers.menuOverPanel }}
      // A drop opens the row's own Edit with the column's answer already chosen; Save is still
      // the person's, so nothing changes until they press it.
      canDropAt={(row, to) => Boolean(onMove) && to !== NO_VALUE}
      onDrop={onMove}
      noun={noun}
      ariaLabel={ariaLabel}
    />
  </div>;
}

export default function ProjectSettingsPanel({
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
}) {
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
  const [servicesLayout, setServicesLayout] = useTableBoardLayout("project-settings-services");
  const [deliverablesLayout, setDeliverablesLayout] = useTableBoardLayout("project-settings-deliverables");
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
   * One write at a time, from whichever dialog is open.
   *
   * Add, Update and Remove each write the moment they are pressed - nothing is held for a Save - so
   * the guard is the ref inside `useSubmitOnce`: a double-click on Add is one request, not two rows.
   * `dialogError` is what the open dialog shows when its write is refused; the dialog stays open
   * with everything that was typed, so pressing again retries.
   */
  const { busy: saving, run } = useSubmitOnce();
  const [dialogError, setDialogError] = useState("");
  /*
   * The row a new service or deliverable's create call made, while its settings are still owed.
   *
   * A new row is two calls - the name makes it, the settings are a PATCH to it - and when the
   * second fails the row is on the server all the same. Pressing Add again must patch that row,
   * not try to make it a second time and be refused as a duplicate.
   */
  const createdIdRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /*
   * What an embedding screen needs to know about this panel.
   *
   * `busy` is a dialog's write in flight, so the host's Save cannot close Settings under it. The
   * error travels because the panel only draws its own notice line when it is a screen of its
   * own; embedded, that line is the host's. `loading` goes with it because the sections do not exist
   * in the page until the rows arrive, and a host whose rail scrolls to one of them has to wait for
   * that.
   *
   * `onEmbeddedStateChange` must be stable - it is a dependency here, so a handler rebuilt on every
   * render would re-run this effect on every render.
   */
  useEffect(() => {
    if (embedded) onEmbeddedStateChange?.({ busy: saving, error, loading });
  }, [embedded, error, loading, onEmbeddedStateChange, saving]);
  /*
   * The row waiting on a "remove this?" answer, one per section. Removing is retiring - the row is
   * marked inactive and the work that already used it keeps it.
   */
  const [confirmRemoveService, setConfirmRemoveService] = useState(null);
  const [confirmRemoveDeliverable, setConfirmRemoveDeliverable] = useState(null);

  /*
   * There is no staging, and so no Save button.
   *
   * Configuring a row in a dialog writes it when the dialog is submitted, and removing one writes
   * when the removal is confirmed. Nothing is half-saved, and closing the panel cannot lose work
   * because there is never any unwritten work to lose. The tables show what the server holds.
   */
  // Whether a header sort is on in each table, which pauses its grip (see `SORTED_HINT`).
  const [servicesSorted, setServicesSorted] = useState(false);
  const [deliverablesSorted, setDeliverablesSorted] = useState(false);

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

  /**
   * Reads every list from the server.
   *
   * `quiet` after a write: the rows are refreshed in place rather than the sections being swapped
   * for a loader, which would throw away the reader's scroll position for a one-row change.
   */
  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [serviceResult, deliverableResult] = await Promise.all([
        getProjectServiceDefinitions(),
        getProjectDeliverableDefinitions(),
      ]);
      setServices(serviceResult.data || []);
      setDeliverables(deliverableResult.data || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load project settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void load());
  }, []);

  /*
   * The endpoints each kind of row is written through.
   *
   * The create endpoint takes only a name - the rest of a row's settings are a PATCH to the row it
   * made - so a new service or deliverable is two calls, made back to back. A deliverable's brands
   * and variants ride in that PATCH, which the server writes in one transaction with the row.
   */
  const writers = {
    services: {
      create: createProjectServiceDefinition,
      update: updateProjectServiceDefinition,
      remove: deleteProjectServiceDefinition,
      label: "Service",
    },
    deliverables: {
      create: createProjectDeliverableDefinition,
      update: updateProjectDeliverableDefinition,
      remove: deleteProjectDeliverableDefinition,
      label: "Deliverable",
    },
  };

  /**
   * Writes one service or deliverable from its dialog, and closes the dialog only once the server
   * has it.
   *
   * A refusal leaves the dialog open with everything typed and the server's reason above the
   * fields, so pressing again retries. Only what this dialog wrote is touched - nothing else on the
   * page is held for a Save, so nothing else can be cleared by one.
   */
  const writeDefinition = (section, draft, values, close) => run(async () => {
    const writer = writers[section];
    setDialogError("");
    try {
      let id = draft?.id || createdIdRef.current;
      const adding = !draft?.id;
      if (!id) {
        id = (await writer.create({ name: values.name }))?.data?.id;
        if (!id) throw new Error(`Unable to add the ${writer.label.toLowerCase()}.`);
        createdIdRef.current = id;
      }
      await writer.update(id, values);
      createdIdRef.current = null;
      close();
      showSuccess(`${writer.label} ${adding ? "added" : "updated"}.`);
      await load({ quiet: true });
      onChanged?.();
    } catch (saveError) {
      const reason = saveError.message || `Unable to save the ${writer.label.toLowerCase()}.`;
      // The row exists but its settings do not: said so, since pressing Add again only patches it.
      setDialogError(createdIdRef.current
        ? `The ${writer.label.toLowerCase()} was added, but its settings were not saved: ${reason} Press Add to try again.`
        : reason);
    }
  });

  /*
   * A row dropped in a new place: shown there at once, then saved. The order is written the moment
   * it is dropped, like everything else here, through the same one-write-at-a-time guard - so
   * Settings' Save waits for it, and a drop while another write is going is ignored. Refused, the
   * table is read again so it shows the order the server actually holds, and says so.
   */
  const reorderDefinitions = (section, ids) => run(async () => {
    const [setRows, save, label] = section === "services"
      ? [setServices, reorderProjectServiceDefinitions, "services"]
      : [setDeliverables, reorderProjectDeliverableDefinitions, "deliverables"];
    const position = new Map(ids.map((id, index) => [id, index]));
    setRows((current) => [...current].sort((a, b) => (position.get(a.id) ?? ids.length) - (position.get(b.id) ?? ids.length)));
    setError("");
    try {
      await save(ids);
      onChanged?.();
    } catch (orderError) {
      setError(`Could not save the order of the ${label}: ${orderError.message || "the server refused it."} The list shows the order that is saved.`);
      await load({ quiet: true });
    }
  });

  /**
   * Retires a service or deliverable once the removal is confirmed.
   *
   * It stops appearing in every list from now on, and the projects that already used it keep it -
   * the row is marked inactive rather than deleted, because deleting it would blank it on work that
   * has already happened.
   */
  const removeDefinition = (section, row, close) => run(async () => {
    const writer = writers[section];
    setError("");
    try {
      await writer.remove(row.id);
      close();
      showSuccess(`${writer.label} removed.`);
      await load({ quiet: true });
      onChanged?.();
    } catch (removeError) {
      close();
      setError(`Could not remove "${row.name}": ${removeError.message || "the server refused it."}`);
    }
  });

  /*
   * Leaving a dialog. A new row whose settings write failed is on the server all the same, so the
   * lists are read again and it shows in the table rather than appearing only after a reload.
   */
  function closeDefinitionDialog(close) {
    const orphaned = createdIdRef.current;
    createdIdRef.current = null;
    setDialogError("");
    close();
    if (!orphaned) return;
    // After the refresh, which clears the notice line as it starts; a refresh's own failure wins.
    void load({ quiet: true }).then(() => setError((current) => current || "Added without its settings - open it with Edit to finish setting it up."));
  }

  function submitService(values) {
    return writeDefinition("services", serviceDraft, values, () => {
      setServiceDraft(null);
      setServiceName("");
    });
  }

  function removeService(row) {
    return removeDefinition("services", row, () => setConfirmRemoveService(null));
  }

  function submitDeliverable(values) {
    // A duplicate also carries what the dialog does not ask - see `duplicateDeliverableValues`.
    const written = deliverableDraft?.copyOf ? duplicateDeliverableValues(deliverableDraft.copyOf, values) : values;
    return writeDefinition("deliverables", deliverableDraft, written, () => {
      setDeliverableDraft(null);
      setDeliverableName("");
    });
  }

  function removeDeliverable(row) {
    return removeDefinition("deliverables", row, () => setConfirmRemoveDeliverable(null));
  }

  // Nothing is ever held unsaved here, so closing never has anything to ask about.
  const requestClose = () => onClose?.();

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
  /*
   * One row per service, derived here rather than in the cells.
   *
   * The shared table builds a hidden column for every field it is handed that no column claims, and
   * offers them all in Manage Columns. Handing it the records as they come back would put `code`,
   * `isActive`, `createdAt`, the nested option sets and the stored pricing lines in that list.
   *
   * Deriving the text here also means the table sorts and filters on the words on screen.
   *
   * A service is one row at one price. Shoot Type, Session Timing, Duration and Size are no longer
   * Settings questions, so the per-booking lines that used to hang under a service are not drawn:
   * whatever a service still stores in `pricing` stays in the database, untouched and unused.
   */
  const serviceRows = useMemo(() => services.map((row) => ({
    id: row.id,
    name: row.name || "",
    // The one price the Quotation Generator quotes this service at, on every shoot.
    price: money(row.price),
    /*
     * Whether this service brings deliverables with it. Only Yes does, so a service nobody has
     * answered reads as No, which is what every service saved before it was asked means.
     */
    deliverableAdded: row.deliverableAdded === true ? "Yes" : "No",
    // Whether it is given rather than charged for. Only Yes is; one nobody has answered reads No.
    complimentary: row.complimentary === true ? "Yes" : "No",
    // The note, as typed. It was a Yes and a No; it is words now, so the cell shows the words.
    remarks: deliverableAnswerText(row.remarksEnabled) || "—",
  })), [money, services]);

  /*
   * The record behind a row, for the ⋮ menu.
   *
   * The dialog needs the whole service - every setting it is about to show - and the row the table
   * hands back is only the words that were on screen.
   */
  const servicesById = useMemo(() => new Map(services.map((row) => [row.id, row])), [services]);

  // The grip in front of each row. A deliverable's companies and variants are not in this list -
  // their order is set in the deliverable's own dialog - so their rows draw no grip.
  const serviceIds = useMemo(() => services.map((row) => row.id), [services]);
  const serviceReorder = useMemo(() => rowReorderColumn({
    listOf: () => ({ key: "services", ids: serviceIds }),
    onReorder: (key, ids) => void reorderDefinitions(key, ids),
    labelOf: (row) => row.name,
    disabled: saving || servicesSorted,
    disabledHint: servicesSorted ? SORTED_HINT : undefined,
  }), [serviceIds, saving, servicesSorted]); // eslint-disable-line react-hooks/exhaustive-deps -- `reorderDefinitions` reads state through setters and `run`
  // A service's ⋮ - the table row's and its Board card's. Delete retires it (`removeService`).
  const serviceActionItems = useCallback((row) => [
    { label: "Edit", onSelect: () => { setServiceDraft(servicesById.get(row.id)); } },
    // A new service started from this one: the Add dialog, filled from it, name left empty.
    { label: "Duplicate", onSelect: () => { setServiceDraft({ copyOf: servicesById.get(row.id) }); } },
    { label: "Delete", tone: "danger", onSelect: () => setConfirmRemoveService(servicesById.get(row.id)) },
  ], [servicesById]);

  const serviceColumns = useMemo(() => [
    serviceReorder,
    { id: "name", header: "Services", accessorKey: "name", width: "30%", minWidth: 180, render: (row) => <span className="font-medium text-slate-800">{row.name}</span> },
    { id: "price", header: "Price", accessorKey: "price", width: "16%", minWidth: 120, filterFn: "includesString", sortingFn: "alphanumeric", render: (row) => <span className="tabular-nums">{row.price}</span> },
    { id: "deliverableAdded", header: "Deliverable Added", accessorKey: "deliverableAdded", width: "16%", minWidth: 130 },
    { id: "complimentary", header: "Complimentary", accessorKey: "complimentary", width: "14%", minWidth: 120 },
    { id: "remarks", header: "Remarks", accessorKey: "remarks", width: "20%", minWidth: 140 },
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
      render: (row) => <OptionsMenu
        ariaLabel={`Actions for ${row.name}`}
        menuClassName="w-36"
        menuZIndexClassName={layers.menuOverPanel}
        items={serviceActionItems(row)}
      />,
    },
  ], [serviceActionItems, serviceReorder]);

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
  const deliverableRows = useMemo(() => deliverables.map((row) => {
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
  }), [brandRowsOf, deliverablePricingLabel, priceRangeOf, deliverables]);

  const deliverablesById = useMemo(() => new Map(deliverables.map((row) => [row.id, row])), [deliverables]);

  const deliverableIds = useMemo(() => deliverables.map((row) => row.id), [deliverables]);
  const deliverableReorder = useMemo(() => rowReorderColumn({
    listOf: (row) => (row.isLine ? { key: "lines", ids: [] } : { key: "deliverables", ids: deliverableIds }),
    onReorder: (key, ids) => void reorderDefinitions(key, ids),
    labelOf: (row) => row.name,
    disabled: saving || deliverablesSorted,
    disabledHint: deliverablesSorted ? SORTED_HINT : undefined,
  }), [deliverableIds, saving, deliverablesSorted]); // eslint-disable-line react-hooks/exhaustive-deps -- as `serviceReorder`
  // A deliverable's ⋮ - the table row's and its Board card's.
  const deliverableActionItems = useCallback((row) => [
    { label: "Edit", onSelect: () => { setDeliverableDraft(deliverablesById.get(row.id)); } },
    // A new deliverable started from this one: the Add dialog, filled from it, name left empty.
    { label: "Duplicate", onSelect: () => { setDeliverableDraft({ copyOf: deliverablesById.get(row.id) }); } },
    { label: "Delete", tone: "danger", onSelect: () => setConfirmRemoveDeliverable(deliverablesById.get(row.id)) },
  ], [deliverablesById]);

  const deliverableColumns = useMemo(() => [
    deliverableReorder,
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
        items={deliverableActionItems(row)}
      />),
    },
  ], [deliverableActionItems, deliverableReorder]);

  const servicesContent = <>
    <AddServiceForm
      value={serviceName}
      onChange={setServiceName}
      onAdd={() => { setServiceDraft({ name: serviceName.trim() }); }}
    />
    <div className="mb-2 flex justify-end"><TableBoardSwitch value={servicesLayout} onChange={setServicesLayout} /></div>
    {/* One row per service, at its one price. On the board, charged and complimentary apart. */}
    {servicesLayout === "board" ? <SettingsBoard
      rows={serviceRows}
      groupOf={(row) => (row.complimentary === "Yes" ? "Complimentary" : "Charged")}
      card={{ title: (row) => row.name, subtitle: (row) => row.price, meta: (row) => `Deliverable added: ${row.deliverableAdded}` }}
      // How many services in the column have no deliverable set up yet, and which: the same rule tags them.
      columnAmount={(rows) => columnCount(rows, (row) => Boolean(serviceFlag(row)), "No deliverable")}
      cardFlag={serviceFlag}
      onOpen={(row) => setServiceDraft(servicesById.get(row.id))}
      cardActions={serviceActionItems}
      onMove={(row, to) => setServiceDraft({ ...servicesById.get(row.id), complimentary: to === "Complimentary" })}
      noun="services"
      ariaLabel="Project service settings board"
    /> : <SettingsDataTable
      columns={serviceColumns}
      data={serviceRows}
      ariaLabel="Project service settings"
      emptyMessage="No services configured."
      density={density}
      getRowId={(row) => row.id}
      onSortChange={(sorting) => setServicesSorted(sorting.length > 0)}
    />}
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
        sold by nobody has no chevron: the row is all there is. On the board, by Image or Video. */}
    <div className="mb-2 flex justify-end"><TableBoardSwitch value={deliverablesLayout} onChange={setDeliverablesLayout} /></div>
    {deliverablesLayout === "board" ? <SettingsBoard
      rows={deliverableRows}
      groupOf={(row) => (row.type === "—" ? "" : row.type)}
      card={{ title: (row) => row.name, subtitle: (row) => (row.brandName === "—" ? "" : row.brandName), meta: (row) => [row.price === "—" ? "" : row.price, row.complimentary === "Yes" ? "Complimentary" : ""].filter(Boolean).join(" · ") }}
      onOpen={(row) => setDeliverableDraft(deliverablesById.get(row.id))}
      cardActions={(row) => (row.isLine ? null : deliverableActionItems(row))}
      onMove={(row, to) => setDeliverableDraft({ ...deliverablesById.get(row.id), mediaType: to === "Video" ? "VIDEO" : "IMAGE" })}
      noun="deliverables"
      ariaLabel="Project deliverable settings board"
    /> : <SettingsDataTable
      columns={deliverableColumns}
      data={deliverableRows}
      ariaLabel="Project deliverable settings"
      emptyMessage="No deliverables configured."
      density={density}
      getRowId={(row) => row.id}
      onSortChange={(sorting) => setDeliverablesSorted(sorting.length > 0)}
      expandable={{
        label: "what is sold under this row",
        getSubRows: (row) => row.brands || row.variants || [],
        canExpand: (row) => (row.brands || row.variants || []).length > 0,
      }}
    />}
  </>;

  const overlays = <>
    {serviceDraft && <ServiceDefinitionDialog
      service={serviceDraft.id ? serviceDraft : null}
      initialName={serviceDraft.id ? "" : (serviceDraft.name || "")}
      // Duplicate: a draft with no id of its own, so the dialog adds.
      copyOf={serviceDraft.copyOf || null}
      booleanOptions={booleanOptions}
      // So the service can name the exact deliverable variants it brings with it.
      deliverableDefinitions={deliverables}
      // Every other service's name, so a second "Demo Drone" is refused in the dialog rather than
      // by the server.
      takenNames={takenDefinitionNameKeys(services, serviceDraft.id || null)}
      saving={saving}
      error={dialogError}
      onClose={() => closeDefinitionDialog(() => setServiceDraft(null))}
      onSubmit={(values) => void submitService(values)}
    />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {deliverableDraft && <DeliverableDefinitionDialog
      deliverable={deliverableDraft.id ? deliverableDraft : null}
      initialName={deliverableDraft.id ? "" : (deliverableDraft.name || "")}
      copyOf={deliverableDraft.copyOf || null}
      brandSuggestions={deliverableBrandSuggestions}
      yesNoOptions={yesNoOptions}
      booleanOptions={booleanOptions}
      // Every other deliverable's name - see the service dialog's `takenNames`.
      takenNames={takenDefinitionNameKeys(deliverables, deliverableDraft.id || null)}
      saving={saving}
      error={dialogError}
      onClose={() => closeDefinitionDialog(() => setDeliverableDraft(null))}
      onSubmit={(values) => void submitDeliverable(values)}
    />}
    {confirmRemoveDeliverable && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title={`Remove "${confirmRemoveDeliverable.name}"?`}
      message="It stops appearing when a project is set up. Projects that already use it keep it, and adding a deliverable with the same name later brings it back."
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={saving}
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
      loading={saving}
      onCancel={() => setConfirmRemoveService(null)}
      onConfirm={() => void removeService(confirmRemoveService)}
    />}
  </>;

  /**
   * The two sections, stacked, as one scrolling document.
   *
   * Services and Deliverables one under the other, read by scrolling. Each row is written by its
   * own dialog, so there is no Save beneath them. Size Options used to be a third section here; the
   * size lists are still read by the pickers and suggested on pricing lines, but are not edited on
   * this screen any more.
   *
   * `idPrefix` lets the host name the anchors. Embedded in Settings, its rail entries scroll to
   * these ids, so they have to be the rail's own - `project-services` rather than `services`.
   */
  const stackedSections = (idPrefix = "") => <>
    <SchemaFormSection id={`${idPrefix}services`} title="Services" description={settingsHelpFor("project-services")} wide>
      {servicesContent}
    </SchemaFormSection>
    <SchemaFormSection id={`${idPrefix}deliverables`} title="Deliverables" description={settingsHelpFor("project-deliverables")} wide>
      {deliverablesContent}
    </SchemaFormSection>
  </>;

  if (embedded) return <>
    {overlays}
    {loading ? <Loader label="Loading project settings..." size="lg" className="h-full" /> : stackedSections(idPrefix)}
  </>;

  return <SchemaFormPanel
    title="Project Settings"
    descriptionAsTip
    description="Configure project service and deliverable master data."
    sections={sections}
    sidebarAriaLabel="Project settings sections"
    closeAriaLabel="Close project settings"
    onClose={requestClose}
    onSubmit={(event) => event.preventDefault()}
    error={error}
    footer={<>
      <Button type="button" onClick={requestClose} disabled={saving}>Close</Button>
    </>}
  >
    {overlays}
    {loading ? <Loader label="Loading project settings..." size="lg" className="h-full" /> : stackedSections()}
  </SchemaFormPanel>;
}
