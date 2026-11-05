import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

// The signed-in account itself: name, email and the photo on its linked employee record.
export const getMyProfile = () => apiRequest("/api/user/profile");

// The details on the login: username and email, and the name where no employee record supplies it.
export const updateMyProfile = (details) =>
  apiRequest("/api/user/profile", {
    method: "PATCH",
    body: JSON.stringify(details),
  });

// A fresh pick travels as a compressed data URI, the same way the employee form sends one;
// null clears the photo.
export const updateMyProfilePhoto = (profilePhotoUrl) =>
  apiRequest("/api/user/profile-photo", {
    method: "PATCH",
    body: JSON.stringify({ profilePhotoUrl }),
  });

// The reporting chart, self-service: defaults to the caller's own record; an employeeId walks it.
export const getMyOrgChart = (employeeId) =>
  apiRequest(`/api/user/org-chart${employeeId ? `?employeeId=${employeeId}` : ""}`);

// One's own password, on the strength of knowing the current one.
export const changeMyPassword = (currentPassword, newPassword) =>
  apiRequest("/api/user/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });

/**
 * The photo as a file to save, rather than as a URL to look at.
 *
 * Not `apiRequest`, which reads every answer as JSON - this one is the image itself. The route
 * answers with the bytes and the name to save them under, which is what makes a download work for
 * a photo held on the storage bucket: the bucket is another origin and would refuse this read.
 */
export async function downloadMyProfilePhoto() {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api/user/profile-photo/download`, { headers });
  if (!response.ok) {
    const message = await response.json().then((body) => body?.message).catch(() => null);
    throw new Error(message || "Unable to download your photo.");
  }
  return response.blob();
}
