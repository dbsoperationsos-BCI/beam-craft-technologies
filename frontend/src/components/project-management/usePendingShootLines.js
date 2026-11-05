"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { autoDeliverableNamesForServices, blockedDeliverableNamesForServices, deliverableExistsForShoot, findDeliverableDefinitionByName } from "@/components/project-management/serviceDeliverableRules";
import { defaultSessionOptionId } from "@/lib/servicePricing.mjs";
import { reorderLines } from "@/lib/quotationLineOrder.mjs";
import { deliverableVariantPayload, projectDeliverableVariantFields } from "@/lib/deliverableBrands.mjs";

/*
 * The services and deliverables of shoots that do not exist yet - held on the page, written nowhere
 * until something saves them. Create Project keeps a new project's plan here, and Client Requests ->
 * Raise Request a requested shoot's: one set of rules for both, so a line picked in either is the same
 * line (its session defaulted from the shoot, the deliverables a service brings with it, a variant per
 * line) and is sent in the same shape (`servicePayload` / `deliverablePayload`).
 *
 * The handlers are the ones `ProjectServiceCreationSection` takes (`onAddService`, `onUpdateService`,
 * ...). The refs answer with the rows as they are this instant, for a handler that runs twice before
 * React renders.
 */

const byId = (items) => new Map((items || []).map((item) => [item.id, item]));
const byName = (items) => new Map((items || []).map((item) => [item.name?.toLocaleLowerCase(), item]).filter(([name]) => name));
export const groupRowsByShoot = (items) => (items || []).reduce((result, item) => ({ ...result, [item.shootId]: [...(result[item.shootId] || []), item] }), {});

