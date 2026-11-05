"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest, API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";
import Button from "@/components/shared/Button";
import NebulaComposer from "@/components/ai/NebulaComposer";
import { getActiveVertical } from "@/lib/ai/activeVertical";

/**
 * Nebula - the CRM's assistant.
 *
 * Two scopes, one panel. In the lead popup it works on a single lead and knows that lead's whole
 * history. Opened from the CRM header it works on the module: the pipeline, follow-ups, sources and
 * conversions across every lead. The conversation, the streaming, the stored history and the
 * failure handling are identical, so they are not written twice - only the endpoint, the thread it
 * is stored under and the questions offered on an empty panel differ.
 *
 * A conversation, and nothing else. There was a separate "Lead analysis" card with its own button;
 * it produced a wall of fields nobody had asked for, and anything it offered can be had by asking -
 * "what should I do with this lead?" is a better interface than a button that always answers the
 * same question the same way.
 *
 * The answer streams. On this hardware a reply takes the better part of a minute, and a panel that
 * sits blank for that long reads as broken rather than as thinking.
 *
 * The model runs on the server and is never reachable from a browser - it has no authentication of
 * its own - so everything here goes through the CRM's own API with the usual token.
 */

/*
 * Each lead's conversation, kept.
 *
 * Leaving the tab and coming back used to clear the thread, which threw away work: the answers are
 * the useful part, and re-asking costs another half-minute of the model's time.
 *
 * Kept per lead and in this browser. localStorage rather than a table because the conversation is
 * one person's working notes on one lead - it is not a record the studio needs, and storing chats
 * about clients on the server is a thing to do deliberately, not by default. Every access is
 * guarded: a private window or blocked site data throws rather than returning empty.
 */
const STORE_PREFIX = "dbs_nebula_chat_";

/**
 * The key a lead's conversation is stored under.
 *
 * Not the enquiry id on its own, and that distinction is the whole point of this function.
 *
 * Enquiry ids are reissued. A new lead's id comes from `MAX(existing) + 1`, so when rows are
 * removed - a cancelled CSV import discards its whole reserved range - the maximum falls back and
 * the next lead created is handed an id a previous client already had. The browser still holds that
 * conversation under that key, so a brand new lead opens showing somebody else's chat: their name,
 * their budget, what was said about them.
 *
 * That is a privacy fault rather than an untidy one, so the key carries something that changes when
 * the lead behind the id changes. `createdDate` and `addedTime` are on every lead and are fixed at
 * the moment it was created, so a reissued id produces a different key and starts an empty thread.
 */
function threadKeyFor(leadId, lead) {
  const id = String(leadId || "").trim();
  if (!id) return "";
  const stamp = `${lead?.createdDate || ""}${lead?.addedTime || ""}`.replace(/[^0-9a-z]/gi, "");
  // Without a stamp the id alone would be reused, so an unidentifiable lead gets no stored thread
  // rather than somebody else's.
  return stamp ? `${STORE_PREFIX}${id}__${stamp}` : "";
}

/**
 * Forgets conversations for leads that no longer exist.
 *
 * Threads are per browser and nothing ever cleaned them up, so a machine that has worked a few
 * thousand leads carries a few thousand dead keys - and every one of them is a client conversation
 * sitting in local storage indefinitely. Anything older than the cutoff goes.
 */
const THREAD_TTL_DAYS = 60;

function pruneOldThreads() {
  if (typeof window === "undefined") return;
  try {
    const cutoff = Date.now() - THREAD_TTL_DAYS * 86_400_000;
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith(STORE_PREFIX)) continue;
      /*
       * A key from before this fingerprint existed cannot be trusted to belong to the lead whose id
       * it names, so it is dropped rather than migrated.
       */
      if (!key.includes("__")) { window.localStorage.removeItem(key); continue; }
      const turns = JSON.parse(window.localStorage.getItem(key) || "[]");
      const last = Array.isArray(turns) ? turns[turns.length - 1] : null;
      if (last?.at && last.at < cutoff) window.localStorage.removeItem(key);
    }
  } catch {
    // Private window, blocked storage, or a malformed entry. Nothing here is worth failing over.
  }
}
// The module conversation is one thread, not one per lead, so it gets a key of its own.
const CRM_THREAD = "crm";
// Enough to hold a working conversation without filling the browser's quota with old threads.
const MAX_STORED_TURNS = 40;

