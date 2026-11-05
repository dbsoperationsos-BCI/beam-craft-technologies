import { apiRequest } from "@/services/api/client";

/**
 * Visual Curation module projects, one function per API route
 * (`backend/src/modules/image-selection/projects/moduleProjects.routes.js`). Every route answers to
 * the module's own permission on the server - these only carry the requests.
 */
const base = "/api/image-selection/module-projects";

// One submission, every module ticked: the current module and its Linked Modules, each a project
// of its own, all created or none. Answers { workspaceId, sourceModule, projects: [{ module, id, projectCode, projectName }] }.
export const createVisualCurationProject = (payload) => apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
// AI Culling's, AI Editing's or Signature Album's own projects (and those from Project Management).
export const listModuleProjects = (module, { search = "" } = {}) => apiRequest(`${base}?${new URLSearchParams({ module, search })}`);
// The module project's own name and client - never another module's.
export const editModuleProject = (recordId, payload) => apiRequest(`${base}/${encodeURIComponent(recordId)}`, { method: "PATCH", body: JSON.stringify(payload) });
// This module lets go of the project; the photo workspace goes too only when it was the last module.
export const deleteModuleProject = (recordId, { acknowledgeSubmitted = false } = {}) => apiRequest(`${base}/${encodeURIComponent(recordId)}${acknowledgeSubmitted ? "?acknowledgeSubmitted=true" : ""}`, { method: "DELETE" });