export function normalizePendingService(row, definitions = []) {
  const definition = row.serviceDefinition || byId(definitions).get(row.serviceDefinitionId) || byName(definitions).get(row.serviceName?.toLocaleLowerCase());
  return {
    ...row,
    serviceDefinitionId: row.serviceDefinitionId || definition?.id || "",
    serviceDefinition: definition || null,
    serviceName: row.serviceName || definition?.name || "",
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

export function normalizePendingDeliverable(row, definitions = []) {
  const definition = row.deliverableDefinition || byId(definitions).get(row.deliverableDefinitionId) || byName(definitions).get(row.deliverableName?.toLocaleLowerCase());
  return {
    ...row,
    deliverableDefinitionId: row.deliverableDefinitionId || definition?.id || "",
    deliverableDefinition: definition || null,
    deliverableName: row.deliverableName || definition?.name || "",
    quantity: row.quantity || 1,
    numberOfPhotos: row.numberOfPhotos ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    size: row.size || "",
    remarks: row.remarks || "",
  };
}

/** One service line as the server takes it (`projectShootServiceInputSchema`). */
export const servicePayload = ({ serviceDefinitionId, quantity, sessionOptionId, durationHours, durationMinutes, workDays, timingMinutes, sizeOptionValueId, remarks }) => ({
  serviceDefinitionId,
  quantity: quantity === "" ? 1 : Number(quantity),
  sessionOptionId: sessionOptionId || null,
  durationHours: durationHours === "" ? null : Number(durationHours),
  durationMinutes: durationMinutes === "" ? null : Number(durationMinutes),
  workDays: workDays === "" ? null : Number(workDays),
  timingMinutes: timingMinutes === "" ? null : Number(timingMinutes),
  sizeOptionValueId: sizeOptionValueId || null,
  remarks: remarks || null,
});

/** One deliverable line as the server takes it (`projectShootDeliverableInputSchema`). */
export const deliverablePayload = (row) => ({
  deliverableDefinitionId: row.deliverableDefinitionId,
  quantity: Number(row.quantity || 1),
  numberOfPhotos: row.numberOfPhotos === "" ? null : Number(row.numberOfPhotos),
  sizeOptionValueId: row.sizeOptionValueId || null,
  remarks: row.remarks || null,
  // The variant the line was quoted or picked as, so the project names it the same way.
  variant: deliverableVariantPayload(row),
});

export default function usePendingShootLines({ serviceDefinitions = [], deliverableDefinitions = [] } = {}) {
  const [serviceAllocations, setServiceAllocations] = useState([]);
  const [deliverableAllocations, setDeliverableAllocations] = useState([]);
  const serviceAllocationsRef = useRef([]);
  const deliverableAllocationsRef = useRef([]);

  const replaceServices = useCallback((next) => {
    serviceAllocationsRef.current = next;
    setServiceAllocations(next);
  }, []);
  const replaceDeliverables = useCallback((next) => {
    deliverableAllocationsRef.current = next;
    setDeliverableAllocations(next);
  }, []);
  const updateServices = useCallback((change) => setServiceAllocations((current) => {
    const next = change(current);
    serviceAllocationsRef.current = next;
    return next;
  }), []);
  const updateDeliverables = useCallback((change) => setDeliverableAllocations((current) => {
    const next = change(current);
    deliverableAllocationsRef.current = next;
    return next;
  }), []);

  /** A shoot taken off the plan takes its lines with it. */
  const removeShootLines = useCallback((shootId) => {
    updateServices((current) => current.filter((row) => row.shootId !== shootId));
    updateDeliverables((current) => current.filter((row) => row.shootId !== shootId));
  }, [updateServices, updateDeliverables]);

  /*
   * Each handler keeps its identity from one render to the next (`useCallback`), changing only when
   * the studio's lists it names lines from do: the section builds its table columns from them, and a
   * new function every render rebuilt every row - a grip being dragged, or a box being typed in, was
   * replaced under the person's hand.
   */
  const addService = useCallback(async (shoot, definition) => {
    // Starts on the shoot's own session where the service offers it, the Quotation Generator's rule
    // (`defaultSessionOptionId`), and blank where it does not; the person may change it after.
    const sessionOptionId = defaultSessionOptionId(definition, shoot);
    const row = normalizePendingService({
      id: `pending-service-${shoot.id}-${definition.id}`,
      shootId: shoot.id,
      serviceDefinitionId: definition.id,
      serviceDefinition: definition,
      serviceName: definition.name,
      ...(sessionOptionId ? { sessionOptionId } : {}),
    }, serviceDefinitions);
    const nextServices = [...serviceAllocationsRef.current, row];
    replaceServices(nextServices);
    // The deliverables the shoot's services bring with them, beside what was picked by hand.
    updateDeliverables((current) => {
      const serviceNames = nextServices.filter((line) => line.shootId === shoot.id).map((line) => line.serviceName);
      const names = autoDeliverableNamesForServices(serviceNames);
      const blockedNames = blockedDeliverableNamesForServices(serviceNames);
      const nextRows = current.filter((line) => !(line.shootId === shoot.id && blockedNames.has(line.deliverableName)));
      names.filter((name) => !blockedNames.has(name)).forEach((name) => {
        const brought = findDeliverableDefinitionByName(deliverableDefinitions, name);
        if (!brought || deliverableExistsForShoot(nextRows, shoot.id, brought)) return;
        nextRows.push(normalizePendingDeliverable({
          id: `pending-deliverable-${shoot.id}-${brought.id}`,
          shootId: shoot.id,
          deliverableDefinitionId: brought.id,
          deliverableDefinition: brought,
          deliverableName: brought.name,
          quantity: 1,
        }, deliverableDefinitions));
      });
      return nextRows;
    });
    return row;
  }, [serviceDefinitions, deliverableDefinitions, replaceServices, updateDeliverables]);

  const updateService = useCallback(async (row, data) => {
    updateServices((current) => current.map((item) => item.id === row.id ? normalizePendingService({ ...item, ...data }, serviceDefinitions) : item));
  }, [serviceDefinitions, updateServices]);

  const deleteService = useCallback(async (row) => {
    updateServices((current) => current.filter((item) => item.id !== row.id));
  }, [updateServices]);

  // The lines are sent shoot by shoot in array order, and saved in it - so the order is the array's.
  const reorderServices = useCallback((_shootId, ids) => {
    replaceServices(reorderLines(serviceAllocationsRef.current, ids));
  }, [replaceServices]);

  const reorderDeliverables = useCallback((_shootId, ids) => {
    replaceDeliverables(reorderLines(deliverableAllocationsRef.current, ids));
  }, [replaceDeliverables]);

  const addDeliverable = useCallback(async (shoot, definition, variant = null) => {
    const row = normalizePendingDeliverable({
      // The variant is part of the key: two variants of one deliverable are two lines on a shoot.
      id: `pending-deliverable-${shoot.id}-${definition.id}${variant?.variantId ? `-${variant.variantId}` : ""}`,
      shootId: shoot.id,
      deliverableDefinitionId: definition.id,
      deliverableDefinition: definition,
      deliverableName: definition.name,
      quantity: 1,
      ...projectDeliverableVariantFields(variant),
    }, deliverableDefinitions);
    updateDeliverables((current) => [...current, row]);
    return row;
  }, [deliverableDefinitions, updateDeliverables]);

  const updateDeliverable = useCallback(async (row, data) => {
    updateDeliverables((current) => current.map((item) => item.id === row.id ? normalizePendingDeliverable({ ...item, ...data }, deliverableDefinitions) : item));
  }, [deliverableDefinitions, updateDeliverables]);

  const deleteDeliverable = useCallback(async (row) => {
    updateDeliverables((current) => current.filter((item) => item.id !== row.id));
  }, [updateDeliverables]);

  const servicesByShoot = useMemo(() => groupRowsByShoot(serviceAllocations), [serviceAllocations]);
  const deliverablesByShoot = useMemo(() => groupRowsByShoot(deliverableAllocations), [deliverableAllocations]);

  return {
    serviceAllocations,
    deliverableAllocations,
    serviceAllocationsRef,
    deliverableAllocationsRef,
    servicesByShoot,
    deliverablesByShoot,
    replaceServices,
    replaceDeliverables,
    removeShootLines,
    addService,
    updateService,
    deleteService,
    reorderServices,
    reorderDeliverables,
    addDeliverable,
    updateDeliverable,
    deleteDeliverable,
  };
}
