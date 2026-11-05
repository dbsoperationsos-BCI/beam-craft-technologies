"use client";

import { useCallback, useState } from "react";
import { getCrmEmployees } from "@/services/sales/employees.service";
import { getWhatsappGroupNames } from "@/services/sales/whatsapp-group-names.service";

/**
 * The two lists `CreateProjectFormPanel` picks from: the saved WhatsApp group names, and the SALES
 * employees a record can name.
 *
 * Loaded on demand rather than with the page, because both are only wanted once the panel opens -
 * and both are wanted by every screen that opens it, which is why they are a hook and not a copy of
 * the same two loaders in each page.
 */
export default function useProjectFormPickers({ onError } = {}) {
  const [groupNames, setGroupNames] = useState([]);
  const [isLoadingGroupNames, setIsLoadingGroupNames] = useState(false);
  const [crmEmployees, setCrmEmployees] = useState([]);
  const [isLoadingCrmEmployees, setIsLoadingCrmEmployees] = useState(false);

  const loadGroupNames = useCallback(async ({ notifyOnError = true } = {}) => {
    setIsLoadingGroupNames(true);
    try {
      const response = await getWhatsappGroupNames();
      setGroupNames(Array.isArray(response?.data) ? response.data : []);
      return true;
    } catch (error) {
      if (notifyOnError) onError?.(error.message || "Unable to load available WhatsApp group names.");
      return false;
    } finally {
      setIsLoadingGroupNames(false);
    }
  }, [onError]);

  const loadCrmEmployees = useCallback(async ({ notifyOnError = true } = {}) => {
    setIsLoadingCrmEmployees(true);
    try {
      const response = await getCrmEmployees();
      setCrmEmployees(Array.isArray(response?.data) ? response.data : []);
      return true;
    } catch (error) {
      if (notifyOnError) onError?.(error.message || "Unable to load SALES employees.");
      return false;
    } finally {
      setIsLoadingCrmEmployees(false);
    }
  }, [onError]);

  /** Both at once, which is what opening the panel always wants. */
  const loadPickers = useCallback(async (options) => {
    await Promise.all([loadGroupNames(options), loadCrmEmployees(options)]);
  }, [loadCrmEmployees, loadGroupNames]);

  return { groupNames, isLoadingGroupNames, crmEmployees, isLoadingCrmEmployees, loadGroupNames, loadCrmEmployees, loadPickers };
}
