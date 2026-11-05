import { apiRequest, API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * The one way the browser talks to Nebula.
 *
 * Every call goes to the CRM's own API, never to Ollama. The model is bound to loopback on the
 * server and has no authentication of its own, so reaching it from a browser would mean exposing an
 * unauthenticated service to the internet.
 *
 * `module` travels with each call and is a request rather than an assertion - the backend decides
 * whether the caller may work in it, from their permissions in the database. Sending "GLOBAL" from
 * here does not make anybody a Super Admin.
 */

/** Whether Nebula is usable, and which modules this person may open. */
export function fetchAiHealth() {
  return apiRequest("/api/ai/health");
}

/** One turn. `conversationId` continues a thread; leaving it out starts one. */
export function askAi({ module, message, history = [], conversationId, vertical }) {
  return apiRequest("/api/ai/chat", {
    method: "POST",
    // Stringified here: apiRequest hands `body` straight to fetch.
    // `vertical` narrows a CRM session to the board on screen. The backend validates it, and it can
    // only ever narrow - sending nonsense scopes to nothing rather than widening anything.
    body: JSON.stringify({ module, message, history, conversationId, vertical }),
  });
}

/**
 * One turn, streamed.
 *
 * `apiRequest` is not used here: it reads a JSON body, and the whole point is to show the answer as
 * it is written rather than after it is finished. Server-sent events arrive over a plain fetch, and
 * `signal` lets the reader stop a generation that is going nowhere.
 *
 * Falls back to nothing clever if the stream breaks - the caller keeps whatever arrived, which is
 * more use than discarding a half-written answer.
 */
/*
 * `history` carries the conversation with the question, and the server then writes nothing down.
 *
 * That is what makes the module assistant session-only: after a refresh there is no record to find,
 * rather than a record the panel merely declines to show. A caller that wants a thread it can come
 * back to sends `conversationId` instead and the server keeps it - the lead assistant does neither,
 * having its own endpoint and its own per-lead storage.
 */
export async function streamAi({ module, message, history, conversationId, vertical, signal }, handlers = {}) {
  const response = await fetch(`${API_URL}/api/ai/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: JSON.stringify({ module, message, history, conversationId, vertical }),
    signal,
  });
  // A refusal before the stream opens carries its reason in a JSON body; that is what is shown.
  if (!response.ok || !response.body) {
    const refusal = await response.json().catch(() => null);
    throw new Error(refusal?.message || `The assistant responded ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    /*
     * Events are blank-line separated. A network chunk almost always ends mid-event, so the tail
     * stays in the buffer until the blank line that completes it arrives - splitting on every chunk
     * boundary instead drops a token here and there, which reads as the model misspelling words.
     */
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const name = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
      const payload = /^data:\s*(.+)$/m.exec(block)?.[1];
      if (!payload) continue;
      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }
      handlers[name]?.(parsed);
    }
  }
}

/**
 * Turns a recording into text, on the studio's own server.
 *
 * FormData rather than JSON, and no Content-Type set by hand: the browser writes the multipart
 * boundary itself, and naming the type would send it without one so the file would be lost.
 */
export function transcribeVoice({ blob, module }) {
  const form = new FormData();
  form.append("audio", blob, "voice.webm");
  if (module) form.append("module", module);
  return apiRequest("/api/ai/voice", { method: "POST", body: form });
}

/** This person's threads in one module. */
export function listAiConversations(module) {
  return apiRequest(`/api/ai/conversations?module=${encodeURIComponent(module)}`);
}

/** What the assistant can look up in this module. */
export function listAiTools(module) {
  return apiRequest(`/api/ai/tools?module=${encodeURIComponent(module)}`);
}
