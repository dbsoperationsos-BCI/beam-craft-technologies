import { apiRequest } from "@/services/api/client";

// Resource Management → Recycling Bin: deleted projects, restored or deleted permanently.
export const getRecycledProjects = () => apiRequest("/api/recycling-bin/projects");
export const getRecycledProject = (id) => apiRequest(`/api/recycling-bin/projects/${encodeURIComponent(id)}`);
export const restoreRecycledProject = (id) => apiRequest(`/api/recycling-bin/projects/${encodeURIComponent(id)}/restore`, { method: "POST" });
// `confirmEventId` is the Event ID the person confirmed; the server erases nothing unless it matches.
export const deleteRecycledProjectPermanently = (id, confirmEventId) => apiRequest(`/api/recycling-bin/projects/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmEventId }) });
