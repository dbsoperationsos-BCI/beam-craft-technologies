import { apiRequest } from "@/services/api/client";

/**
 * Watermark Presets (/api/ai-feature/watermark-presets). Listing and drawing a text mark answer to
 * Read on AI Feature or AI Event Default Settings; saving and deleting to AI Event Default Settings
 * Read / Write.
 */
const base = "/api/ai-feature/watermark-presets";
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

export const listWatermarkPresets = () => apiRequest(base);
export const createWatermarkPreset = (payload) => apiRequest(base, json("POST", payload));
export const updateWatermarkPreset = (id, payload) => apiRequest(`${base}/${encodeURIComponent(id)}`, json("PUT", payload));
export const deleteWatermarkPreset = (id) => apiRequest(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
/** The server's own drawing of a text mark, `{ dataUrl, width, height }`, so a preview matches what guests get. */
export const drawWatermarkText = (payload) => apiRequest(`${base}/text-mark`, json("POST", payload));
