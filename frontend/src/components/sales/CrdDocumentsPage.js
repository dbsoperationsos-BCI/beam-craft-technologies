"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { TableCellValue } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import { crdDocumentInfoSections } from "@/constants/infoPanelConfig";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Tabs from "@/components/ui/Tabs";
import useCompactView from "@/components/shared/useCompactView";
import DropdownMenu from "@/components/ui/DropdownMenu";
import CrdTermsSettingsPanel from "./CrdTermsSettingsPanel";
import CrdDocumentViewPanel from "./CrdDocumentViewPanel";
import { verticalLabel } from "./whatsappGroupNameUtils";
import { createCrdDocumentLink, getCrdDocuments } from "@/services/sales/crd-documents.service";
import { publicOrigin } from "@/lib/publicOrigin";

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
  // Where the row came from: "Project" is one Start / Edit Project raised, "Manual" one raised
  // here from Create CRD Document.
  { id: "type", label: "Type" },
  { id: "receivedAt", label: "Received At", type: "date" },
  { id: "status", label: "Status" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

const crdDocumentTabs = ["All", "Submitted", "Yet To Receive", "Link Not sent"];

/*
 * The vertical the table is narrowed to, beside the heading.
 *
 * The two verticals that have a CRD document between them, and nothing else: a document is one
 * vertical's or the other's, and the two are read by different people. There is deliberately no
 * "All" - the table always shows one vertical - and no Corp, which does not collect this document.
 */
const verticalFilters = [
  { value: "WED", label: "Dum Dum" },
  { value: "QQ", label: "Qua Qua" },
];

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
  return value || "-";
}

// Same dot-and-label status cell the Employee Repository uses, so a status reads the same way
// everywhere in the OS.
const statusStyles = { Submitted: "bg-emerald-500", "Yet To Receive": "bg-amber-500", "Link Not sent": "bg-slate-400" };

