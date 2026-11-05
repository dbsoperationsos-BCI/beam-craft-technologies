import { apiRequest } from "@/services/api/client";

// The studio's culling-training consent and the learned-ranker registry (read-only), under
// Settings / Organization: /api/image-selection/culling-learning.
const base = "/api/image-selection/culling-learning";

export const getCullingTrainingConsent = () => apiRequest(`${base}/consent`);
export const setCullingTrainingConsent = (consent) => apiRequest(`${base}/consent`, { method: "PATCH", body: JSON.stringify({ consent }) });
export const listCullingModels = () => apiRequest(`${base}/models`);
