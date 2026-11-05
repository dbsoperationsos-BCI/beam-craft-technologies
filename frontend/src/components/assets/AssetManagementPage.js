"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import ImportMenuButton from "@/components/data-table/ImportMenuButton";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { ASSET_IMPORT_COLUMNS } from "@/constants/importColumns";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import Button from "@/components/shared/Button";
import MultiSelectField from "@/components/shared/MultiSelectField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useCompactView from "@/components/shared/useCompactView";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { getEmployeeDirectory } from "@/services/hrm/employees.service";
import { getMasterData } from "@/services/hrm/master-data.service";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import {
  createAssetRequest,
  getAllAssetRequests,
  getAssetRequests,
  approveAssetRequest,
  rejectAssetRequest,
  createAsset,
  createAssetsBulk,
  createAssetInspection,
  deleteAsset,
  getAssetCategoryTree,
  getAllAssets,
  getAssets,
  updateAsset,
  changeAssetStatus,
} from "@/services/assets/assets.service";
import AssetFormDialog from "./AssetFormDialog";
import AssetRequestDialog from "./AssetRequestDialog";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { assetForInfo, assetInfoSections, assetRequestForInfo, assetRequestInfoSections } from "@/constants/infoPanelConfig";
import AssetCustodyHistory from "./AssetCustodyHistory";
import AssetRequestRejectDialog from "./AssetRequestRejectDialog";
import AssetStatusDialog from "./AssetStatusDialog";
import AssetInspectionDialog from "./AssetInspectionDialog";
import { branchLabel } from "@/lib/branchName";
import { assetCategoryLabel, assetTypeLabel } from "@/lib/assetCategoryLabels.mjs";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

const assetStatusActions = [
  ["ACTIVE", "Active"],
  ["UNDER_REPAIR", "Under Repair"],
  ["IN_SERVICE", "In Service"],
  ["IN_TRANSIT", "In Transit"],
  ["LOST", "Lost"],
  ["SOLD", "Sold"],
  ["DISPOSED", "Disposed"],
  ["UNASSIGNED", "Unassigned"],
];
const assetStatusValues = assetStatusActions.map(([value]) => value);

function flatten(nodes, parent = null) {
  return nodes.flatMap((node) => [
    { ...node, parent },
    ...flatten(node.children || [], node),
  ]);
}

function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value))
    : "—";
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/** How an asset request's decision reads in the table. Anything undecided is still pending. */
/** Where each kind of request sits in the queue. */
const requestOrder = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
// The board's trend counts an asset by its purchase date, or by when it was added where none is set.
const purchasedOn = (asset) => {
  const time = new Date(asset.purchaseDate || asset.createdAt || "").getTime();
  return Number.isNaN(time) ? null : time;
};

function requestDecision(status) {
  if (status === "APPROVED") return { label: "Approved", className: "bg-emerald-50 text-emerald-700" };
  if (status === "REJECTED") return { label: "Rejected", className: "bg-red-50 text-red-700" };
  return { label: "Pending", className: "bg-amber-50 text-amber-700" };
}