export default function CrdDocumentsPage() {
  // PROJECT / CRD Documents. Sending a link issues a document to a client, so it is a write.
  const { canWrite } = useRouteAccess();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [activeTab, setActiveTab] = useState("All");
  const [activeVertical, setActiveVertical] = useState("WED");
  const [configuringTerms, setConfiguringTerms] = useState(false);
  const [sendLinkProject, setSendLinkProject] = useState(null);
  // The issued link for the row in the dialog.
  const [sendLinkUrl, setSendLinkUrl] = useState("");
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCrdDocuments();
      // The stored code is what the table sorts and filters on; `verticalLabel` is the name the
      // info panel and the record view read, which take their values off the row as they are.
      setDocuments(Array.isArray(response?.data) ? response.data.map((document) => ({ ...document, verticalLabel: verticalLabel(document.vertical) })) : []);
      setLastUpdated(new Date());
    } catch (error) {
      showError(error.message || "Unable to load CRD documents.");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  /**
   * Issues the client's link and opens the dialog with it already in hand.
   *
   * Done here rather than in an effect once the dialog is open, so the URL is on screen the moment
   * it appears and a failure is reported before anything opens. The backend hands back the same
   * token every time, so pressing this again re-copies the existing link rather than replacing the
   * one the client may already be holding.
   */
  const openSendLink = useCallback(async (project) => {
    // A document created from this screen already has its link and no project to issue one for, so
    // Send Link on one of those rows shows the link it was given rather than asking for another.
    if (project.standalone || project.crdDocument?.publicPath) {
      setSendLinkUrl(`${publicOrigin()}${project.crdDocument?.publicPath || ""}`);
      setSendLinkProject(project);
      return;
    }
    try {
      const response = await createCrdDocumentLink(project.id);
      setDocuments((current) => current.map((document) => document.id === project.id ? { ...document, status: "Yet To Receive", crdDocument: response?.data || document.crdDocument } : document));
      setSendLinkUrl(`${publicOrigin()}${response?.data?.publicPath || ""}`);
      setSendLinkProject(project);
    } catch (error) {
      showError(error.message || "Unable to create the CRD document link.");
    }
  }, [showError]);

  /**
   * Sends the link to the client, on WhatsApp, with the message already written.
   *
   * `wa.me` opens WhatsApp on whatever the person is using - the desktop app, the browser, the phone
   * - with the client's number and the message filled in, and **they press send**. It is not an
   * automated send and must not become one: the studio's number is a real account and bulk or
   * unattended sending from it is what gets a number banned. The Image Selection gallery share works
   * exactly this way, and this is that same pattern rather than a second one.
   *
   * The number is kept as the studio stores it and stripped of everything that is not a digit -
   * `wa.me` wants a country code and digits, no `+` and no spaces. Absent where there is no number
   * to send to, rather than offered and refused.
   */
  function whatsappShareUrl() {
    const digits = String(sendLinkProject?.clientMainNumber || "").replace(/\D/g, "");
    if (!digits || !sendLinkUrl) return "";
    const name = String(sendLinkProject?.clientName || "").trim();
    const text = [
      name ? `Hi ${name},` : "Hi,",
      "",
      "Please fill in your Customer Identification Document here:",
      sendLinkUrl,
      "",
      "It opens without a sign-in and saves as you go, so you can come back to it.",
    ].join("\n");
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  function closeSendLink() {
    setSendLinkProject(null);
    setSendLinkUrl("");
  }

  async function copySendLink() {
    try {
      await navigator.clipboard.writeText(sendLinkUrl);
      showNotice("CRD document link copied.");
    } catch {
      showError("Unable to copy. Select the link manually.");
    }
  }

  // Single click selects the row and fills the panel beside it; double-click reads the document
  // back in full. The same pair every other table in the OS answers to.
  const [infoDocument, setInfoDocument] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [viewingDocument, setViewingDocument] = useState(null);

  const columns = useMemo(() => crdDocumentColumns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    cell: column.id === "status" ? ({ row }) => <TableCellValue value={row.original.status} type="status" statusStyles={statusStyles} /> : column.id === "actions" ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.eventId || "CRD document"}`} items={[
      // Always offered, whatever the reader may change: on a touch screen this is the only way into
      // the record view, since a double-click there is the browser's own zoom gesture.
      { label: "View", onSelect: () => setViewingDocument(row.original) },
      // Only once there is a response to share. View is where the link is issued and copied, so
      // this is the same destination by a name that says what it is for.
      ...(row.original.crdDocument?.submittedAt ? [{ label: "Share Response", onSelect: () => setViewingDocument(row.original) }] : []),
      ...(canWrite ? [{ label: "Send Link", onSelect: () => void openSendLink(row.original) }] : []),
    ]} /> : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 180,
    minWidth: column.id === "actions" ? 56 : 150,
  })), [canWrite, openSendLink]);

  // The vertical narrows the table first and the status tabs count within it, so the numbers on the
  // tabs always describe what the reader is actually looking at.
  const verticalDocuments = useMemo(() => documents.filter((document) => String(document.vertical || "").toUpperCase() === activeVertical), [activeVertical, documents]);

  const tabCounts = useMemo(() => Object.fromEntries(crdDocumentTabs.map((tab) => [
    tab,
    tab === "All" ? verticalDocuments.length : verticalDocuments.filter((document) => document.status === tab).length,
  ])), [verticalDocuments]);

  const visibleDocuments = useMemo(() => activeTab === "All" ? verticalDocuments : verticalDocuments.filter((document) => document.status === activeTab), [activeTab, verticalDocuments]);

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
      titleAddon={<div className="border-l border-slate-200 pl-3"><DropdownMenu ariaLabel="Vertical" items={verticalFilters} value={activeVertical} onChange={setActiveVertical} /></div>}
      /*
       * Settings, and nothing else.
       *
       * There was a Create CRD Document button here and it has gone. A CRD is asked *of a project*:
       * every row on this screen is a booking that owes one, and the document is raised for it by
       * Send Link on that row - which is where the link the client actually receives comes from. A
       * second way in created a document belonging to no project, which then had no Event ID, no
       * Enquiry ID and nothing to attach the client's answers back to.
       */
      actions={canWrite ? <OptionsMenu ariaLabel="CRD Documents settings" items={[{ label: "Settings", onSelect: () => setConfiguringTerms(true) }]} /> : null}
      tabs={crdDocumentTabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="CRD document status filters"
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1">
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
        </div>
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
    {sendLinkProject && <Dialog
      title="Send CRD Link"
      description={sendLinkProject.eventId ? `Share this link with the client to collect the CRD document for ${sendLinkProject.eventId}.` : sendLinkProject.standalone ? "Share this link with the client to collect their CRD document." : "Prepare a CRD document link."}
      size="md"
      onClose={closeSendLink}
      /*
       * Close, then the two ways of getting the link to the client, then the one way of checking it.
       *
       * Send on WhatsApp is the primary action because it is what actually happens to this link:
       * the studio sends it to the client on WhatsApp. Copy Link stays for a client who is reached
       * some other way, and Open Form is the studio's own check that the link works before it goes
       * anywhere - which is worth having in front of whoever is about to send it.
       *
       * The WhatsApp button is absent, not disabled, when the project has no number: there is
       * nothing to send to, and a control that only refuses is worse than one that is not there.
       */
      footer={sendLinkUrl ? <>
        <Button type="button" onClick={closeSendLink}>Close</Button>
        <Button type="button" onClick={() => void copySendLink()}>Copy Link</Button>
        <Button type="button" onClick={() => window.open(sendLinkUrl, "_blank", "noopener,noreferrer")}>Open Form</Button>
        {whatsappShareUrl() && <Button type="button" variant="primary" onClick={() => window.open(whatsappShareUrl(), "_blank", "noopener,noreferrer")}>Send on WhatsApp</Button>}
      </> : <Button type="button" onClick={closeSendLink}>Close</Button>}
    >
      {sendLinkProject.eventId || sendLinkProject.standalone ? <div className="space-y-4 pb-2">
        {sendLinkUrl && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-600">Public CRD document link</p>
          <a href={sendLinkUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm font-medium text-blue-700 underline">{sendLinkUrl}</a>
          <p className="mt-2 text-xs text-slate-500">The client opens this without signing in, and it saves as they go so they can come back to it. Their event details arrive filled in and shown to be checked; what they fill in is their own and their partner&apos;s details.</p>
        </div>}
        <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div><dt className="font-semibold text-slate-900">Event ID</dt><dd className="mt-1">{sendLinkProject.eventId || "Not started yet"}</dd></div>
          <div><dt className="font-semibold text-slate-900">Enquiry ID</dt><dd className="mt-1">{sendLinkProject.enquiryId || "-"}</dd></div>
          <div><dt className="font-semibold text-slate-900">Client Name</dt><dd className="mt-1">{sendLinkProject.clientName || "-"}</dd></div>
          <div><dt className="font-semibold text-slate-900">Contact Number</dt><dd className="mt-1">{sendLinkProject.clientMainNumber || "-"}</dd></div>
        </dl>
      </div> : <p className="text-sm text-slate-600">Select a CRD document row to send a project-specific link.</p>}
    </Dialog>}
  </section>;
}
