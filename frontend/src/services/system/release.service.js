import { apiRequest } from "@/services/api/client";

// The release this server is running - its version, when it was deployed, and what changed in it,
// read from the changelog's current section - for the Release Information dialog.
export const getReleaseInfo = () => apiRequest("/api/release");
