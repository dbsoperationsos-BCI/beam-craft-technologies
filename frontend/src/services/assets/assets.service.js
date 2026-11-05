import { apiRequest } from "@/services/api/client";
import { readEveryPage } from "@/lib/everyPage.mjs";

const query = (params = {}) => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
export const getAssetCategories = (params) => apiRequest(`/api/asset-categories?${query(params)}`);
export const getAssetCategoryTree = () => apiRequest("/api/asset-categories/tree");
export const getAssetCustody = (assetId) => apiRequest(`/api/assets/${assetId}/custody`);
export const getAssetRequests = (params) => apiRequest(`/api/asset-requests?${query(params)}`);
export const getAllAssetRequests = (params) => readEveryPage((page, limit) => getAssetRequests({ ...params, page, limit }));
export const createAssetRequest = (payload) => apiRequest("/api/asset-requests", { method: "POST", body: JSON.stringify(payload) });
// Approving carries the whole Add Asset form: the asset asked for is added as part of the decision.
export const approveAssetRequest = (id, asset) => apiRequest(`/api/asset-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ asset }) });
export const rejectAssetRequest = (id, remarks) => apiRequest(`/api/asset-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ remarks }) });
export const getAssets = (params) => apiRequest(`/api/assets?${query(params)}`);
/** Every asset the filters match, for the register's table and board - not one page of them. */
export const getAllAssets = (params) => readEveryPage((page, limit) => getAssets({ ...params, page, limit }));
export const createAsset = (payload) => apiRequest("/api/assets", { method: "POST", body: JSON.stringify(payload) });
export const createAssetsBulk = (payload) => apiRequest("/api/assets/bulk", { method: "POST", body: JSON.stringify(payload) });
export const updateAsset = (id, payload) => apiRequest(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteAsset = (id) => apiRequest(`/api/assets/${id}`, { method: "DELETE" });
export const changeAssetStatus = (id, payload) => apiRequest(`/api/assets/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) });
export const getAssetInspectionContext = (id) => apiRequest(`/api/assets/${id}/inspections/context`);
export const createAssetInspection = (id, payload) => apiRequest(`/api/assets/${id}/inspections`, { method: "POST", body: JSON.stringify(payload) });
export const getVendors = (params) => apiRequest(`/api/vendors?${query(params)}`);
/** Every vendor the filters match, for the register's table and board - not one page of them. */
export const getAllVendors = (params) => readEveryPage((page, limit) => getVendors({ ...params, page, limit }));
export const getVendorOptions = (search) => apiRequest(`/api/vendors/options?${query({ q: search })}`);
// Active vendor names for the asset status dialog's picker. Separate from getVendors because that
// one reads the vendor records and now answers to ASSET / Vendor Management, while sending an asset
// for service is Asset Management's own business.
export const getVendorPicker = () => apiRequest("/api/vendors/picker");
export const createVendor = (payload) => apiRequest("/api/vendors", { method: "POST", body: JSON.stringify(payload) });
export const updateVendor = (id, payload) => apiRequest(`/api/vendors/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
export const changeVendorStatus = (id, payload) => apiRequest(`/api/vendors/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) });
export const removeVendor = (id, reason) => apiRequest(`/api/vendors/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
export const getClientStorageRecords = (params) => apiRequest(`/api/client-storage?${query(params)}`);
/** Every client storage record the filters match, for the register's table and board - not one page of them. */
export const getAllClientStorageRecords = (params) => readEveryPage((page, limit) => getClientStorageRecords({ ...params, page, limit }));
export const getClientStorageShoots = (search) => apiRequest(`/api/client-storage/shoots?${query({ q: search })}`);
export const getClientStorageOptions = () => apiRequest("/api/client-storage/options");
/** One record, with the moves it may make next (`nextStatuses`). */
export const getClientStorageRecord = (id) => apiRequest(`/api/client-storage/${id}`);
export const createClientStorageRecord = (payload = {}) => apiRequest("/api/client-storage", { method: "POST", body: JSON.stringify(payload) });
export const updateClientStorageRecord = (id, payload) => apiRequest(`/api/client-storage/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
export const changeClientStorageStatus = (id, payload) => apiRequest(`/api/client-storage/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) });
export const removeClientStorageRecord = (id, reason) => apiRequest(`/api/client-storage/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
