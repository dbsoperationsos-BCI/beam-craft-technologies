import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

// The CRM's own WhatsApp link. One per signed-in user: the session is theirs, not the app's.
export function getWhatsappSession() {
  return apiRequest("/api/sales/whatsapp-chat/session");
}

/**
 * Whether the signed-in user's **own** WhatsApp is linked, and whether they are allowed to link it.
 *
 * The same answer `getWhatsappSession` gives, from a route that sits above the CRM Leads guard -
 * because the question is about the person asking, not about a lead. HR offering to send an
 * onboarding invite or a new joiner's login from their own account has to know this, and holds
 * `HRM / Employee Management` rather than `SALES / CRM Leads`.
 */
export function getMyWhatsappSession() {
  return apiRequest("/api/sales/whatsapp-chat/my-session");
}

// The lead goes with it so the link is recorded in that lead's activity log - it is where the
// button was pressed, and where anyone looking for it will look.
export function connectWhatsapp(enquiryId = "") {
  return apiRequest("/api/sales/whatsapp-chat/session/connect", {
    method: "POST",
    body: JSON.stringify({ enquiryId }),
  });
}

export function logoutWhatsapp(enquiryId = "") {
  return apiRequest("/api/sales/whatsapp-chat/session/logout", {
    method: "POST",
    body: JSON.stringify({ enquiryId }),
  });
}


/*
 * `phone` on these calls is the WhatsApp Number being typed into the lead popup and not yet saved.
 *
 * The popup holds its edits until Update, so without carrying it the chat beside the field would
 * say "this lead has no WhatsApp number" about a number the CRM is looking straight at. The server
 * takes it only when it is a whole, valid number and otherwise falls back to the one stored on the
 * lead, so a half-typed number changes nothing.
 */

// One lead, one thread. The reply carries the session state with it, so a panel that is polling
// for new messages learns about a dropped connection without a second request for it.
export function getWhatsappThread(enquiryId, phone = "") {
  const query = phone ? `?phone=${encodeURIComponent(phone)}` : "";
  return apiRequest(`/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/messages${query}`);
}

export function sendWhatsappMessage(enquiryId, body, phone = "") {
  return apiRequest(`/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, phone }),
  });
}

// Who can chat and whether their WhatsApp is linked. Read by User Settings, which lists the CRMs
// rather than a single session.
export function getWhatsappUsers() {
  return apiRequest("/api/sales/whatsapp-chat/users");
}

// An attachment goes as multipart, so the JSON body helper cannot carry it. The browser sets the
// multipart boundary itself - naming a Content-Type here would break the upload.
export function sendWhatsappAttachment(enquiryId, file, caption = "", { voice = false, phone = "" } = {}) {
  const form = new FormData();
  form.append("file", file);
  if (caption) form.append("caption", caption);
  if (phone) form.append("phone", phone);
  // Says the microphone made this, so the server sends it as a voice note rather than as an
  // audio file. Guessing it from the mime type made every uploaded .ogg a voice note.
  if (voice) form.append("voice", "1");
  return apiRequest(`/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/attachments`, {
    method: "POST",
    body: form,
  });
}

// Telling WhatsApp the client's messages have been seen, which is what puts blue ticks on their
// side of the conversation.
export function markWhatsappThreadRead(enquiryId, phone = "") {
  return apiRequest(`/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/read`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

/**
 * A file from the thread, fetched from WhatsApp the moment View or Download is pressed.
 *
 * The CRM keeps no copy, so this is WhatsApp's own file passed through the server; it resolves to a
 * Blob for the caller to show or save. The endpoint is behind the same login as everything else,
 * and a bare src on a tag sends no token - hence the fetch. A file WhatsApp no longer has rejects
 * with the server's own sentence, which tells the user to open it on their phone.
 */
export async function fetchWhatsappMedia(messageId) {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/api/sales/whatsapp-chat/messages/${encodeURIComponent(messageId)}/media`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "This file is no longer on WhatsApp. Open it on your phone.");
  }
  return response.blob();
}

