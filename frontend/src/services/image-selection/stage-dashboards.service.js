import { apiRequest } from "@/services/api/client";

/**
 * The AI Culling, AI Editing and Signature Album dashboards, one function per API route. Each
 * route answers to its own stage's permission server-side
 * (`backend/src/modules/image-selection/stage-dashboards/routes.js`); these only carry the reads.
 */

const base = "/api/image-selection/stage-dashboards";
const withRange = (path, range) => apiRequest(`${base}/${path}${range ? `?${new URLSearchParams({ range })}` : ""}`);

export const getAiCullingDashboard = ({ range } = {}) => withRange("ai-culling", range);
export const getAiEditingDashboard = ({ range } = {}) => withRange("ai-editing", range);
export const getSignatureAlbumDashboard = ({ range } = {}) => withRange("signature-album", range);
