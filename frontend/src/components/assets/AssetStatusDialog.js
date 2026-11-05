"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { assetConditions, assetRepairSeverities, assetShipmentTypes, assetReasonStatuses, assetReceiptStatuses, assetStatusSections, assetStatusTitles, emptyValues } from "@/constants/formPanelConfig";
import useEditableLists from "@/components/shared/useEditableLists";
import { getVendorPicker } from "@/services/assets/assets.service";

/**
 * The repair details an asset was sent away with are seeded back in when it returns, so whoever
 * completes the service is looking at what was reported rather than an empty form.
 */
function initialValues(asset) {
  const logs = Array.isArray(asset.statusLogs) ? asset.statusLogs : [];
  const repair = logs.find((log) => log.nextStatus === "UNDER_REPAIR")?.formData || {};
  return {
    ...emptyValues(assetStatusSections),
    assetCategory: asset.category?.parent?.name || asset.category?.name || "",
    issueCategory: repair.issueCategory || "",
    problemDescription: repair.problemDescription || "",
    severity: repair.severity || "",
    reportedById: repair.reportedById ? String(repair.reportedById) : "",
    reportedDate: repair.reportedDate || "",
    repairAssignee1Id: repair.repairAssignee1Id ? String(repair.repairAssignee1Id) : "",
    repairAssignee2Id: repair.repairAssignee2Id ? String(repair.repairAssignee2Id) : "",
    repairedPhotos: Array.isArray(repair.repairedPhotos) ? repair.repairedPhotos : [],
    receivedOn: repair.receivedOn || repair.gotOn || "",
    receivedAndReviewedById: repair.receivedAndReviewedById ? String(repair.receivedAndReviewedById) : repair.gotAndReviewedById ? String(repair.gotAndReviewedById) : "",
  };
}

export default function AssetStatusDialog({ asset, action, employees, saving, onClose, onSubmit }) {
  const [form, setForm] = useState(() => initialValues(asset));
  const [vendors, setVendors] = useState([]);
  const [vendorError, setVendorError] = useState("");
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  // Which sections the form asks for depends on where the asset is coming from as well as where it
  // is going: the same "Mark Active" completes a service, takes on an unassigned asset, or cancels
  // a repair, and each wants different details.
  const fromTransit = assetReceiptStatuses.includes(action) && asset.status === "IN_TRANSIT";
  const serviceToActive = action === "ACTIVE" && asset.status === "IN_SERVICE";
  const unassignedToActive = action === "ACTIVE" && asset.status === "UNASSIGNED";
  const generic = assetReasonStatuses.includes(action) && !fromTransit;
  const cancellation = action === "ACTIVE" && asset.status === "UNDER_REPAIR";

  useEffect(() => {
    if (action !== "IN_SERVICE") return undefined;
    let cancelled = false;
    getVendorPicker()
      .then((result) => { if (!cancelled) setVendors(result.data || []); })
      .catch((error) => { if (!cancelled) setVendorError(error.message || "Unable to load active vendors."); });
    return () => { cancelled = true; };
  }, [action]);

  /*
   * The three lists this dialog's own fields offer, read from Settings → Fields → Assets. The
   * arrays beside each name are what the form offered before they were editable, and what it still
   * offers while the read is in flight or if it fails.
   */
  const lists = useEditableLists({
    assetConditions: ["asset-conditions", assetConditions],
    assetRepairSeverities: ["asset-repair-severities", assetRepairSeverities],
    assetShipmentTypes: ["asset-shipment-types", assetShipmentTypes],
  });

  const context = useMemo(() => ({
    asset,
    action,
    fromTransit,
    serviceToActive,
    unassignedToActive,
    generic,
    cancellation,
    options: {
      ...lists,
      people: employees.map((employee) => ({ value: String(employee.id), label: `${employee.employeeName} (${employee.employeeId || "—"})` })),
      vendors: vendors.map((vendor) => ({ value: vendor.vendorName, label: `${vendor.sourceType || "EXT"} - ${vendor.vendorName}` })),
    },
    // The vendor is chosen by name, so the record it came from is kept to hand for the address.
    vendorsByName: Object.fromEntries(vendors.map((vendor) => [vendor.vendorName, vendor])),
  }), [action, asset, cancellation, employees, fromTransit, generic, lists, serviceToActive, unassignedToActive, vendors]);

  function submit(event) {
    event.preventDefault();
    const person = (id) => employees.find((employee) => String(employee.id) === id);
    const repairAssignee1 = person(form.repairAssignee1Id);
    const repairAssignee2 = person(form.repairAssignee2Id);
    const reporter = person(form.reportedById);
    const reviewer = person(form.receivedAndReviewedById);
    const handover = person(form.handoverToId);
    const assignedTo = person(form.assignedToId);
    const manager = person(form.managerId);
    onSubmit({
      nextStatus: action,
      changeType: fromTransit ? "RECEIVED_FROM_TRANSIT" : serviceToActive ? "COMPLETED_SERVICE" : unassignedToActive ? "ASSIGNED" : action,
      reason: form.reason,
      formData: {
        ...form,
        reportedById: reporter?.id || null, reportedByName: reporter?.employeeName || null, reportedByEmployeeId: reporter?.employeeId || null,
        repairAssignee1Id: repairAssignee1?.id || null, repairAssignee1Name: repairAssignee1?.employeeName || null, repairAssignee1EmployeeId: repairAssignee1?.employeeId || null,
        repairAssignee2Id: repairAssignee2?.id || null, repairAssignee2Name: repairAssignee2?.employeeName || null, repairAssignee2EmployeeId: repairAssignee2?.employeeId || null,
        assignedToId: assignedTo?.id || null, assignedToName: assignedTo?.employeeName || null, assignedToEmployeeId: assignedTo?.employeeId || null,
        managerId: manager?.id || null, managerName: manager?.employeeName || null, managerEmployeeId: manager?.employeeId || null,
        receivedAndReviewedById: reviewer?.id || null, receivedAndReviewedByName: reviewer?.employeeName || null, receivedAndReviewedByEmployeeId: reviewer?.employeeId || null,
        handoverToId: handover?.id || null, handoverToName: handover?.employeeName || null, handoverToEmployeeId: handover?.employeeId || null,
        serviceCost: form.serviceCost ? Number(form.serviceCost) : null,
        estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : null,
        courierCharge: form.courierCharge ? Number(form.courierCharge) : null,
        soldPrice: form.soldPrice ? Number(form.soldPrice) : null,
      },
    });
  }

  return <SchemaFormPanel
    title={assetStatusTitles[action]}
    description="Complete the transition details before changing this asset's status."
    sections={assetStatusSections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Asset status form sections"
    closeAriaLabel="Close asset status form"
    onClose={onClose}
    onSubmit={submit}
    error={vendorError}
    saving={saving}
    submitLabel="Confirm Status Change"
    savingLabel="Saving..."
  />;
}
