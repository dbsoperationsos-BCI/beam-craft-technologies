import { apiRequest } from "@/services/api/client";

export function getCrmEmployees() {
  return apiRequest("/api/sales/crm-employees");
}

export function getActiveSalesEmployees() {
  return apiRequest("/api/sales/active-employees");
}
