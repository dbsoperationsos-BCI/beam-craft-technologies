"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { verticalOptions } from "@/lib/crmOptions";
import { columnCount } from "@/lib/kanbanSummary.mjs";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { ProjectRecordPanel } from "@/components/data-table/ProjectDataTable";
import { LeadPopupHost } from "@/components/sales/CRMPage";
import { commonProjectInfoSections, projectManagementInfoSections } from "@/constants/infoPanelConfig";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { ACTIONS_COLUMN, displayValue } from "@/components/data-table/tableCells";
import { getContacts } from "@/services/contacts/contacts.service";
import { getSalesProject } from "@/services/sales/projects.service";

/**
 * Contacts.
 *
 * Every phone number the application holds, from every module that holds one — HR's employees, the
 * CRM's leads, a project's client, a gallery's client, a vendor, a payee — as one directory. It
 * sits in the Sales & CRM section because that is where the studio looks somebody up, but it is
 * not the CRM's list: an employee and a lead are contacts of the studio in the same sense, and a
 * directory that could only see one module's would be a second lead list with fewer columns.
 *
 * One row is one **record**. A client who enquired for a wedding, enquired again for a shoot and
 * became a project is three rows, each under its own id, with its own name, its own vertical and its
 * own module — and each opening its own record.
 *
 * It used to be one row per person, grouped on the phone number, and the ids arrived stuck together
 * in one cell: `DBS-EID-DD-ERD-000012, DBS-EID-QQ-HYD-000007`. That cannot be filtered to one of the
 * two, cannot be sorted by either, exports as one string, and gave the row a single name and a
 * single vertical where the two enquiries have their own — and a double click had to pick one of
 * them, so the second was reachable from nowhere on this screen.
 *
 * The number is still what says which rows are one person: it is the Contact column, it is what a
 * reader filters by to bring somebody's rows together, and the server sorts on it so a person's
 * records arrive next to each other rather than a fortnight apart.
 *
 * Nothing on this page is entered: there is no contacts table, and no form to add to one. The
 * server reads each module's own rows live, so a number changed in the Employee Repository is
 * changed here, and a module the viewer may not read is not in the query at all.
 *
 * The page is the table and nothing else. No filter bar of its own and no search box: this is an
 * ordinary `DataTable`, so narrowing is the filter row under the headers, sorting is the header
 * arrows, and the ⋮ menu holds Manage Columns, compact view and Export CSV — the same controls, in
 * the same places, as every other table in the application.
 */

/**
 * The columns.
 *
 * Four are shown. **Module** is a fifth, off by default and turned on from Manage Columns: the
 * default view is the four the directory is about, and the answer to "where did this contact come
 * from" is one tick away for whoever needs it.
 *
 * Plain text throughout, drawn by the table's own cell renderer. Nothing here is a status or a
 * state, so nothing here is a badge — a tag around a vertical would give it a weight on the page
 * that a vertical does not have, and would read as a control rather than as a value.
 *
 * Every value goes through `displayValue`, the shared cell rule: an empty one reads as an em dash
 * rather than as a blank, the way it does in every other module's table. It is applied on the
 * accessor rather than in a renderer because that one string is the cell, what the filter row
 * matches on and what the CSV export carries — a cell showing "—" while its filter matched "" is
 * the kind of disagreement that reads as a broken filter. The hover title stays the raw value, so
 * a cell with nothing in it has no tooltip rather than one reading "—".
 */
const columns = [
  {
    id: "id",
    header: "ID",
    // This record's own id — the enquiry, the booking, the employee number. One per row, so it can
    // be filtered to and sorted by, which is most of what the column is read for.
    accessorFn: (row) => displayValue(row.id),
    title: (row) => row.id || undefined
  },
  { id: "name", header: "Name", accessorFn: (row) => displayValue(row.name), title: (row) => row.name || undefined },
  { id: "contact", header: "Contact", accessorFn: (row) => displayValue(row.contact) },
  {
    id: "verticals",
    header: "Verticals",
    // This record's own vertical. An em dash wherever the module keeps none — a vendor and a payee
    // have none — rather than a guess at one. The lead, quotation and project rows carry the
    // studio's own three.
    accessorFn: (row) => displayValue(row.verticals),
    title: (row) => row.verticals || undefined
  },
  { id: "module", header: "Module", accessorFn: (row) => displayValue(row.module), title: (row) => row.module || undefined },
];