function maintenanceCheck(value) {
  if (!value) return { status: "NONE", label: "Not scheduled", className: "bg-slate-100 text-slate-600" };
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  const dueDate = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntilDue = Math.round((dueDate - today) / 86400000);
  // Only a date that has already passed counts as pending maintenance. Assets approaching their
  // due date are shown as upcoming and are excluded from the Maintenance Pending tab and count.
  if (daysUntilDue < 0) return { status: "OVERDUE", label: `Overdue by ${Math.abs(daysUntilDue)} day${daysUntilDue === -1 ? "" : "s"}`, className: "bg-red-50 text-red-700" };
  if (daysUntilDue === 0) return { status: "DUE", label: "Due today", className: "bg-amber-50 text-amber-700" };
  return { status: "UPCOMING", label: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`, className: "bg-emerald-50 text-emerald-700" };
}

function DeleteAssetDialog({ asset, deleting, onClose, onConfirm }) {
  return <ConfirmDialog
    open={Boolean(asset)}
    title="Delete asset?"
    message="Are you sure you want to delete this asset?"
    confirmLabel="Delete"
    busyLabel="Deleting..."
    loading={deleting}
    onCancel={onClose}
    onConfirm={onConfirm}
  />;
}

export default function AssetManagementPage() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [tree, setTree] = useState([]);
  const [rows, setRows] = useState([]);
  const [rowsView, setRowsView] = useState("assets");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [total, setTotal] = useState(0);
  const [formAsset, setFormAsset] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState([]);
  /*
   * The branches the filter above the table may offer - not the register `branches` holds.
   *
   * /api/assets answers it from the roles that grant ASSET / Asset Management, so the picker never
   * offers a branch whose assets the data scope would have hidden anyway. A branch the viewer may
   * not reach would have shown an empty table and read as a fault.
   */
  const [filterBranches, setFilterBranches] = useState(null);
  // Bumped when Settings → Organization → Branches saves, so the Location picker keeps up.
  const branchRegistryRevision = useBranchRegistry();
  const [employees, setEmployees] = useState([]);
  const [statusChange, setStatusChange] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  // The row a double-click opened for reading. Which shape it is read as follows the tab it came
  // from, the same way the info panel beside it does.
  const [viewingRow, setViewingRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestToApprove, setRequestToApprove] = useState(null);
  const [requestToReject, setRequestToReject] = useState(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  /*
   * The screen is one permission: the register, the inspections recorded against it, and raising a
   * request for an asset are steps of the same job, held by everybody who works with assets. READ
   * browses and reads your own requests; READ_WRITE raises a request, and makes somebody eligible
   * to manage an asset - what they may do to any particular one is decided per row by the
   * `capabilities` the API sends with it, not by this. Adding an asset is not here: it is
   * `Asset Administration` below.
   *
   * Deciding on somebody else's request is the exception and has its own. It used to be read off
   * the signed-in user's legacy role - Super Admin or nobody - which no role could be given,
   * whatever the Roles screen said. The queue widens with it too: without it the request list comes
   * back scoped to your own.
   */
  const { canWrite } = useModuleAccess("ASSET", "Asset Management");
  // Bumped when something outside this effect writes assets - an import - so the list re-reads
  // rather than showing what it had before the file landed.
  const [reloadToken, setReloadToken] = useState(0);
  const { canWrite: canDecideRequests } = useModuleAccess("ASSET", "Asset Request Approval");
  /*
   * Putting equipment on the register is its own permission, held by few.
   *
   * Asset Management is held widely - it is how somebody sees the camera in their hands and reports
   * it faulty - and Add Asset used to sit on it, so anybody who could raise a request could also
   * register equipment and name its manager. Deciding what the studio owns is a different job from
   * looking after a piece of it. The route guard on POST /api/assets is the authority; this only
   * decides whether the button is drawn.
   */
  const { canWrite: canAdminister } = useModuleAccess("ASSET", "Asset Administration");
  const [statusCounts, setStatusCounts] = useState({});
  const [maintenanceCount, setMaintenanceCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [countsRefresh, setCountsRefresh] = useState(0);
  // Importing is a Super Admin's. The API answers it rather than the browser working it out from a
  // role, so the screen never holds an opinion about authority of its own.
  const [canImport, setCanImport] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [assetToDelete, setAssetToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [inspectionAsset, setInspectionAsset] = useState(null);
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [inspectionError, setInspectionError] = useState("");

  const allCategories = useMemo(() => flatten(tree), [tree]);
  // The top categories an asset may be filed under, for the Asset Request dialog's picker. Client
  // Storage is its own module now, so its category is not one of them.
  const mainCategories = useMemo(() => tree.filter((item) => item.level === 1 && item.moduleType === "ASSET"), [tree]);
  /*
   * The branches the table is narrowed to - any number of them - in the URL beside the status tabs
   * so a link keeps them: `?branch=3,7`.
   *
   * Not checked against `filterBranches` here: that list arrives with the first page of assets, and
   * judging the filter while it is in flight would drop a good one. The effect further down drops
   * what the list turns out not to hold. Nothing the query string says can widen what comes back
   * either - the data scope on /api/assets sits under its own AND.
   *
   * `branchKey` is what the effects below depend on. The ids are a fresh array on every render, so a
   * dependency on the array itself refetches the table forever; the string it joins to does not.
   */
  const chosenBranchIds = useMemo(
    () => [...new Set(String(params.get("branch") || "").split(",").map((part) => part.trim()).filter((part) => /^\d+$/.test(part)))],
    [params],
  );
  const branchKey = chosenBranchIds.join(",");
  const branchQuery = branchKey || undefined;
  const chosenBranchNames = chosenBranchIds
    .map((id) => (filterBranches || []).find((branch) => String(branch.id) === id))
    .filter(Boolean)
    .map((branch) => branchLabel(branch.name) || branch.name);
  const requestedInspection = params.get("inspection");
  const inspection = requestedInspection === "MAINTENANCE" ? "MAINTENANCE" : "ALL";
  // The Asset Requests tab shows a different thing entirely, so it replaces the table rather than
  // filtering it. Kept in the URL like the other tabs so the view survives a refresh.
  const showingRequests = params.get("view") === "REQUESTS";
  /*
   * The Board: the assets in a column per status. The status tabs are filters, so while it shows
   * they step aside and the list is read across every status; Maintenance Pending and Asset
   * Requests stay, being views rather than statuses, and the Requests view keeps its table.
   */
  const [layout, setLayout] = useTableBoardLayout("asset-management");
  const onBoard = layout === "board" && !showingRequests;
  const requestedStatus = params.get("status");
  const status = !onBoard && assetStatusValues.includes(requestedStatus) ? requestedStatus : "ALL";

  /*
   * Import, offered in the header's ⋮ and in the table's, defined once.
   *
   * Not on the Asset Requests view: that is a different table with a different shape, and importing
   * into it would mean raising requests rather than adding assets.
   *
   * Declared here rather than beside `reloadToken` above, because it reads `showingRequests` - a
   * `const` further down the body is in its temporal dead zone until the line that defines it, so
   * the earlier position threw on the first render rather than merely reading out of order.
   */
  const assetImportConfig = canImport && !showingRequests ? {
    prefix: "/api/assets",
    columns: ASSET_IMPORT_COLUMNS,
    templateName: "asset-import-template",
    title: "Import Assets",
    onImported: () => setReloadToken((token) => token + 1),
  } : undefined;
  // What still needs deciding comes first and what has been ruled on settles underneath, so the
  // queue reads top-down: pending, then approved, then rejected, each newest first within its group.
  const visibleRows = useMemo(
    () => showingRequests ? [...rows].sort((first, second) => (requestOrder[first.status] ?? 3) - (requestOrder[second.status] ?? 3)) : rows,
    [rows, showingRequests],
  );
  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`. Assets only: a request is not a
   * row of this register and `/api/assets/bulk` would not know what to do with one, so the hook is
   * handed no rows while the Requests tab is showing and draws no column over it.
   *
   * `canDelete` is the register's own Read / Write. Which *assets* may then go is still decided per
   * row by `capabilitiesFor` on the server - the same rule the ⋮ menu's Delete reads - so a
   * selection holding one somebody may not retire loses the rest and keeps that one ticked.
   */
  const bulk = useTableSelection({
    prefix: "/api/assets",
    rows: showingRequests ? undefined : visibleRows,
    noun: "asset",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => {
      setReloadToken((token) => token + 1);
      setCountsRefresh((current) => current + 1);
      setLastUpdated(new Date());
    },
  });
  const updatedText = lastUpdated
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(lastUpdated)
    : "—";
  useEffect(() => {
    Promise.all([
      getAssetCategoryTree(),
      getMasterData("branches", { pageSize: 100, active: true }),
      // Only people actually working here: an asset is handed to somebody who is there to take it.
      // The directory rather than the repository, because an asset role does not read HRM.
      getEmployeeDirectory(),
    ])
      .then(([categories, locations, people]) => {
        setTree(categories.data || []);
        setBranches(locations.data || []);
        setEmployees(people.data || []);
      })
      .catch((requestError) => showError(requestError.message || "Unable to load Asset Management."));
  }, [showError]);

  /*
   * The locations on their own, when the branch register changes while this page is open.
   *
   * Not the effect above, which fetches the category tree and the employee list beside the
   * branches: a branch being renamed is no reason to re-read either of those, and this page is
   * usually sitting under the very overlay the branch was saved in.
   *
   * `branchRegistryRevision` is 0 until something is saved, so the first render is left to the
   * effect above and this one only ever acts on a change.
   */
  useEffect(() => {
    if (!branchRegistryRevision) return undefined;
    let cancelled = false;
    getMasterData("branches", { pageSize: 100, active: true })
      .then((locations) => { if (!cancelled) setBranches(locations.data || []); })
      // Left as they were: a refresh that fails is not a reason to empty a picker that is working.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [branchRegistryRevision]);

  useEffect(() => {
    let cancelled = false;
    const request = showingRequests
      ? getAllAssetRequests()
      : getAllAssets({
        branchIds: branchQuery,
        status: status === "ALL" ? undefined : status,
        inspection: inspection === "ALL" ? undefined : inspection,
      });

    request
      .then((result) => {
        if (cancelled) return;
        setRows(result.data || []);
        // Tagged with the view it was fetched for: assets and requests have nothing in common, so
        // rendering one under the other's columns would show a table of dashes until this lands.
        setRowsView(showingRequests ? "requests" : "assets");
        setTotal(result.pagination?.total ?? 0);
        setLastUpdated(new Date());
      })
      .catch((requestError) => {
        if (!cancelled) showError(requestError.message || "Unable to load records.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [branchKey, branchQuery, inspection, status, showingRequests, reloadToken, showError]);

  useEffect(() => {
    let cancelled = false;
    const base = { branchIds: branchQuery, limit: 1 };
    // Requests are counted unfiltered: they are raised against a branch's assets before those
    // assets exist, so narrowing them by the chosen branch would hide most of them.
    Promise.all([getAssets(base), ...assetStatusActions.map(([assetStatus]) => getAssets({ ...base, status: assetStatus })), getAssets({ ...base, inspection: "MAINTENANCE" }), getAssetRequests({ status: "PENDING", limit: 1 })])
      .then((results) => {
        if (cancelled) return;
        setStatusCounts(Object.fromEntries([["ALL", results[0].pagination?.total ?? 0], ...assetStatusActions.map(([assetStatus], index) => [assetStatus, results[index + 1].pagination?.total ?? 0])]));
        setMaintenanceCount(results[assetStatusActions.length + 1].pagination?.total ?? 0);
        setRequestCount(results[assetStatusActions.length + 2].pagination?.total ?? 0);
        setCanImport(Boolean(results[0].canImport));
        // Answered beside the counts rather than by the list, so the picker is filled on the
        // Asset Requests tab too - where the list reads requests and knows nothing about branches.
        setFilterBranches(Array.isArray(results[0].branches) ? results[0].branches : []);
      })
      .catch((requestError) => { if (!cancelled) showError(requestError.message || "Unable to load asset status counts."); });
    return () => { cancelled = true; };
  }, [branchQuery, countsRefresh, showError]);

  /*
   * A branch named in the URL that the viewer does not reach - a link shared from somebody who
   * does - is dropped rather than left on screen. The table behind it would come back empty,
   * because the data scope narrows it whatever the query string says, and an empty table under a
   * branch somebody is apparently looking at reads as a fault rather than as an answer.
   *
   * Only once the list has actually been read: `null` means the first page of assets is still in
   * flight, and judging the filter against a list nobody has answered yet would drop a good one.
   */
  useEffect(() => {
    if (!filterBranches || !chosenBranchIds.length) return;
    const kept = chosenBranchIds.filter((id) => filterBranches.some((branch) => String(branch.id) === id));
    if (kept.length === chosenBranchIds.length) return;
    const lost = chosenBranchIds.length - kept.length;
    showError(`${lost === 1 ? "One of those branches is not one" : `${lost} of those branches are not ones`} you can see assets in, so ${kept.length ? "they have been left out" : "all branches are shown"}.`);
    const next = new URLSearchParams(params.toString());
    if (kept.length) next.set("branch", kept.join(","));
    else next.delete("branch");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [branchKey, chosenBranchIds, filterBranches, params, pathname, router, showError]);

  /** The branches ticked, as the URL holds them. Empty is every branch, so the key is removed. */
  function changeBranches(values) {
    const next = new URLSearchParams(params.toString());
    if (values.length) next.set("branch", values.join(","));
    else next.delete("branch");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function changeFilter(key, value) {
    const next = new URLSearchParams(params.toString());
    if (value === "ALL") next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function changeStatusTab(value) {
    const next = new URLSearchParams(params.toString());
    next.delete("inspection");
    next.delete("view");
    if (value === "ALL") next.delete("status");
    else next.set("status", value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function showAssetRequests() {
    const next = new URLSearchParams(params.toString());
    next.delete("status");
    next.delete("inspection");
    next.set("view", "REQUESTS");
    router.replace(`${pathname}?${next.toString()}`);
  }

  function showMaintenanceCheck() {
    const next = new URLSearchParams(params.toString());
    next.delete("status");
    next.delete("view");
    next.set("inspection", "MAINTENANCE");
    router.replace(`${pathname}?${next.toString()}`);
  }

  async function save(payload) {
    setSaving(true);
    setError("");

    try {
      if (formAsset) await updateAsset(formAsset.id, payload);
      else if (Array.isArray(payload.bulkItems)) await createAssetsBulk(payload);
      else await createAsset(payload);

      setFormOpen(false);
      const result = await getAllAssets({
        branchIds: branchQuery,
        status: status === "ALL" ? undefined : status,
        inspection: inspection === "ALL" ? undefined : inspection,
      });
      setRows(result.data || []);
      setTotal(result.pagination?.total ?? 0);
      setLastUpdated(new Date());
      setSelectedAsset((current) => current && formAsset && current.id === formAsset.id ? (result.data || []).find((item) => item.id === current.id) || null : current);
      setCountsRefresh((current) => current + 1);
      showSuccess(formAsset ? "Asset updated successfully." : Array.isArray(payload.bulkItems) ? "Assets added successfully." : "Asset added successfully.");
    } catch (requestError) {
      setError(requestError.message || "Unable to save asset.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(asset, payload) {
    try {
      setSaving(true);
      const result = await changeAssetStatus(asset.id, payload);
      const leavesCurrentFilter = status !== "ALL" && result.data.status !== status;
      setRows((current) => leavesCurrentFilter
        ? current.filter((item) => item.id !== asset.id)
        : current.map((item) => item.id === asset.id ? result.data : item));
      if (leavesCurrentFilter) {
        setTotal((current) => Math.max(0, current - 1));
        setSelectedAsset((current) => current?.id === asset.id ? null : current);
        if (selectedAsset?.id === asset.id) setInfoPanelState("collapsed");
      } else {
        setSelectedAsset((current) => current?.id === asset.id ? result.data : current);
      }
      setStatusCounts((current) => ({ ...current, [asset.status]: Math.max(0, (current[asset.status] || 0) - 1), [result.data.status]: (current[result.data.status] || 0) + 1 }));
      setLastUpdated(new Date());
      setStatusChange(null);
      showSuccess("Asset status updated successfully.");
    } catch (requestError) {
      showError(requestError.message || "Unable to update asset status.");
    } finally {
      setSaving(false);
    }
  }

  async function completeInspection(payload) {
    if (!inspectionAsset) return;
    try {
      setInspectionSaving(true);
      setInspectionError("");
      await createAssetInspection(inspectionAsset.id, payload);
      const result = await getAllAssets({ branchIds: branchQuery, status: status === "ALL" ? undefined : status, inspection: inspection === "ALL" ? undefined : inspection });
      setRows(result.data || []);
      setTotal(result.pagination?.total ?? 0);
      setLastUpdated(new Date());
      setInspectionAsset(null);
      setCountsRefresh((current) => current + 1);
      showSuccess("Inspection completed successfully.");
    } catch (requestError) {
      setInspectionError(requestError.message || "Unable to complete inspection.");
    } finally {
      setInspectionSaving(false);
    }
  }

  /** Reloads the requests table, but only while requests are the thing on screen. */
  async function refreshRequests() {
    if (!showingRequests) return;
    const result = await getAllAssetRequests();
    setRows(result.data || []);
    setRowsView("requests");
    setTotal(result.pagination?.total ?? 0);
    setLastUpdated(new Date());
    // Re-point the info panel at the reloaded row, so a request decided while it is open shows the
    // decision rather than staying on the copy it was selected from.
    setSelectedRequest((current) => current ? (result.data || []).find((row) => row.id === current.id) || null : current);
  }

  /** Raises a request for an asset that does not exist yet, and refreshes what shows it. */
  async function sendRequest(payload) {
    setRequestSaving(true);
    setRequestError("");
    try {
      await createAssetRequest(payload);
      setRequestOpen(false);
      // The tab count always moves; the table only if requests are the thing on screen.
      await refreshRequests();
      setCountsRefresh((current) => current + 1);
      showSuccess("Asset request sent successfully.");
    } catch (requestFailure) {
      setRequestError(requestFailure.message || "Unable to send the asset request.");
    } finally {
      setRequestSaving(false);
    }
  }

  /**
   * Approving a request is the same act as adding the asset it asked for, so the admin fills in the
   * normal Add Asset form and the whole thing goes up as the decision. The request only becomes
   * approved if that asset is actually created, which is why the server does both.
   */
  async function approveRequest(payload) {
    if (!requestToApprove) return;
    setDecisionSaving(true);
    setDecisionError("");
    try {
      await approveAssetRequest(requestToApprove.id, payload);
      setRequestToApprove(null);
      await refreshRequests();
      // An asset was added, so the status tabs are stale as well as the request list.
      setCountsRefresh((current) => current + 1);
      showSuccess("Asset request approved successfully.");
    } catch (requestFailure) {
      setDecisionError(requestFailure.message || "Unable to approve this asset request.");
    } finally {
      setDecisionSaving(false);
    }
  }

  async function rejectRequest(remarks) {
    if (!requestToReject) return;
    setDecisionSaving(true);
    setDecisionError("");
    try {
      await rejectAssetRequest(requestToReject.id, remarks);
      setRequestToReject(null);
      await refreshRequests();
      showSuccess("Asset request rejected.");
    } catch (requestFailure) {
      setDecisionError(requestFailure.message || "Unable to reject this asset request.");
    } finally {
      setDecisionSaving(false);
    }
  }

  async function removeAsset() {
    if (!assetToDelete) return;
    const asset = assetToDelete;
    try {
      setDeleting(true);
      setError("");
      await deleteAsset(asset.id);
      setRows((current) => current.filter((item) => item.id !== asset.id));
      setTotal((current) => Math.max(0, current - 1));
      setStatusCounts((current) => ({ ...current, ALL: Math.max(0, (current.ALL || 0) - 1), [asset.status]: Math.max(0, (current[asset.status] || 0) - 1) }));
      setSelectedAsset((current) => current?.id === asset.id ? null : current);
      if (selectedAsset?.id === asset.id) setInfoPanelState("collapsed");
      setLastUpdated(new Date());
      setAssetToDelete(null);
      setCountsRefresh((current) => current + 1);
      showSuccess("Asset deleted successfully.");
    } catch (requestError) {
      showError(requestError.message || "Unable to delete asset.");
    } finally {
      setDeleting(false);
    }
  }

  /*
   * What this menu offers is decided per row, not per screen, and it is decided by the API.
   *
   * An asset is somebody's to manage if they are the employee named as its manager or the login
   * that added it; everybody else who can see it may look at it and report it faulty. That cannot
   * be worked out here - the browser knows neither the viewer's employee id nor which of the two
   * numbers an asset is marked with - so `capabilities` rides along on every row and this reads it.
   *
   * The status entries come from `allowedTransitions` rather than a map of our own. The map used to
   * live in this file, which made it advice: it hid Dispose from somebody who only holds the asset
   * and the PATCH behind it took Dispose anyway. There is one map now, on the server, and this
   * renders whatever it sends - so the menu cannot offer a move the endpoint would refuse, and
   * cannot hide one it would allow.
   */
  function assetActionItems(asset) {
    const inspectionStatus = maintenanceCheck(asset.nextInspectionDate).status;
    const can = asset.capabilities || {};
    const transitions = can.allowedTransitions || [];
    return [
      // Always first, and offered to a reader who may change nothing: on a touch screen this menu
      // is the only way into the record view, a double-click there being the browser's zoom.
      { label: "View", onSelect: () => setViewingRow(asset) },
      ...(can.canEdit ? [{ label: "Edit", onSelect: () => { setFormAsset(asset); setFormOpen(true); } }] : []),
      ...(can.canInspect && ["DUE", "OVERDUE"].includes(inspectionStatus) ? [{ label: "Start Inspection", onSelect: () => setInspectionAsset(asset) }] : []),
      ...assetStatusActions.filter(([action]) => transitions.includes(action)).map(([action, label]) => ({
        label: `  ${label}`,
        onSelect: () => setStatusChange({ asset, action }),
      })),
      ...(can.canDelete ? [{ label: "Delete", tone: "danger", onSelect: () => setAssetToDelete(asset) }] : []),
    ];
  }

  /*
   * A card dropped on a status runs that status's ⋮ entry - only where the asset's own
   * `allowedTransitions` offers it - which opens the same status dialog the menu opens.
   */
  const boardColumns = assetStatusActions.map(([value, label]) => ({ value, label }));
  const canDropAsset = (asset, to) => (asset.capabilities?.allowedTransitions || []).includes(to);
  const dropAsset = (asset, to) => setStatusChange({ asset, action: to });

  const assetColumns = [
    { accessorKey: "assetCode", header: "Asset ID" },
    { accessorKey: "assetName", header: "Asset Name" },
    { id: "category", header: "Category", accessorFn: (row) => assetCategoryLabel(row) || "—" },
    { id: "type", header: "Type", accessorFn: (row) => assetTypeLabel(row) || "—" },
    { accessorKey: "company", header: "Brand Name" },
    { accessorKey: "specification", header: "Specification" },
    { accessorKey: "color", header: "Color" },
    { accessorKey: "serialNumber", header: "Serial Number" },
    { accessorKey: "remarks", header: "Remarks" },
    { id: "branch", header: "Branch", accessorFn: (row) => branchLabel(row.branch?.name) || "—" },
    { id: "assigned", header: "Assigned Person", accessorFn: (row) => row.assignedPerson?.employeeName || "—" },
    { id: "manager", header: "Manager", accessorFn: (row) => row.manager?.employeeName || "—" },
    { id: "nextInspectionDate", header: "Next Inspection Date", accessorFn: (row) => formatDate(row.nextInspectionDate) },
    { id: "maintenanceCheck", header: "Maintenance Pending", accessorFn: (row) => maintenanceCheck(row.nextInspectionDate).label, cell: ({ row }) => { const check = maintenanceCheck(row.original.nextInspectionDate); return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${check.className}`}>{check.label}</span>; } },
    { id: "purchaseDate", header: "Purchase Date", accessorFn: (row) => formatDate(row.purchaseDate) },
    { accessorKey: "inspectionPeriodMonths", header: "Inspection Period (months)" },
    { id: "lastInspectedDate", header: "Last Inspected Date", accessorFn: (row) => formatDate(row.lastInspectedDate) },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "purchasePrice", header: "Purchase Price" },
    { accessorKey: "purchasedFrom", header: "Purchased From" },
    { accessorKey: "invoiceNumber", header: "Invoice Number" },
    { accessorKey: "warrantyMonths", header: "Warranty in Months" },
    { accessorKey: "insuranceDetails", header: "Insurance Details" },
    { id: "insuranceExpiry", header: "Insurance Expiry", accessorFn: (row) => formatDate(row.insuranceExpiry) },
    { id: "images", header: "Images", accessorFn: (row) => `${(Array.isArray(row.images) ? row.images.length : 0) + (row.photoData ? 1 : 0)} file(s)` },
    { id: "documents", header: "Documents", accessorFn: (row) => `${Array.isArray(row.documents) ? row.documents.length : 0} file(s)` },
    {
      ...ACTIONS_COLUMN,
      cell: ({ row }) => {
        const items = assetActionItems(row.original);
        return items.length ? <OptionsMenu ariaLabel={`Actions for ${row.original.assetName}`} items={items} /> : null;
      },
    },
  ];
  const assetTableColumns = assetColumns.map((column) => {
    if (column.accessorKey) return { ...column, cell: ({ row }) => displayValue(row.original?.[column.accessorKey]) };
    if (column.id === "category") return { ...column, cell: ({ row }) => displayValue(assetCategoryLabel(row.original)) };
    if (column.id === "type") return { ...column, cell: ({ row }) => displayValue(assetTypeLabel(row.original)) };
    if (column.id === "branch") return { ...column, cell: ({ row }) => displayValue(branchLabel(row.original.branch?.name)) };
    if (column.id === "assigned") return { ...column, cell: ({ row }) => displayValue(row.original.assignedPerson?.employeeName) };
    if (column.id === "manager") return { ...column, cell: ({ row }) => displayValue(row.original.manager?.employeeName) };
    if (column.id === "purchaseDate" || column.id === "lastInspectedDate" || column.id === "nextInspectionDate" || column.id === "insuranceExpiry") return { ...column, cell: ({ row }) => formatDate(row.original[column.id]) };
    if (column.id === "images") return { ...column, cell: ({ row }) => `${(Array.isArray(row.original.images) ? row.original.images.length : 0) + (row.original.photoData ? 1 : 0)} file(s)` };
    if (column.id === "documents") return { ...column, cell: ({ row }) => `${Array.isArray(row.original.documents) ? row.original.documents.length : 0} file(s)` };
    return column;
  });

  /**
   * The Asset Requests tab shows requests, not assets, so it needs its own columns. Every one
   * carries an accessor, which is what DataTable needs to give a column its sort toggle and
   * filter box.
   */
  const requestColumns = [
    { id: "requestCode", header: "Request ID", accessorFn: (row) => row.requestCode ?? "", cell: ({ row }) => displayValue(row.original.requestCode) },
    { id: "assetName", header: "Asset Name", accessorFn: (row) => row.assetName ?? "", cell: ({ row }) => displayValue(row.original.assetName) },
    { id: "category", header: "Category", accessorFn: (row) => row.category?.name ?? "", cell: ({ row }) => displayValue(row.original.category?.name) },
    { id: "subCategory", header: "Sub Category", accessorFn: (row) => row.subCategory?.name ?? "", cell: ({ row }) => displayValue(row.original.subCategory?.name) },
    { id: "remarks", header: "Remarks", accessorFn: (row) => row.remarks ?? "", cell: ({ row }) => displayValue(row.original.remarks) },
    { id: "requestedByName", header: "Requested By", accessorFn: (row) => row.requestedByName ?? "", cell: ({ row }) => displayValue(row.original.requestedByName) },
    {
      id: "createdAt",
      header: "Requested On",
      // Sorts on the timestamp while filtering against the text actually shown.
      accessorFn: (row) => row.createdAt ? new Date(row.createdAt).getTime() : undefined,
      sortUndefined: "last",
      cell: ({ row }) => formatDate(row.original.createdAt),
      filterFn: (row, columnKey, filterValue) => matchesWordChunks(formatDate(row.original.createdAt), filterValue),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => requestDecision(row.status).label,
      cell: ({ row }) => { const decision = requestDecision(row.original.status); return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${decision.className}`}>{decision.label}</span>; },
    },
    // Only a rejection carries a remark, and only an approval an asset, so both stay blank until the
    // request has actually been decided.
    { id: "decisionRemarks", header: "Rejection Reason", accessorFn: (row) => row.decisionRemarks ?? "", cell: ({ row }) => displayValue(row.original.decisionRemarks) },
    { id: "assetCode", header: "Asset Added", accessorFn: (row) => row.asset?.assetCode ?? "", cell: ({ row }) => displayValue(row.original.asset?.assetCode) },
    { id: "decidedByName", header: "Decided By", accessorFn: (row) => row.decidedByName ?? "", cell: ({ row }) => displayValue(row.original.decidedByName) },
    {
      id: "decidedAt",
      header: "Decided On",
      accessorFn: (row) => row.decidedAt ? new Date(row.decidedAt).getTime() : undefined,
      sortUndefined: "last",
      cell: ({ row }) => formatDate(row.original.decidedAt),
      filterFn: (row, columnKey, filterValue) => matchesWordChunks(formatDate(row.original.decidedAt), filterValue),
    },
    // Accept and Reject are the admin's only two calls, and a request that has already been decided
    // offers neither, so the menu is dropped entirely rather than shown empty.
    {
      ...ACTIONS_COLUMN,
      // A decided request offers no decision, but every request can still be read — and on a touch
      // screen this menu is the only way to open one.
      cell: ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.requestCode}`} items={[
        { label: "View", onSelect: () => setViewingRow(row.original) },
        ...(canDecideRequests && row.original.status === "PENDING" ? [
          { label: "Accept", onSelect: () => { setDecisionError(""); setRequestToApprove(row.original); } },
          { label: "Reject", tone: "danger", onSelect: () => { setDecisionError(""); setRequestToReject(row.original); } },
        ] : []),
      ]} />,
    },
  ];

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title="Assets"
        /* Ahead of Nebula and the buttons: it scopes what the page is showing rather than doing
           anything to it. Several branches at once, the way the Shoot Board's own branch filter
           reads - a studio comparing two of them should not have to look at each in turn. Nothing
           ticked is every branch, so the empty control is the way back. Not on the Asset Requests
           tab, where a branch narrows nothing. */
        leadingActions={!showingRequests && <MultiSelectField
          hideLabel
          // Header-sized, so it stands level with the switch and the buttons beside it.
          size="sm"
          label="Branch"
          className="w-40 sm:w-56"
          placeholder={filterBranches ? "All branches" : "Loading branches..."}
          options={(filterBranches || []).map((branch) => ({ value: String(branch.id), label: branchLabel(branch.name) || branch.name }))}
          values={chosenBranchIds}
          onChange={changeBranches}
          // Worth a search box once a studio has more than a handful; noise below that.
          searchable={(filterBranches || []).length > 8}
          disabled={!filterBranches}
        />}
        actions={<>
          {!showingRequests && <TableBoardSwitch value={layout} onChange={setLayout} />}
          {canWrite && <Button onClick={() => { setRequestError(""); setRequestOpen(true); }}>Asset Request</Button>}
          {canAdminister && <Button variant="primary" onClick={() => { setFormAsset(null); setFormOpen(true); }}>Add Asset</Button>}
        </>}
        /* The ⋮ ends the row, after Nebula - the header's own slot for it, so every page's ends the
           same way and the primary button keeps the position the eye goes to. */
        menu={<ImportMenuButton ariaLabel="More asset actions" importConfig={assetImportConfig} />}
        // Requests and the maintenance check are views of their own rather than statuses, so they
        // sit in the same bar but answer to their own handlers.
        tabs={[
          { id: "ALL", label: "All", count: statusCounts.ALL ?? 0 },
          ...(onBoard ? [] : assetStatusActions.map(([value, label]) => ({ id: value, label, count: statusCounts[value] ?? 0 }))),
          { id: "MAINTENANCE", label: "Maintenance Pending", count: maintenanceCount },
          { id: "REQUESTS", label: "Asset Requests", count: requestCount },
        ]}
        tabValue={showingRequests ? "REQUESTS" : inspection === "MAINTENANCE" ? "MAINTENANCE" : status}
        onTabChange={(id) => { if (id === "REQUESTS") showAssetRequests(); else if (id === "MAINTENANCE") showMaintenanceCheck(); else changeStatusTab(id); }}
        tabsAriaLabel="Asset status filters"
      />
      <FloatingNotice notice={notice} onClose={clearNotice} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {onBoard ? <KanbanBoard
          rows={rowsView === "assets" ? rows : []}
          columns={boardColumns}
          statusOf={(asset) => asset.status}
          // What the assets in each status cost to buy.
          columnAmount={(rows) => columnTotal(rows, (asset) => asset.purchasePrice, "Value")}
          dateOf={purchasedOn}
          card={{
            title: (asset) => asset.assetName,
            subtitle: (asset) => [asset.assetCode, asset.assignedPerson?.employeeName].filter(Boolean).join(" · "),
            meta: (asset) => [assetCategoryLabel(asset), asset.nextInspectionDate ? `Inspection ${formatDate(asset.nextInspectionDate)}` : ""].filter(Boolean).join(" · "),
          }}
          onOpen={setViewingRow}
          // The card's ⋮ is the row's ⋮.
          cardActions={assetActionItems}
          canDropAt={canDropAsset}
          onDrop={dropAsset}
          loading={loading || rowsView !== "assets"}
          noun="assets"
          ariaLabel="Assets board"
        /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-x-0 border-y-0 lg:border-r" footer={<TableFooter spread contentClassName="!items-center"><span className="text-xs sm:text-sm">Last updated: {updatedText}</span><span className="shrink-0 text-xs sm:text-sm">Total rows: {total}</span></TableFooter>}>
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Each view has its own panel, because a request and an asset share no fields. The
                open/collapsed state is shared, so the panel does not close when switching tabs. */}
            <DataTable
              key={`${branchKey || "all"}-${status}-${inspection}-${showingRequests ? "requests" : "assets"}`}
              columns={showingRequests ? requestColumns : assetTableColumns}
              density={density}
              data={rowsView === (showingRequests ? "requests" : "assets") ? visibleRows : []}
              loading={loading || rowsView !== (showingRequests ? "requests" : "assets")}
              emptyMessage={showingRequests
                ? "No asset requests raised yet."
                // Named, so an empty table reads as "not in these branches" rather than as a fault.
                : chosenBranchNames.length === 1 ? `No assets in ${chosenBranchNames[0]} for this selection.`
                  : chosenBranchNames.length ? `No assets in the ${chosenBranchNames.length} branches chosen for this selection.`
                    : "No assets found for this selection."}
              noMatchMessage="No matching records found."
              selectedRowId={showingRequests ? selectedRequest?.id : selectedAsset?.id}
              onRowClick={(row) => { if (showingRequests) setSelectedRequest(row); else setSelectedAsset(row); setInfoPanelState("expanded"); }}
              // Reads the row in full. Editing an asset, and deciding a request, are the ⋮ menu's own entries.
              onRowDoubleClick={setViewingRow}
              ariaLabel={showingRequests ? "Asset requests table" : "Asset management table"}
              // Requests are a different table with a different shape; only the assets themselves
              // can be imported into.
              importConfig={assetImportConfig}
              className="overscroll-contain touch-pan-x touch-pan-y"
              tableClassName="min-w-max"
              features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, selection: showingRequests ? undefined : bulk.selection }}
            />
            {showingRequests
              ? <DataTableInfoPanel title="Request Details" entity={assetRequestForInfo(selectedRequest)} sections={assetRequestInfoSections} emptyText="Select an asset request to see its full details." state={infoPanelState} onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")} />
              : <DataTableInfoPanel title="Asset Info" entity={assetForInfo(selectedAsset)} sections={assetInfoSections} emptyText="Select an asset row to view details." state={infoPanelState} onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}>
                <AssetCustodyHistory key={selectedAsset?.id || "empty"} assetId={selectedAsset?.id || null} />
              </DataTableInfoPanel>}
          </div>
        </DataTableShell>}
      </div>
      {formOpen && <AssetFormDialog asset={formAsset} categories={allCategories} branches={branches} employees={employees} saving={saving} error={error} onClose={() => setFormOpen(false)} onSave={save} />}
      {statusChange && <AssetStatusDialog asset={statusChange.asset} action={statusChange.action} employees={employees} saving={saving} onClose={() => setStatusChange(null)} onSubmit={(payload) => changeStatus(statusChange.asset, payload)} />}
      {inspectionAsset && <AssetInspectionDialog asset={inspectionAsset} employees={employees} saving={inspectionSaving} error={inspectionError} onClose={() => { setInspectionAsset(null); setInspectionError(""); }} onSubmit={(payload) => void completeInspection(payload)} />}
      {/* mainCategories, not the raw tree: Client Storage is its own module and is not an asset
          anyone would request here. */}
      {requestOpen && <AssetRequestDialog tree={mainCategories} saving={requestSaving} error={requestError} onClose={() => setRequestOpen(false)} onSubmit={(payload) => void sendRequest(payload)} />}
      {/* Accepting opens the Add Asset form seeded from the request: the admin's approval and the
          asset it produces are one action, so there is no approved request without an asset. */}
      {requestToApprove && <AssetFormDialog request={requestToApprove} categories={allCategories} branches={branches} employees={employees} saving={decisionSaving} error={decisionError} onClose={() => setRequestToApprove(null)} onSave={(payload) => void approveRequest(payload)} />}
      {requestToReject && <AssetRequestRejectDialog request={requestToReject} saving={decisionSaving} error={decisionError} onClose={() => setRequestToReject(null)} onSubmit={(remarks) => void rejectRequest(remarks)} />}
      {viewingRow && (showingRequests
        ? <RecordViewPanel title={viewingRow.requestCode || "Asset request"} entity={assetRequestForInfo(viewingRow)} sections={assetRequestInfoSections} sidebarAriaLabel="Asset request sections" onClose={() => setViewingRow(null)} />
        : <RecordViewPanel title={viewingRow.assetName || viewingRow.assetCode || "Asset"} entity={assetForInfo(viewingRow)} sections={assetInfoSections} sidebarAriaLabel="Asset sections" onClose={() => setViewingRow(null)} />)}
      <DeleteAssetDialog asset={assetToDelete} deleting={deleting} onClose={() => setAssetToDelete(null)} onConfirm={() => void removeAsset()} />
    </section>
  );
}