function loadTurns(key) {
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTurns(key, turns) {
  if (!key || typeof window === "undefined") return;
  try {
    // A half-written answer is not worth keeping; an errored turn is, so the reader can see what
    // happened when they come back.
    /*
     * Stamped on the way out, so `pruneOldThreads` can tell an old conversation from a live one.
     * Written here rather than per turn because only the last one is ever read for age.
     */
    const keep = turns
      .filter((turn) => turn.content || turn.error)
      .slice(-MAX_STORED_TURNS)
      .map((turn, index, all) => (index === all.length - 1 ? { ...turn, at: Date.now() } : turn));
    window.localStorage.setItem(key, JSON.stringify(keep));
  } catch {
    // Quota, a private window, or site data blocked. The conversation still works for this visit.
  }
}

// Offered on an empty thread, because a blank box with a cursor tells nobody what this can do.
const OPENERS = {
  lead: [
    "Summarise this lead",
    "What should I do next?",
    "Draft a follow-up message",
    "Is anything being missed here?",
  ],
  crm: [
    "How is my pipeline doing?",
    "Who is behind on follow-ups?",
    "Where are my leads coming from?",
    "Does anything look wrong with my data?",
  ],
};

// What each scope is called and where it asks. The panel reads everything else from here.
const SCOPES = {
  lead: {
    endpoint: "/api/sales/crm-ai/chat/stream",
    placeholder: "Ask Nebula about this lead",
    subtitle: "Ask about this lead, or about how to handle it.",
  },
  crm: {
    endpoint: "/api/sales/crm-ai/crm/chat/stream",
    placeholder: "Ask Nebula about the CRM",
    subtitle: "Ask about the pipeline, follow-ups, sources or conversions.",
  },
};


/**
 * A meeting Nebula worked out from the message, waiting to be confirmed.
 *
 * Deliberately not automatic. Confirming books a Google event, attaches a Meet link and emails the
 * invite to the addresses listed - to a real client, with no way to take it back if the model
 * misread "4" as "40" or invented an address. So the details are shown as they will be sent, and a
 * person presses the button.
 *
 * The booking itself goes through the CRM's existing meeting endpoint, which is what the Meetings
 * tab reads and what carries the permission check. Nothing about scheduling is reimplemented here.
 */
function MeetingProposal({ leadId, meeting, onError }) {
  const [state, setState] = useState("idle");
  const [booked, setBooked] = useState(null);

  // The message did not say enough to book anything - Nebula asks for the rest in its answer.
  if (!meeting?.ready) return null;

  const { title, startAt, durationMinutes, attendees } = meeting.request;
  const when = new Date(startAt);
  const readable = when.toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    hour12: true, timeZone: "Asia/Kolkata",
  });

  async function confirm() {
    setState("booking");
    try {
      const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}/meetings`, {
        method: "POST",
        // Stringified here: apiRequest hands `body` straight to fetch, so an object arrives at the
        // server as the literal text "[object Object]" and is rejected by the JSON parser.
        body: JSON.stringify(meeting.request),
      });
      setBooked(response?.data || {});
      setState("done");
    } catch (error) {
      setState("idle");
      onError?.(error.message || "Unable to schedule this meeting.");
    }
  }

  if (state === "done") {
    return (
      <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm text-green-900">
        <p className="font-medium">Meeting scheduled.</p>
        <p className="mt-0.5 text-xs">The invite has gone to {attendees.join(", ")}. It is in the Meetings tab.</p>
        {booked?.meetLink && (
          <a href={booked.meetLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium underline">
            Open the Meet link
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm">
      <p className="font-medium text-slate-800">Schedule this meeting?</p>
      <dl className="mt-1.5 space-y-0.5 text-xs text-slate-600">
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">Subject</dt><dd>{title}</dd></div>
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">When</dt><dd>{readable} &middot; {durationMinutes} min</dd></div>
        {/* Shown in full, because this is the field a wrong answer would send to a stranger. */}
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">Invite</dt><dd className="break-all">{attendees.join(", ")}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-400">A Google Meet link is created and emailed to the people listed.</p>
      <div className="mt-2.5 flex gap-2">
        <Button variant="primary" className="rounded-md" disabled={state === "booking"} onClick={confirm}>
          {state === "booking" ? "Scheduling..." : "Schedule"}
        </Button>
      </div>
    </div>
  );
}

export default function LeadAiPanel({ leadId, lead, scope = "lead", onError }) {
  const mode = SCOPES[scope] ? scope : "lead";
  const config = SCOPES[mode];
  /*
   * One thread per lead *instance*, and one for the module as a whole.
   *
   * Empty when the lead cannot be identified, which loads and saves nothing - better than attaching
   * the conversation to an id that may belong to someone else tomorrow.
   */
  const threadKey = mode === "crm" ? `${STORE_PREFIX}${CRM_THREAD}` : threadKeyFor(leadId, lead);
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef(null);

  /*
   * Ask the server whether the model is usable before anything is attempted.
   *
   * A local model is a process someone can stop. Saying so up front, with the command that fixes
   * it, is more use than letting the first question fail.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiRequest("/api/sales/crm-ai/health");
        if (!cancelled) setStatus(response?.data || null);
      } catch {
        if (!cancelled) setStatus({ ok: false, reason: "The AI service could not be reached." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /*
   * A different lead is a different subject, so the thread is swapped - not merged, and not thrown
   * away. Whatever was said about this lead before comes back with it.
   */
  useEffect(() => { setTurns(loadTurns(threadKey)); }, [threadKey]);

  // Dead threads are cleared once per mount, not on every keystroke.
  useEffect(() => { pruneOldThreads(); }, []);

  /*
   * The thread as it stands, readable from a callback.
   *
   * `send` finishes long after it was called - a stream runs for half a minute - and the `turns` it
   * closed over are from before the first token. This mirror is what it saves from.
   */
  const turnsRef = useRef(turns);
  useEffect(() => { turnsRef.current = turns; }, [turns]);

  // Follow the answer as it arrives rather than leaving the reader to scroll after it.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(asked) {
    const text = String(asked || "").trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion("");
    /*
     * The lead this answer belongs to, captured now - as two separate things.
     *
     * Half a minute is long enough to step to the next lead mid-answer, and the reply must be filed
     * against the lead it was asked about rather than whichever one is on screen when it lands.
     *
     * These were one variable until the thread key grew a creation stamp on the end to stop a
     * reissued enquiry id inheriting a previous client's conversation. The key stopped being an
     * enquiry id at that moment, and it was still what got sent as one - so every question in the
     * lead panel asked the server about `dbs_ai_lead_thread_DBS-DD-EID-4863__20260827...`, which is
     * no lead at all, and came back "That lead no longer exists."
     *
     * The storage key and the record id are different things and are now named as such.
     */
    const askedAbout = String(leadId || "").trim();
    const storeUnder = threadKey;

    const history = turns.filter((turn) => !turn.error).map((turn) => ({ role: turn.role, content: turn.content }));
    // The question and an empty answer go in together, so the reply has somewhere to appear.
    setTurns((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "" }]);

    try {
      const response = await fetch(`${API_URL}${config.endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
        },
        // The module scope has no lead to point at; the server reads the CRM's own totals.
        body: JSON.stringify(mode === "crm"
          ? { question: text, history, vertical: getActiveVertical() }
          : { enquiryId: askedAbout, question: text, history }),
      });
      if (!response.ok || !response.body) throw new Error(`The AI service responded ${response.status}.`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      /*
       * Server-sent events: blank-line separated, an `event:` and a `data:` line each.
       *
       * A network chunk almost always ends mid-event, so the tail is kept in the buffer until the
       * blank line that completes it arrives. Splitting on every chunk boundary instead would drop
       * a token here and there, which reads as the model misspelling words.
       */
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const name = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
          const payload = /^data:\s*(.+)$/m.exec(block)?.[1];
          if (!payload) continue;
          let parsed;
          try { parsed = JSON.parse(payload); } catch { continue; }

          if (name === "token") {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + parsed.t };
              return next;
            });
          } else if (name === "replace") {
            /*
             * The server rewrote the answer - it quoted the system prompt back - so what has been
             * streamed is a draft the reader should not keep.
             *
             * Replaced outright rather than appended to: the reader should end up with one answer,
             * not the rejected draft with the real one after it.
             */
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: parsed.text };
              return next;
            });
          } else if (name === "meeting") {
            /*
             * Nebula worked out that the message was asking to book something.
             *
             * Held against the turn rather than acted on. Confirming it sends a calendar invite to
             * a real client, which is not something to do because a model parsed a sentence
             * confidently - the details are shown, and a person presses the button.
             */
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, meeting: parsed };
              return next;
            });
          } else if (name === "error") {
            setTurns((current) => {
              const next = [...current];
              next[next.length - 1] = { role: "assistant", content: "", error: parsed.message };
              return next;
            });
            onError?.(parsed.message);
          }
        }
      }
    } catch (error) {
      setTurns((current) => {
        const next = [...current];
        next[next.length - 1] = { role: "assistant", content: "", error: error.message || "The AI could not answer." };
        return next;
      });
      onError?.(error.message || "The AI could not answer.");
    } finally {
      setBusy(false);
      /*
       * Written here rather than from an effect on `turns`.
       *
       * As an effect it ran in the same commit as the one that loads a lead's thread - and because
       * the loaded value had not landed in state yet, it wrote the empty array over the saved
       * conversation. Every thread was wiped the moment its lead was opened. Saving at the point
       * the conversation actually changes has no such ordering to get wrong.
       */
      saveTurns(storeUnder, turnsRef.current);
    }
  }

  if (status && !status.ok) {
    return (
      <div className="flex min-h-[20rem] flex-col items-center justify-center gap-2 p-5 text-center">
        <p className="text-sm font-medium text-slate-700">Nebula AI is unavailable.</p>
        {/* The reason carries the fix - "ollama pull qwen3:1.7b" - which is worth showing. */}
        <p className="max-w-md text-xs text-slate-500">{status.reason}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {turns.length === 0 && (
          <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 text-center">
            <div>
              <p className="text-base font-semibold text-slate-800">Nebula AI</p>
              <p className="mt-1 text-sm text-slate-500">{config.subtitle}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {OPENERS[mode].map((opener) => (
                <button
                  key={opener}
                  type="button"
                  onClick={() => send(opener)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                >
                  {opener}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div key={index} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${turn.role === "user" ? "bg-blue-50 text-blue-900" : "bg-slate-50 text-slate-700"}`}>
              {turn.error
                ? <span className="text-red-700">{turn.error}</span>
                : turn.content
                  ? <span className="whitespace-pre-line">{turn.content}</span>
                  /* Nothing has arrived yet. A cursor says the model is working; a spinner would
                     say the page is. */
                  : <span className="inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-400 align-middle" />}
              {turn.meeting && mode === "lead" && (
                <MeetingProposal leadId={leadId} meeting={turn.meeting} onError={onError} />
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); send(question); }}>
        <NebulaComposer
          value={question}
          onChange={setQuestion}
          onSubmit={() => send(question)}
          busy={busy}
          module="SALES"
          placeholder={config.placeholder}
        />
      </form>
    </div>
  );
}
