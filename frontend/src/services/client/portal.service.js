import { apiRequest } from "@/services/api/client";

/**
 * The signed-in client's own project, in the shape `ProjectTracker` draws. The server finds it from
 * the client's account - there is no id to pass - and sends only what a client is meant to see.
 */
export const getClientProject = () => apiRequest("/api/client/project");