/**
 * Holds a line open and calls back the moment this lead's conversation changes.
 *
 * The panel used to find out that a client had replied by re-reading the whole thread every 1.2
 * seconds. This is the server saying so instead, which is the difference between a reply appearing
 * within a second and a half and appearing as it lands.
 *
 * ── Why `fetch` and not `EventSource` ──
 *
 * `EventSource` is the browser's own SSE client and would be less code, but it cannot send a
 * header - and every route in this application is behind a `Bearer` token. The alternatives were
 * putting the token in the query string, where it would end up in access logs and browser history,
 * or reading the stream by hand. This reads it by hand.
 *
 * ── What it promises ──
 *
 * Only that `onChange` is called when something happened. What changed is deliberately not carried:
 * the panel re-reads the thread through `getWhatsappThread`, so what a message looks like is decided
 * in one place on the server rather than a second time here.
 *
 * Returns the function that closes the line. Callers must call it - a stream left open outlives the
 * panel that opened it. It never throws and never rejects: a stream that will not open is a slower
 * panel, not a broken one, and `onDown` is what tells it to keep polling instead.
 */
export function subscribeToWhatsappThread(enquiryId, { onChange, onUp, onDown } = {}) {
  const controller = new AbortController();
  let closed = false;

  const stop = () => {
    if (closed) return;
    closed = true;
    controller.abort();
  };

  void (async () => {
    try {
      const token = getAccessToken();
      const response = await fetch(
        `${API_URL}/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/stream`,
        {
          headers: token ? { Authorization: `Bearer ${token}`, Accept: "text/event-stream" } : { Accept: "text/event-stream" },
          signal: controller.signal,
          // A stream must not be served from a cache, and must not keep the page's own connection
          // pool waiting behind it on a browser that limits connections per origin.
          cache: "no-store",
        },
      );
      if (!response.ok || !response.body) {
        onDown?.();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        /*
         * SSE frames are separated by a blank line, and a read can end anywhere - mid-frame, or
         * with several frames at once. So whole frames are taken off the front and whatever is left
         * waits for the next read.
         */
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          // `:` is a comment, which is what the server's heartbeat is - it keeps the line open
          // through a load balancer and means nothing else.
          if (!frame.startsWith(":")) {
            const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
            if (event === "ready") onUp?.();
            else if (event === "changed") onChange?.();
          }
          split = buffer.indexOf("\n\n");
        }
      }
      // The server ended it, or the connection dropped. Either way the panel is on its own again.
      if (!closed) onDown?.();
    } catch {
      // `abort` lands here too, which is the ordinary way this ends - so the panel is only told
      // the line is down if it did not close it itself.
      if (!closed) onDown?.();
    }
  })();

  return stop;
}

// Asks WhatsApp for the part of the conversation before the oldest message held here. What comes
// back arrives on the server's socket, so the thread's own refresh is what shows it.
export function loadOlderWhatsappMessages(enquiryId, phone = "") {
  return apiRequest(`/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/history`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

// Reply, react, forward, pin or delete one message in a lead's thread.
export function actOnWhatsappMessage(enquiryId, messageId, action, phone = "") {
  return apiRequest(
    `/api/sales/whatsapp-chat/leads/${encodeURIComponent(enquiryId)}/messages/${encodeURIComponent(messageId)}/actions`,
    { method: "POST", body: JSON.stringify({ ...action, phone }) },
  );
}

// Ends another CRM's WhatsApp link. Super Admin only, and enforced on the server.
export function disconnectWhatsappUser(userId) {
  return apiRequest(`/api/sales/whatsapp-chat/users/${encodeURIComponent(userId)}/disconnect`, { method: "POST" });
}

/**
 * Switches one CRM's WhatsApp on or off.
 *
 * Super Admin only, enforced on the server. Switching a CRM off disconnects them as well as
 * blocking them; their conversations are kept and reappear when they link again.
 */
export function setWhatsappUserEnabled(userId, enabled) {
  return apiRequest(`/api/sales/whatsapp-chat/users/${encodeURIComponent(userId)}/settings`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

// Whether WhatsApp chat is available at all, and whether this account may change that. Answered
// for anyone signed in, because a CRM whose Link button is refusing them needs to know why.
export function getWhatsappChatSettings() {
  return apiRequest("/api/sales/whatsapp-chat/settings");
}

// The studio-wide switch. Super Admin only, enforced on the server; switching it off disconnects
// every linked CRM as well as closing the door on new links.
export function setWhatsappChatEnabled(enabled) {
  return apiRequest("/api/sales/whatsapp-chat/settings", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

/**
 * The studio's WhatsApp usage limits.
 *
 * All three every time, because the server stores all three every time: a box left empty is a
 * limit handed back to the app's default, and sending only the ones with numbers in them could
 * never say that. Needs User Settings Read / Write, enforced on the server.
 */
export function setWhatsappChatLimits(limits) {
  return apiRequest("/api/sales/whatsapp-chat/settings/limits", {
    method: "POST",
    body: JSON.stringify({ limits }),
  });
}