/*
 * The row menu, and the table's own.
 *
 * `actions` is how every table in this application ends: the ⋮ in its header is where the shared
 * table controls live - Manage Columns, Export CSV - and the ⋮ on a row is where that row's own
 * actions do. This table declared neither, so it had the controls and nowhere to reach them from:
 * `columnVisibility` and `csvExport` were both on, and the menu that offers them is drawn in the
 * `actions` header, which did not exist.
 *
 * `ACTIONS_COLUMN` is the shared one every other module's table already ends with - 56px wide, out
 * of Manage Columns, neither sorted nor filtered nor resized. It was written out again here with
 * numbers of its own, which is how this table came to draw its menu column differently from the
 * rest of them.
 */

// What the record panel shows, in the shape it reads: one section, the four things a contact is
// plus where the studio holds them.
const CONTACT_SECTIONS = [
  {
    title: "Contact",
    fields: [
      ["id", "ID"],
      ["name", "Name"],
      ["contact", "Contact"],
      ["verticals", "Verticals"],
      ["module", "Module"],
    ],
  },
];

// Off until somebody asks for it, from the table's own Manage Columns dialog.
const DEFAULT_COLUMN_VISIBILITY = { module: false };
// A contact recorded in the last 30 days: the board's tag, and what each column counts.
const contactFlag = (row) => (Boolean(row.recordedAt) && Date.now() - new Date(row.recordedAt).getTime() <= 30 * 86_400_000 ? "New" : "");

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [result, setResult] = useState({ total: 0, capped: false });
  const [loading, setLoading] = useState(true);
  const [tableStats, setTableStats] = useState({ total: 0, showing: 0 });

  // A contact whose records live in modules with no screen of their own, opened here instead.
  const [viewingContact, setViewingContact] = useState(null);
  // The lead, and the project, a double click has opened - on this page, not on theirs.
  const [openLeadId, setOpenLeadId] = useState("");
  const [openProjectId, setOpenProjectId] = useState("");
  const [openProject, setOpenProject] = useState(null);

  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  // The density every other table in the application is read at, this one included: the rows here
  // are the same height, on the same padding, as the Reports and Leads tables beside them.
  const { density } = useCompactView();
  const { hasPermission } = usePermissions();

  const canReadLeads = hasPermission("SALES", "CRM Leads", "READ");
  const canWriteLeads = hasPermission("SALES", "CRM Leads", "READ_WRITE");
  const canPlanProjects = hasPermission("PROJECT", "Projects", "READ");
  const canReadProjects = canPlanProjects || hasPermission("SALES", "Sales Manager", "READ");
  const canReadCash = hasPermission("ACCOUNTS", "Cash Management", "READ");

  /**
   * Double-clicking a contact opens the record it came from, here.
   *
   * The same gesture the rest of the application uses to open a row, showing the same thing it
   * shows there: a contact that came from a lead opens the CRM's own lead popup, and one that came
   * from a project opens that project's record. What it no longer does is *go* there. A directory
   * is a place somebody looks a person up mid-something-else, and answering a look-up by navigating
   * away from the list - onto another module's board, filtered to another vertical, with the list
   * they were reading gone - is a worse answer than the record itself. Both are rendered on this
   * page instead, over the table they were opened from, and closing one puts the reader back on
   * the row they double-clicked.
   *
   * The lead comes first where a person is both: it is the fuller record, and it is the one this
   * directory is most often read beside.
   *
   * A contact with neither - an employee, a vendor, a payee - has no such record, so rather than a
   * gesture that does nothing it opens the contact itself in the application's own record panel.
   *
   * Each is offered only to somebody who may read it. The permission is the module's own, and it
   * is the backend that enforces it - the popups here read through the same guarded endpoints, so
   * a contact whose lead this viewer may not open falls back to the contact panel rather than to a
   * screen that refuses them.
   */
  const openContact = useCallback((contact) => {
    if (contact?.leadId && canReadLeads) {
      setOpenLeadId(contact.leadId);
      return;
    }
    if (contact?.projectId && canReadProjects) {
      setOpenProjectId(contact.projectId);
      return;
    }
    setViewingContact(contact || null);
  }, [canReadLeads, canReadProjects]);

  /**
   * The number on this row, on the clipboard.
   *
   * The one thing a directory is opened for that reading it does not finish: somebody looks a
   * person up in order to dial or paste their number somewhere else. Said out loud either way -
   * a copy that silently did or did not happen is indistinguishable from a menu item that does
   * nothing, and a browser that refuses the clipboard is a real answer worth giving.
   */
  const copyNumber = useCallback(async (contact) => {
    const number = String(contact?.contact || "").trim();
    if (!number) {
      showError("This contact has no number to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(number);
      showSuccess(`${number} copied.`);
    } catch {
      showError("Unable to copy. Select the number and copy it manually.");
    }
  }, [showError, showSuccess]);

  /**
   * The columns, with the row menu built in.
   *
   * Assembled here rather than declared beside the other four because the menu answers to this
   * page's own handlers, and a column list built in the module scope cannot see them.
   *
   * **View** leads, the way it does on the project register: a double click opens the record, and on
   * a touch screen a double click is the browser's zoom gesture - so the menu is the only way in
   * there, and it opens exactly what the gesture opens. **Copy Number** is the directory's own
   * action, and the only thing here that is not simply reading.
   *
   * Nothing else is offered because there is nothing else to offer: no contact is created, edited
   * or deleted on this page - a contact is what a phone number's records add up to - so an Edit or
   * a Delete would be a menu item promising something this screen cannot do.
   */
  // One list, read by the table row's ⋮ and the Board card's.
  const contactActionItems = useCallback((row) => [
    { label: "View", onSelect: () => openContact(row) },
    { label: "Copy Number", disabled: !String(row.contact || "").trim(), onSelect: () => void copyNumber(row) },
  ], [copyNumber, openContact]);
  const tableColumns = useMemo(() => [...columns, {
    ...ACTIONS_COLUMN,
    render: (row) => <OptionsMenu
      ariaLabel={`Actions for ${row.name || row.id}`}
      menuClassName="w-44"
      /*
       * A smaller trigger than the default, because on this table it is what sets the row height.
       * Every cell beside it is one line of text; the ⋮ at its usual size is half again as tall as
       * that, so the rows stood well clear of the ones on the report beside them. At this size the
       * menu still has a comfortable target and the row is the height of its own type.
       */
      triggerSize="xxs"
      items={contactActionItems(row)}
    />,
  }], [contactActionItems]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getContacts();
      setContacts(Array.isArray(response?.data) ? response.data : []);
      setResult({ total: Number(response?.total) || 0, capped: Boolean(response?.capped) });
    } catch (error) {
      setContacts([]);
      setResult({ total: 0, capped: false });
      showError(error?.message || "Unable to load the contacts.");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  /*
   * Deferred a tick, which is this codebase's convention for a first load: a fetch started straight
   * from an effect body counts as state set during that effect, and React warns about the
   * cascading render it causes.
   */
  useEffect(() => {
    const timer = setTimeout(() => void loadContacts(), 0);
    return () => clearTimeout(timer);
  }, [loadContacts]);

  /*
   * The project behind a double-clicked contact.
   *
   * Read by its Event ID alone (`getSalesProject`), in the register's own shape - the shoots, the
   * services and the deliverables the record view lays out - rather than the whole register
   * downloaded to pick one out. Read on the double click rather than with the directory, so a page
   * nobody opens a project from never asks for one.
   */
  useEffect(() => {
    if (!openProjectId) return undefined;
    let active = true;
    void getSalesProject(openProjectId)
      .then((response) => {
        if (!active) return;
        const match = response?.data || null;
        setOpenProject(match);
        // Said out loud rather than left as a double click that opened nothing: a project deleted
        // since the directory was read is a real answer, and the row is still honest about the
        // number it holds. The id is dropped with it, so the row can be tried again rather than
        // being stuck on an open request that already failed.
        if (!match) { setOpenProjectId(""); showError("That project could not be found."); }
      })
      .catch((error) => {
        if (!active) return;
        setOpenProjectId("");
        showError(error?.status === 404 ? "That project could not be found." : error?.message || "That project could not be opened.");
      });
    return () => { active = false; };
  }, [openProjectId, showError]);

  const closeProject = useCallback(() => {
    setOpenProjectId("");
    setOpenProject(null);
  }, []);

  /*
   * Stable, because the lead popup reads its lead in an effect that depends on them: handlers
   * rebuilt on every render would re-run that effect on every render, which is a fetch loop.
   */
  const closeLead = useCallback(() => setOpenLeadId(""), []);
  // A lead edited in the popup can change the name or the number this directory shows for that
  // person, so the list is re-read rather than left saying what it said before.
  const reloadAfterLeadChange = useCallback(() => void loadContacts(), [loadContacts]);

  /*
   * The leads Back and "Update and Proceed Next" step through, in the order the directory holds
   * them: the contacts that came from a lead, which is the queue a reader working down this list
   * is actually working. Without one the popup's two stepping buttons would have nowhere to go.
   */
  const leadQueue = useMemo(
    // Deduped: a lead can only appear on one row now, but the queue is what Back and "Update and
    // Proceed Next" walk, and a repeated id there is a step that appears to do nothing.
    () => [...new Set(contacts.map((contact) => contact.leadId).filter(Boolean))],
    [contacts],
  );

  // The row count the filter row has left, which is what a reader of a filtered table wants; the
  // directory's own size is only worth saying while it differs from it.
  const showingAll = tableStats.total === contacts.length;

  const footer = useMemo(() => <TableFooter spread>
    <span>{result.capped ? `First ${contacts.length.toLocaleString()} of ${result.total.toLocaleString()} contacts` : "All modules"}</span>
    <span>
      {showingAll
        ? `Total rows: ${tableStats.total.toLocaleString()}`
        : `${tableStats.total.toLocaleString()} of ${contacts.length.toLocaleString()} rows`}
    </span>
  </TableFooter>, [contacts.length, result.capped, result.total, showingAll, tableStats.total]);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * No `prefix`, so the selection offers Export and nothing else - and that is the whole of what it
   * should offer here. The directory is derived: a contact is whatever phone number a record
   * somewhere else in the application carries, so there is no contact to delete - the record it came
   * from is, on the screen that owns it.
   */
  const bulk = useTableSelection({ rows: contacts, rowId: (row) => row.key, noun: "contact" });

  /*
   * The Board: the same contacts in a column per vertical - the studio's three first, anything
   * else A to Z, and the records with none (a vendor, a payee) under "—". A contact has no status
   * and nothing here changes one, so it is a view only; a card opens the record as a double click
   * on its row does.
   */
  const [layout, setLayout] = useTableBoardLayout("sales-contacts");
  const boardColumns = useMemo(() => columnsFromRows(contacts, (row) => row.verticals, { order: verticalOptions.map((option) => option.value) }), [contacts]);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader title="Contacts" actions={<TableBoardSwitch value={layout} onChange={setLayout} />} />

    <FloatingNotice notice={notice} onClose={clearNotice} />

    {/*
      Straight under the header, with no gap and no card around it.

      The shell is the module tables' own: `rounded-none border-0` and filling what is left of the
      page, the way Vendor Management and Asset Management draw theirs. Held in a padded box with a
      rounded border instead, the table read as a panel sitting on the page rather than as the page
      — a seam under the header that no other module's table has.
    */}
    {layout === "board" ? <KanbanBoard
      rows={contacts}
      columns={boardColumns}
      statusOf={(row) => groupValue(row.verticals)}
      // The trend counts contacts by when their record was made.
      dateOf={(row) => (row.recordedAt ? new Date(row.recordedAt).getTime() : null)}
      // Under each vertical, the contacts recorded in the last 30 days.
      columnAmount={(rows) => columnCount(rows, (row) => Boolean(contactFlag(row)), "New in last 30 days")}
      cardFlag={contactFlag}
      card={{ title: (row) => row.name, subtitle: (row) => [row.id, row.contact].filter(Boolean).join(" · "), meta: (row) => row.module }}
      getRowId={(row) => row.key}
      onOpen={openContact}
      // The card's ⋮ is the row's ⋮.
      cardActions={contactActionItems}
      viewOnly="A contact's vertical comes from its lead. Change it in Leads & Followups."
      loading={loading}
      noun="contacts"
      ariaLabel="Contacts board"
    /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-0" footer={footer}>
      {/* The pane every other module's table sits in, so the rows scroll inside the shell rather
          than the shell growing with them. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={tableColumns}
          data={contacts}
          density={density}
          loading={loading}
          loadingMessage="Loading contacts..."
          emptyMessage="No contacts yet. They appear here as soon as a record anywhere in the application carries a phone number."
          noMatchMessage="No contacts match that filter."
          defaultColumnVisibility={DEFAULT_COLUMN_VISIBILITY}
          /*
           * The row's key is the server's `key` — its source and its id — rather than the id alone.
           * An id is unique within the module that issued it and this list crosses eight of them, so
           * two could collide; a duplicate key silently drops a row, which on a directory is a
           * contact nobody can find with nothing to say so.
           */
          getRowId={(row) => row.key}
          // Double click opens the record the contact came from; see `openContact`.
          onRowDoubleClick={openContact}
          onVisibleRowsChange={setTableStats}
          ariaLabel="Contacts"
          features={{
            filtering: true,
            sorting: true,
            columnVisibility: true,
            infiniteScroll: { pageSize: 50 },
            csvExport: { enabled: true, fileName: "contacts" },
            selection: bulk.selection,
          }}
        />
      </div>
    </DataTableShell>}

    {/* The CRM's own lead popup, opened here rather than on the CRM board. It reads and writes the
        lead through the same endpoints that board does, so what is done in it is done to the lead
        - this is the popup, not a copy of it. */}
    {openLeadId && <LeadPopupHost
      key={openLeadId}
      leadId={openLeadId}
      queue={leadQueue}
      canWrite={canWriteLeads}
      onOpenLead={setOpenLeadId}
      onClose={closeLead}
      onNotice={showNotice}
      onError={showError}
      onChanged={reloadAfterLeadChange}
    />}

    {/* And the project record, the same one Project Management's own double click opens. */}
    {openProjectId && openProject && <ProjectRecordPanel
      project={openProject}
      // Project Management reads the fuller list of fields; a viewer who only holds Sales Manager
      // sees the sale's own, exactly as they would on their own register.
      sections={canPlanProjects ? projectManagementInfoSections : commonProjectInfoSections}
      projectManagement={canPlanProjects}
      // The Payments tab is Accounts' figures, so it takes Accounts' own permission as well.
      showPayments={canReadCash}
      onClose={closeProject}
    />}

    {/* The application's own record panel, so a contact with no module screen still opens the way
        every other double click in the OS does. */}
    {viewingContact && <RecordViewPanel
      title={viewingContact.name || "Contact"}
      description={viewingContact.contact || undefined}
      entity={{
        id: viewingContact.id,
        name: viewingContact.name,
        contact: viewingContact.contact,
        verticals: viewingContact.verticals,
        module: viewingContact.module,
      }}
      sections={CONTACT_SECTIONS}
      sidebarAriaLabel="Contact sections"
      onClose={() => setViewingContact(null)}
    />}
  </section>;
}
