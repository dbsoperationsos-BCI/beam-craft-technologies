"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createProjectDeliverableAllocation,
  createProjectServiceAllocation,
  deleteProjectDeliverableAllocation,
  deleteProjectServiceAllocation,
  deleteProjectShoot,
  getProjectDeliverableAllocations,
  getProjectDeliverableDefinitions,
  getProjectServiceAllocations,
  getProjectServiceDefinitions,
  getProjectShoots,
  saveProjectShoots,
  updateProjectDeliverableAllocation,
  updateProjectServiceAllocation,
  updateProjectShoot,
} from "@/services/project-management/project-workflow.service";
import { shootTimingsOf, shootTypesOf } from "./AddShootDialog";
import { autoDeliverableNamesForServices, blockedDeliverableNamesForServices, deliverableExistsForShoot, findDeliverableDefinitionByName, isAutoDeliverableName } from "./serviceDeliverableRules";

/*
 * Editing a project's plan: its shoots, and the services and deliverables allocated to each.
 *
 * Lifted out of Start / Edit Project so Sales Manager's "Edit Sale Details" can offer the same
 * Service Creation section rather than a second implementation of it. Every change here is written
 * to the project as it is made, through the same endpoints Start Project has always used - a plan
 * is not draft state waiting on a Save button, and removing a shoot in particular is a request the
 * server has to answer for (it clears the shoot's Image Selection footprint first, and refuses with
 * a 409 when the client has already submitted selections from it).
 *
 * The panel keeps the form, the notices and the errors; this keeps the plan.
 */

const groupRowsByShoot = (items) => (items || []).reduce((result, item) => ({ ...result, [item.shootId]: [...(result[item.shootId] || []), item] }), {});
const byId = (items) => new Map((items || []).map((item) => [item.id, item]));
const byName = (items) => new Map((items || []).map((item) => [item.name?.toLocaleLowerCase(), item]).filter(([name]) => name));

function normalizeServiceAllocation(item, definitions = [], selectedDefinition = null) {
  const row = item?.data || item;
  if (!row || typeof row !== "object") return null;
  const definition = row.serviceDefinition || row.service || row.serviceMaster || selectedDefinition || byId(definitions).get(row.serviceDefinitionId) || byName(definitions).get(row.serviceName?.toLocaleLowerCase());
  const serviceName = row.serviceName || definition?.name || "";
  if (!row.id || !row.shootId || !serviceName) return null;
  return {
    ...row,
    serviceDefinitionId: row.serviceDefinitionId || definition?.id || "",
    serviceDefinition: definition || row.serviceDefinition || null,
    serviceName,
    quantitySessionTiming: row.quantitySessionTiming || row.serviceDetails || "",
    quantity: row.quantity ?? 1,
    sessionOptionId: row.sessionOptionId || "",
    sessionOption: row.sessionOption || null,
    durationHours: row.durationHours ?? "",
    durationMinutes: row.durationMinutes ?? "",
    workDays: row.workDays ?? "",
    timingMinutes: row.timingMinutes ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    remarks: row.remarks || "",
  };
}

function normalizeDeliverableAllocation(item, definitions = [], selectedDefinition = null) {
  const row = item?.data || item;
  if (!row || typeof row !== "object") return null;
  const definition = row.deliverableDefinition || row.deliverable || row.deliverableMaster || selectedDefinition || byId(definitions).get(row.deliverableDefinitionId) || byName(definitions).get(row.deliverableName?.toLocaleLowerCase());
  const deliverableName = row.deliverableName || definition?.name || "";
  if (!row.id || !row.shootId || !deliverableName) return null;
  return {
    ...row,
    deliverableDefinitionId: row.deliverableDefinitionId || definition?.id || "",
    deliverableDefinition: definition || row.deliverableDefinition || null,
    deliverableName,
    quantity: row.quantity || 1,
    numberOfPhotos: row.numberOfPhotos ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    size: row.size || "",
    remarks: row.remarks || "",
  };
}

