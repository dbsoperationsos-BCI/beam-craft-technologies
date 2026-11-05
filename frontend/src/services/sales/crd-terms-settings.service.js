import { apiRequest } from "@/services/api/client";

const base = "/api/sales/crd-terms-settings";

export const getCrdTermsSettings = () => apiRequest(base);
export const saveCrdTermsSettings = (payload) => apiRequest(base, { method: "PATCH", body: JSON.stringify(payload) });
