import { apiRequest } from "@/services/api/client";

// Sales -> Client Chats: the chats clients start from their app, and the team's replies.
export function listClientChats({ unread = false } = {}) {
  return apiRequest(`/api/sales/client-chats${unread ? "?unread=1" : ""}`);
}

export function getClientChat(id) {
  return apiRequest(`/api/sales/client-chats/${id}`);
}

export function replyClientChat(id, body) {
  return apiRequest(`/api/sales/client-chats/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}

export function setClientChatStatus(id, status) {
  return apiRequest(`/api/sales/client-chats/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}