const normalizeServiceAllocations = (items, definitions) => (items || []).map((item) => normalizeServiceAllocation(item, definitions)).filter(Boolean);
const normalizeDeliverableAllocations = (items, definitions) => (items || []).map((item) => normalizeDeliverableAllocation(item, definitions)).filter(Boolean);
const isDuplicateDeliverableError = (error) => /already added|duplicate/i.test(error?.message || "");
const mergeShootRows = (currentRows, nextRows) => {
  const rowsById = new Map((currentRows || []).map((shoot) => [shoot.id, shoot]));
  (nextRows || []).forEach((shoot) => {
    if (shoot?.id) rowsById.set(shoot.id, shoot);
  });
  return Array.from(rowsById.values());
};


/**
 * @param projectId the project whose plan is being edited; nothing loads without one.
 * @param onShootChange told after a shoot is added, edited or removed, so the screen behind can
 *   refresh its own copy of the project.
 * @param onError given a message when something fails in a way the form should say out loud.
 * @param onNotice given a message worth mentioning that is not a failure.
 * @param onSuccess given a message for something that worked.
 */
export default function useProjectPlan(projectId, { onShootChange, onError, onNotice, onSuccess } = {}) {
  const [shoots, setShoots] = useState([]);
  const [serviceDefinitions, setServiceDefinitions] = useState([]);
  const [deliverableDefinitions, setDeliverableDefinitions] = useState([]);
  const [serviceAllocations, setServiceAllocations] = useState([]);
  const [deliverableAllocations, setDeliverableAllocations] = useState([]);
  /*
   * The allocations as they stand right now, for the handlers that chain one write onto the next.
   * Auto-deliverables are synced immediately after a service is added, and reading the state
   * variable there would read the render's copy, not the row just written.
   */
  const serviceAllocationsRef = useRef([]);
  const deliverableAllocationsRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [loadingMasterData, setLoadingMasterData] = useState(true);
  const [serviceDefinitionsError, setServiceDefinitionsError] = useState("");
  const [deliverableDefinitionsError, setDeliverableDefinitionsError] = useState("");
  const [isShootDialogOpen, setIsShootDialogOpen] = useState(false);
  const [editingShoot, setEditingShoot] = useState(null);

  const servicesByShoot = useMemo(() => groupRowsByShoot(serviceAllocations), [serviceAllocations]);
  const deliverablesByShoot = useMemo(() => groupRowsByShoot(deliverableAllocations), [deliverableAllocations]);

  // Held in a ref so a caller passing fresh closures each render does not restart the load.
  const callbacks = useRef({ onShootChange, onError, onNotice, onSuccess });
  useEffect(() => { callbacks.current = { onShootChange, onError, onNotice, onSuccess }; });
  const report = useCallback((kind, message) => { callbacks.current[kind]?.(message); }, []);

  useEffect(() => { serviceAllocationsRef.current = serviceAllocations; }, [serviceAllocations]);
  useEffect(() => { deliverableAllocationsRef.current = deliverableAllocations; }, [deliverableAllocations]);

  const refreshAllocations = useCallback(async (serviceDefs, deliverableDefs) => {
    if (!projectId) return;
    const [serviceResult, deliverableResult] = await Promise.all([
      getProjectServiceAllocations(projectId),
      getProjectDeliverableAllocations(projectId),
    ]);
    const nextServices = normalizeServiceAllocations(serviceResult?.data, serviceDefs || []);
    const nextDeliverables = normalizeDeliverableAllocations(deliverableResult?.data, deliverableDefs || []);
    serviceAllocationsRef.current = nextServices;
    deliverableAllocationsRef.current = nextDeliverables;
    setServiceAllocations(nextServices);
    setDeliverableAllocations(nextDeliverables);
  }, [projectId]);

  const refreshShoots = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const shootResult = await getProjectShoots(projectId);
      setShoots(Array.isArray(shootResult?.data) ? shootResult.data : []);
    } catch (shootError) {
      setShoots([]);
      report("onError", shootError.message || "Unable to load project shoots.");
    } finally {
      setLoading(false);
    }
  }, [projectId, report]);

  /** The plan in full: the shoots, the master data, and the allocations read against it. */
  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadingMasterData(true);
    setServiceDefinitionsError("");
    setDeliverableDefinitionsError("");
    try {
      const shootResult = await getProjectShoots(projectId);
      setShoots(Array.isArray(shootResult?.data) ? shootResult.data : []);
    } catch (shootError) {
      setShoots([]);
      report("onError", shootError.message || "Unable to load project shoots.");
    } finally {
      setLoading(false);
    }
    try {
      const [serviceDefResult, deliverableDefResult] = await Promise.allSettled([getProjectServiceDefinitions(), getProjectDeliverableDefinitions()]);
      const nextServiceDefinitions = serviceDefResult.status === "fulfilled" && Array.isArray(serviceDefResult.value?.data) ? serviceDefResult.value.data : [];
      const nextDeliverableDefinitions = deliverableDefResult.status === "fulfilled" && Array.isArray(deliverableDefResult.value?.data) ? deliverableDefResult.value.data : [];
      setServiceDefinitions(nextServiceDefinitions);
      setDeliverableDefinitions(nextDeliverableDefinitions);
      if (serviceDefResult.status === "rejected") setServiceDefinitionsError(serviceDefResult.reason?.message || "Unable to load service definitions.");
      if (deliverableDefResult.status === "rejected") setDeliverableDefinitionsError(deliverableDefResult.reason?.message || "Unable to load deliverable definitions.");
      await refreshAllocations(nextServiceDefinitions, nextDeliverableDefinitions);
    } catch (masterError) {
      serviceAllocationsRef.current = [];
      deliverableAllocationsRef.current = [];
      setServiceAllocations([]);
      setDeliverableAllocations([]);
      report("onError", masterError.message || "Unable to load project allocations.");
    } finally {
      setLoadingMasterData(false);
    }
  }, [projectId, refreshAllocations, report]);

  async function saveShoots(rows) {
    if (editingShoot) {
      await saveShootEdit(editingShoot.shoot, editingShoot.index, rows[0]);
      setEditingShoot(null);
      setIsShootDialogOpen(false);
      return;
    }
    const response = await saveProjectShoots(projectId, rows);
    const createdShoots = Array.isArray(response?.data) ? response.data : [];
    setShoots((current) => mergeShootRows(current, createdShoots));
    setIsShootDialogOpen(false);
    report("onSuccess", "Shoot list saved successfully.");
    await callbacks.current.onShootChange?.();
  }

  function openAddShootDialog() {
    setEditingShoot(null);
    setIsShootDialogOpen(true);
  }

  function openEditShootDialog(shoot, index) {
    setEditingShoot({ shoot, index });
    setIsShootDialogOpen(true);
  }

  async function saveShootEdit(shoot, index, nextShoot) {
    const response = await updateProjectShoot(projectId, shoot.id, { dateCreated: nextShoot.dateCreated || shoot.dateCreated, shoot: nextShoot.shoot, shootPlace: nextShoot.shootPlace, shootTypes: shootTypesOf(nextShoot), sessionTimings: shootTimingsOf(nextShoot), shootType: nextShoot.shootType || "Studio / In-House", isMainEvent: Boolean(nextShoot.isMainEvent), district: nextShoot.district, state: nextShoot.state, sessionTiming: nextShoot.sessionTiming, sessionDurationHours: nextShoot.sessionDurationHours, sessionDurationMinutes: nextShoot.sessionDurationMinutes, foodTakenCareBy: nextShoot.foodTakenCareBy || "Studio", accommodation: nextShoot.accommodation || "Studio", travel: nextShoot.travel || "Studio", preference: nextShoot.preference });
    const updatedShoot = response?.data;
    setShoots((current) => current.map((row) => {
      if (row.id === shoot.id) return updatedShoot;
      return updatedShoot?.isMainEvent ? { ...row, isMainEvent: false } : row;
    }));
    report("onSuccess", "Shoot saved successfully.");
    await callbacks.current.onShootChange?.();
  }

  async function removeShoot(shoot, index, options) {
    try {
      await deleteProjectShoot(projectId, shoot.id, options);
      report("onSuccess", "Shoot deleted successfully.");
      await refreshShoots();
      await refreshAllocations(serviceDefinitions, deliverableDefinitions);
      await callbacks.current.onShootChange?.();
    } catch (deleteError) {
      // The high-impact 409 — the shoot's gallery holds client-submitted selections — must reach
      // the confirm dialog, which escalates to the typed warning and retries acknowledged.
      if (deleteError.data?.details?.requiresAcknowledgement) throw deleteError;
      report("onError", deleteError.message || "Unable to delete shoot.");
    }
  }

  async function addService(shoot, definition) {
    const response = await createProjectServiceAllocation(projectId, shoot.id, { serviceDefinitionId: definition.id });
    const normalized = normalizeServiceAllocation(response?.data, serviceDefinitions, definition);
    const nextServices = normalized ? [...serviceAllocationsRef.current, normalized] : serviceAllocationsRef.current;
    if (normalized) {
      serviceAllocationsRef.current = nextServices;
      setServiceAllocations(nextServices);
    }
    await syncAutoDeliverablesForShoot(shoot, nextServices.filter((row) => row.shootId === shoot.id));
    await refreshAllocations(serviceDefinitions, deliverableDefinitions);
    return normalized;
  }

  async function syncAutoDeliverablesForShoot(shoot, serviceRows = serviceAllocationsRef.current.filter((row) => row.shootId === shoot.id)) {
    const serviceNames = serviceRows.map((row) => row.serviceName).filter(Boolean);
    const names = autoDeliverableNamesForServices(serviceNames);
    const expectedNames = new Set(names.map((name) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase()));
    const blockedNames = blockedDeliverableNamesForServices(serviceNames);
    const blockedNameKeys = new Set([...blockedNames].map((name) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase()));
    const missingNames = [];
    const nextRows = [...deliverableAllocationsRef.current];
    const shouldRemoveAutoRow = (row) => {
      const key = row.deliverableName?.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      return row.shootId === shoot.id && isAutoDeliverableName(row.deliverableName) && (!expectedNames.has(key) || blockedNameKeys.has(key));
    };
    for (const row of nextRows.filter(shouldRemoveAutoRow)) {
      await deleteProjectDeliverableAllocation(projectId, row.id);
    }
    let syncedRows = nextRows.filter((item) => !shouldRemoveAutoRow(item));
    for (const name of names.filter((item) => !blockedNameKeys.has(item.trim().replace(/\s+/g, " ").toLocaleLowerCase()))) {
      const definition = findDeliverableDefinitionByName(deliverableDefinitions, name);
      if (!definition) {
        missingNames.push(name);
        continue;
      }
      if (deliverableExistsForShoot(syncedRows, shoot.id, definition)) continue;
      try {
        const response = await createProjectDeliverableAllocation(projectId, shoot.id, { deliverableDefinitionId: definition.id });
        const normalized = normalizeDeliverableAllocation(response?.data, deliverableDefinitions, definition);
        if (normalized) syncedRows.push(normalized);
      } catch (addError) {
        if (!isDuplicateDeliverableError(addError)) throw addError;
      }
    }
    deliverableAllocationsRef.current = syncedRows;
    setDeliverableAllocations(syncedRows);
    if (missingNames.length) report("onNotice", `Missing deliverable master data: ${missingNames.join(", ")}. Run npm run seed.`);
  }

  async function updateService(row, data) {
    const response = await updateProjectServiceAllocation(projectId, row.id, data);
    const normalized = normalizeServiceAllocation(response?.data, serviceDefinitions, row.serviceDefinition);
    setServiceAllocations((current) => {
      const next = current.map((item) => item.id === row.id ? normalized || item : item);
      serviceAllocationsRef.current = next;
      return next;
    });
  }

  async function removeService(row) {
    await deleteProjectServiceAllocation(projectId, row.id);
    const nextServices = serviceAllocationsRef.current.filter((item) => item.id !== row.id);
    serviceAllocationsRef.current = nextServices;
    setServiceAllocations(nextServices);
    await syncAutoDeliverablesForShoot(row.shoot || { id: row.shootId }, nextServices.filter((item) => item.shootId === row.shootId));
    await refreshAllocations(serviceDefinitions, deliverableDefinitions);
  }

  async function clearServices(rows) {
    for (const row of rows) {
      await deleteProjectServiceAllocation(projectId, row.id);
    }
    await refreshAllocations(serviceDefinitions, deliverableDefinitions);
  }

  async function addDeliverable(shoot, definition) {
    const duplicate = deliverableAllocations.some((row) => row.shootId === shoot.id && (row.deliverableDefinitionId === definition.id || row.deliverableName?.toLocaleLowerCase() === definition.name?.toLocaleLowerCase()));
    if (duplicate) {
      report("onNotice", "This deliverable is already added to the selected shoot.");
      return null;
    }
    try {
      const response = await createProjectDeliverableAllocation(projectId, shoot.id, { deliverableDefinitionId: definition.id });
      const normalized = normalizeDeliverableAllocation(response?.data, deliverableDefinitions, definition);
      if (normalized) setDeliverableAllocations((current) => {
        const next = [...current, normalized];
        deliverableAllocationsRef.current = next;
        return next;
      });
      return normalized;
    } catch (addError) {
      if (isDuplicateDeliverableError(addError)) {
        report("onNotice", "This deliverable is already added to the selected shoot.");
        return null;
      }
      report("onError", addError.message || "Unable to add deliverable.");
      return null;
    }
  }

  async function updateDeliverable(row, data) {
    const response = await updateProjectDeliverableAllocation(projectId, row.id, data);
    const normalized = normalizeDeliverableAllocation(response?.data, deliverableDefinitions, row.deliverableDefinition);
    setDeliverableAllocations((current) => {
      const next = current.map((item) => item.id === row.id ? normalized || item : item);
      deliverableAllocationsRef.current = next;
      return next;
    });
  }

  async function removeDeliverable(row) {
    await deleteProjectDeliverableAllocation(projectId, row.id);
    await refreshAllocations(serviceDefinitions, deliverableDefinitions);
  }

  async function clearDeliverables(rows) {
    for (const row of rows) {
      await deleteProjectDeliverableAllocation(projectId, row.id);
    }
    await refreshAllocations(serviceDefinitions, deliverableDefinitions);
  }


  return {
    shoots,
    serviceDefinitions,
    deliverableDefinitions,
    servicesByShoot,
    deliverablesByShoot,
    loading,
    loadingMasterData,
    serviceDefinitionsError,
    deliverableDefinitionsError,
    isShootDialogOpen,
    editingShoot,
    load,
    refreshShoots,
    refreshAllocations,
    /*
     * Named for the props `ProjectServiceCreationSection` takes, so a screen spreads them in rather
     * than restating thirteen handlers - and so a handler added here reaches both screens at once.
     */
    sectionProps: {
      shoots,
      loading,
      loadingMasterData,
      serviceDefinitionsError,
      deliverableDefinitionsError,
      serviceDefinitions,
      deliverableDefinitions,
      servicesByShoot,
      deliverablesByShoot,
      onAddShoot: openAddShootDialog,
      onAddService: addService,
      onUpdateService: updateService,
      onDeleteService: removeService,
      onClearServices: clearServices,
      onAddDeliverable: addDeliverable,
      onUpdateDeliverable: updateDeliverable,
      onDeleteDeliverable: removeDeliverable,
      onClearDeliverables: clearDeliverables,
      onSaveShootEdit: saveShootEdit,
      onDeleteShoot: removeShoot,
      onRequestEditShoot: openEditShootDialog,
    },
    /** What `AddShootDialog` needs to open, edit and save against this project. */
    shootDialog: {
      open: isShootDialogOpen,
      initialShoot: editingShoot?.shoot,
      existingShoots: shoots,
      onClose: () => { setIsShootDialogOpen(false); setEditingShoot(null); },
      onSave: saveShoots,
    },
  };
}
