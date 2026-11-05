"use client";

import { usePreference } from "@/components/preferences/PreferencesProvider";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { TableCellValue } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import { crdDocumentInfoSections } from "@/constants/infoPanelConfig";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Tabs from "@/components/ui/Tabs";
import useCompactView from "@/components/shared/useCompactView";
import CrdTermsSettingsPanel from "./CrdTermsSettingsPanel";
import CrdDocumentViewPanel from "./CrdDocumentViewPanel";
import CrdLinkReadyDialog from "./CrdLinkReadyDialog";
import { verticalLabel } from "./whatsappGroupNameUtils";
import { createCrdDocumentLink, getCrdDocuments } from "@/services/sales/crd-documents.service";
import { publicOrigin } from "@/lib/publicOrigin";
import { columnCount, daysSince } from "@/lib/kanbanSummary.mjs";

// The origin the client's link is built on, resolved exactly the way the public quotation link is,
// so both public URLs point at the same place and default to HTTPS in production.

const crdDocumentColumns = [
  // The document's own identifier - DBS-CRD-DD-000001 - ahead of the project's, because this table
  // is a list of documents. Empty until the link has been issued, which is when the document starts
  // existing; the Event ID beside it is what a project is called before that.
  { id: "documentCode", label: "CRD ID" },
  { id: "eventId", label: "Event ID" },
  { id: "enquiryId", label: "Enquiry ID" },
  { id: "clientName", label: "Client Name" },
  { id: "clientMainNumber", label: "Contact Number" },
  { id: "sourceBranch", label: "Nearest Branch" },
  { id: "vertical", label: "Vertical" },
  /*
   * Who the document is on: the project's **pre-production coordinator**.
   *
   * Not a field of its own. That person is already named on the project and is already one of the five
   * columns the data scope narrows the register by, which is why this row reaches this reader at all - so
   * the column shows the fact that was already deciding what is on screen. Without it, a list narrowed to
   * the reader's own work looked exactly like a list of everybody's.
   */
  { id: "assignedTo", label: "Assigned To" },
  // Where the row came from: "Project" is one Start / Edit Project raised, "Manual" one raised
  // here from Create CRD Document.
  { id: "type", label: "Type" },
  { id: "receivedAt", label: "Received At", type: "date" },
  { id: "status", label: "Status" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

const crdDocumentTabs = ["All", "Submitted", "Yet To Receive", "Link Not sent"];

/*
 * ── One list, both verticals ──────────────────────────────────────────────────────────────────
 *
 * There was a picker beside the heading and the table showed one vertical at a time, on the argument
 * that a document belongs to one vertical or the other and the two are read by different people. What
 * that cost was worse than what it bought: the page opened on Dum Dum, so Qua Qua's documents were
 * behind a control, and a reader who did not notice it saw a list that was simply missing rows - with
 * status tabs counting confidently over the half they could see.
 *
 * The vertical is a **column** on the row, and it always was: sortable and filterable like every other
 * column, so somebody who wants one vertical narrows that column and somebody who wants the whole of
 * what the studio is owed does nothing at all.
 */

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function displayValue(row, column) {
  const value = row[column.id];
  if (column.type === "date") return formatDate(value);
  // Stored as WED / QQ / CORP; read as Dum Dum / Qua Qua / Corp.
  if (column.id === "vertical") return verticalLabel(value) || "-";
  // A standalone document belongs to no project, so it has no coordinator to name - and a project that
  // has not been staffed yet has none either. Both read as a dash rather than borrowing somebody.
  if (column.id === "assignedTo") return value || "-";
  return value || "-";
}

// Same dot-and-label status cell the Employee Repository uses, so a status reads the same way
// everywhere in the OS.
const statusStyles = { Submitted: "bg-emerald-500", "Yet To Receive": "bg-amber-500", "Link Not sent": "bg-slate-400" };

/** A project's row whose link has not gone out yet: Create Link, which issuing it marks Sent. */
const linkNotSent = (row) => !row.standalone && row.status === "Link Not sent";

/*
 * The Board: a column per status, in the tabs' order and colours. A card opens the document, as a
 * double-click does. The one move a person makes here is Create Link - issuing the link marks it
 * sent - so a project's card whose link has not gone out may be dropped on Yet To Receive, for
 * whoever may write, and the link is issued and handed over exactly as the ⋮ does. Submitted is the
 * client's to reach, so it takes no drop.
 */
// In the document's flow: no link yet, sent and waiting, filled in - the reverse of the tabs.
const BOARD_COLUMNS = ["Link Not sent", "Yet To Receive", "Submitted"].map((tab) => ({ value: tab, label: tab, className: `${statusStyles[tab] || "bg-slate-400"} text-white` }));
const boardStatusOf = (row) => row.status;
// One rule for the tag and the count: more than 7 days since the document was raised (no link-sent
// date is kept), outside Submitted, which is done.
const WAITING_DAYS = 7;
const documentFlag = (row, column) => {
  if (column.value === "Submitted") return "";
  const days = daysSince(row.crdDocument?.createdAt || row.createdAt);
  return days !== null && days > WAITING_DAYS ? `Waiting ${days} days` : "";
};
const documentColumnFigure = (rows, column) => (column.value === "Submitted" ? null
  : columnCount(rows, (row) => Boolean(documentFlag(row, column)), `Waiting ${WAITING_DAYS}+ days`, `Cards in this column waiting more than ${WAITING_DAYS} days`));
const BOARD_CARD = {
  title: (row) => row.clientName || row.eventId || "CRD document",
  subtitle: (row) => [row.documentCode || row.eventId || row.enquiryId, row.assignedTo].filter(Boolean).join(" · "),
  meta: (row) => (row.receivedAt ? `Received ${formatDate(row.receivedAt)}` : row.verticalLabel || ""),
};

export default function CrdDocumentsPage() {
  // PROJECT / CRD Documents. Sending a link issues a document to a client, so it is a write.
  const { canWrite } = useRouteAccess();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  /*
   * ── My Documents ──────────────────────────────────────────────────────────────────────────────
   *
   * The scope widens "mine" to "mine and my team's" - it follows `reportsToEmployeeId` the whole way down,
   * so a manager four levels above a coordinator sees their documents. That is the right default and it is
   * also why a coordinator who has a team of their own cannot find their own work in it.
   *
   * On, the list is the documents this reader is the **pre-production coordinator** for, which is the owner
   * the Assigned To column names. Remembered per person, the way the CRM board remembers its own: somebody
   * who works their own list should not turn it on every morning.
   */
  const [mineOnly, setMineOnly] = usePreference("crd:my-documents", false);
  /*
   * Whether anybody is under this reader, answered by the server because it is what knows the org chart.
   * For everybody else the two states are the same list, and a switch that changes nothing invites a reader
   * to flip it, see no difference and conclude the screen is broken.
   */
  const [managesAnyone, setManagesAnyone] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [activeTab, setActiveTab] = useState("All");
  const [configuringTerms, setConfiguringTerms] = useState(false);
  const [sendLinkProject, setSendLinkProject] = useState(null);
  // The issued link for the row in the dialog.
  const [sendLinkUrl, setSendLinkUrl] = useState("");
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCrdDocuments({ mine: mineOnly });
      // Whether this reader has a team, which is the only case the switch means anything in - answered by
      // the server, which is what knows the org chart.
      setManagesAnyone(Boolean(response?.managesAnyone));
      // The stored code is what the table sorts and filters on; `verticalLabel` is the name the
      // info panel and the record view read, which take their values off the row as they are.
      setDocuments(Array.isArray(response?.data) ? response.data.map((document) => ({ ...document, verticalLabel: verticalLabel(document.vertical) })) : []);
      setLastUpdated(new Date());
    } catch (error) {
      showError(error.message || "Unable to load CRD documents.");
    } finally {
      setLoading(false);
    }
    // `mineOnly` is a dependency, so flipping the switch re-reads: the rows are a different set and the
    // server is the only thing that knows who each document is on.
  }, [showError, mineOnly]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  /**
   * Create Link / Send Link: the client's link, then CRD Link Ready with it written as the message.
   *
   * **Create Link** is offered on a row whose link has not gone out - no document yet, or one raised
   * when the project answered "Applicable" and never sent. Issuing it is sending it: the server marks
   * the document Sent, so the row moves to Yet To Receive the moment the link exists, and the dialog
   * is how it then reaches the client. **Send Link** on a row already further along - or a document
   * created on this screen, which is issued with its link - shows the link it has, for sending again.
   * The backend hands back the same token every time, so the client's link is never replaced.
   */
  const openSendLink = useCallback(async (project) => {
    if (!linkNotSent(project)) {
      setSendLinkUrl(`${publicOrigin()}${project.crdDocument?.publicPath || ""}`);
      setSendLinkProject(project);
      return;
    }
    try {
      const response = await createCrdDocumentLink(project.id);
      setDocuments((current) => current.map((document) => document.id === project.id ? { ...document, status: "Yet To Receive", documentCode: response?.data?.documentCode || document.documentCode, crdDocument: response?.data || document.crdDocument } : document));
      setSendLinkUrl(`${publicOrigin()}${response?.data?.publicPath || ""}`);
      setSendLinkProject(project);
    } catch (error) {
      showError(error.message || "Unable to create the CRD document link.");
    }
  }, [showError]);

  function closeSendLink() {
    setSendLinkProject(null);
    setSendLinkUrl("");
  }

  // Single click selects the row and fills the panel beside it; double-click reads the document
  // back in full. The same pair every other table in the OS answers to.
  const [infoDocument, setInfoDocument] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [viewingDocument, setViewingDocument] = useState(null);

  // One list for the row's ⋮ and the board card's ⋮.
  const documentActions = useCallback((document) => [
    // Always offered, whatever the reader may change: on a touch screen this is the only way into
    // the record view, since a double-click there is the browser's own zoom gesture.
    { label: "View", onSelect: () => setViewingDocument(document) },
    // Only once there is a response to share. View is where the link is issued and copied, so
    // this is the same destination by a name that says what it is for.
    ...(document.crdDocument?.submittedAt ? [{ label: "Share Response", onSelect: () => setViewingDocument(document) }] : []),
    // Create Link while the link has not gone out; Send Link once it has, to send it again.
    ...(canWrite ? [{ label: linkNotSent(document) ? "Create Link" : "Send Link", onSelect: () => void openSendLink(document) }] : []),
  ], [canWrite, openSendLink]);

  const columns = useMemo(() => crdDocumentColumns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    cell: column.id === "status" ? ({ row }) => <TableCellValue value={row.original.status} type="status" statusStyles={statusStyles} /> : column.id === "actions" ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.eventId || "CRD document"}`} items={documentActions(row.original)} /> : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 180,
    minWidth: column.id === "actions" ? 56 : 150,
  })), [documentActions]);

  // The tabs count the list, which is now the whole list - the same rule as before, with nothing
  // narrowing it above them.
  const tabCounts = useMemo(() => Object.fromEntries(crdDocumentTabs.map((tab) => [
    tab,
    tab === "All" ? documents.length : documents.filter((document) => document.status === tab).length,
  ])), [documents]);

  const visibleDocuments = useMemo(() => activeTab === "All" ? documents : documents.filter((document) => document.status === activeTab), [activeTab, documents]);

  const [layout, setLayout] = useTableBoardLayout("sales-crd-documents");
  const onBoard = layout === "board";
  const canDropAt = useCallback((row, to) => canWrite && to === "Yet To Receive" && linkNotSent(row), [canWrite]);
  const dropDocument = useCallback((row) => void openSendLink(row), [openSendLink]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "-";

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * No `prefix`, so the selection offers Export and nothing else - and that is the whole of what it
   * should offer here. A CRD document is the client's own submission against an enquiry, and the
   * module has no delete for one - it is superseded, not removed.
   */
  const bulk = useTableSelection({ rows: visibleDocuments, noun: "document" });

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="CRD Documents"
      /*
       * `leadingActions`, which is where the CRM board draws its own **My Leads** switch - the slot for a
       * control that scopes what the page is *showing* rather than doing something to it, sitting with the
       * actions on the right and ahead of the quiet Nebula icon because everything after that icon is an
       * action and this is not one.
       *
       * Drawn only for a reader with somebody under them - see `managesAnyone`.
       */
      leadingActions={managesAnyone && <ToggleSwitch
        label="My Documents"
        ariaLabel="Show only the documents assigned to you, or all of them"
        title={mineOnly
          ? "Showing only documents you are the pre-production coordinator for. Turn off to see everything you have access to."
          : "Showing every document you have access to. Turn on to see only the ones you are the pre-production coordinator for."}
        checked={mineOnly}
        onCheckedChange={(next) => {
          setMineOnly(next);
          // The rows are about to be a different set, so a selection made against the old one is dropped -
          // the same thing the CRM board does when its own switch moves.
          bulk.clear?.();
        }}
      />}
      /*
       * Settings, and nothing else.
       *
       * There was a Create CRD Document button here and it has gone. A CRD is asked *of a project*:
       * every row on this screen is a booking that owes one, and the document is raised for it by
       * Send Link on that row - which is where the link the client actually receives comes from. A
       * second way in created a document belonging to no project, which then had no Event ID, no
       * Enquiry ID and nothing to attach the client's answers back to.
       */
      actions={<TableBoardSwitch value={layout} onChange={setLayout} />}
      // The ⋮ in the header's own slot, so the row ends Nebula, then ⋮.
      menu={canWrite ? <OptionsMenu ariaLabel="CRD Documents settings" items={[{ label: "Settings", onSelect: () => setConfiguringTerms(true) }]} /> : undefined}
      // The Board stands every document under its status, so the status tabs step aside while it shows.
      tabs={onBoard ? undefined : crdDocumentTabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="CRD document status filters"
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {onBoard ? documents.length : tableStats.total}</span></TableFooter>}>
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {onBoard ? <KanbanBoard
          rows={documents}
          columns={BOARD_COLUMNS}
          statusOf={boardStatusOf}
          // How many have sat 7+ days since the document was raised, and each of them tagged with how long.
          columnAmount={documentColumnFigure}
          cardFlag={documentFlag}
          card={BOARD_CARD}
          onOpen={setViewingDocument}
          // The card's ⋮ is the row's ⋮.
          cardActions={documentActions}
          canDropAt={canDropAt}
          onDrop={dropDocument}
          loading={loading}
          noun="documents"
          ariaLabel="CRD documents board"
        /> : <div className="flex min-h-0 min-w-0 flex-1">
        <DataTable
          columns={columns}
          data={visibleDocuments}
          density={density}
          loading={loading}
          loadingMessage="Loading CRD documents..."
          emptyMessage="Received CRD documents will appear here."
          noMatchMessage="No CRD documents found."
          onVisibleRowsChange={setTableStats}
          selectedRowId={infoDocument?.id}
          onRowClick={(row) => { setInfoDocument(row); setInfoPanelState("expanded"); }}
          onRowDoubleClick={setViewingDocument}
          ariaLabel="CRD documents table"
          features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: "crd-documents", onResult: (exported) => showNotice(exported ? "CRD Documents CSV export downloaded." : "No CRD documents available to export.") }, selection: bulk.selection }}
        />
        </div>}
        <DataTableInfoPanel
          title="CRD Document"
          entity={infoDocument}
          sections={crdDocumentInfoSections}
          emptyText="Select a CRD document row to view details."
          state={infoPanelState}
          onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
        />
        </div>
      </DataTableShell>
    </div>
    {/* View is the client's answers, not the row's own fields — those are already in the Info
        panel beside the table, and repeating them was all View used to do. */}
    {viewingDocument && <CrdDocumentViewPanel row={viewingDocument} onClose={() => setViewingDocument(null)} />}
    {configuringTerms && <CrdTermsSettingsPanel onClose={() => setConfiguringTerms(false)} />}
    {sendLinkProject && <CrdLinkReadyDialog row={sendLinkProject} link={sendLinkUrl} onClose={closeSendLink} />}
  </section>;
}
