"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { readThread, writeThread, historyFor, markActive, expiresAt, clearThread } from "@/lib/ai/sessionChats";
import { moduleLabel } from "@/lib/ai/moduleContext";
import { streamAi, fetchAiHealth } from "@/services/ai/ai.service";
import { getActiveVertical, onVerticalChange } from "@/lib/ai/activeVertical";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import NebulaComposer from "./NebulaComposer";

/**
 * Nebula, in whichever module it was opened.
 *
 * One component for every module rather than an assistant per screen: the module is a prop, the
 * backend decides whether the person may work in it, and the tools, the conversation and the
 * knowledge follow from that decision. A second implementation would be a second place for the
 * boundary to be got wrong.
 *
 * The panel is deliberately plain - the same spacing and type as the rest of the app - because it
 * appears inside other screens and should read as part of them. It only answers: Nebula is
 * read-only, so there is nothing here to confirm or apply.
 */

const OPENERS = {
  SALES: ["How is my pipeline doing?", "Who is behind on follow-ups?", "Where are my leads coming from?"],
  IMAGE_SELECTION: ["Which selections are still open?", "Show me recent projects"],
  GLOBAL: ["What needs my attention today?", "Give me a status across the business"],
};

/** Whether this question was asked in a different section from the question before it. */
function movedSection(turns, index) {
  const here = turns[index].module;
  for (let at = index - 1; at >= 0; at -= 1) {
    if (turns[at].role === "user") return Boolean(here && turns[at].module && turns[at].module !== here);
  }
  return false;
}

export default function AIAssistant({ module = "SALES", title = "Nebula AI", onError }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState("");
  /*
   * Seeded from the page's own memory, so closing the panel, reopening it or moving to another
   * section continues the conversation rather than starting a new one. A refresh, or 30 minutes
   * without a question, clears it - see `lib/ai/sessionChats`.
   */
  const [turns, setTurns] = useState(() => readThread());
  const [busy, setBusy] = useState(false);
  const { notice, showUndo, clearNotice } = useNotice();
  // The thread was cleared for 30 minutes of quiet while the panel was open.
  const [clearedForQuiet, setClearedForQuiet] = useState(false);
  const [vertical, setVertical] = useState("");
  const threadRef = useRef(null);
  // Lets the reader stop a generation that is going nowhere.
  const abortRef = useRef(null);
  // The last question, so it can be sent again without retyping it.
  const lastAskedRef = useRef("");

  /*
   * Which CRM board is on screen, and following it if it changes while the panel is open.
   *
   * Switching from Qua Qua to Dum Dum mid-conversation should change what the next answer is about;
   * leaving the panel scoped to the board somebody has navigated away from is how it ends up
   * reporting the wrong vertical's figures with complete confidence.
   */
  useEffect(() => {
    setVertical(getActiveVertical());
    return onVerticalChange(setVertical);
  }, []);

  /*
   * Whether the assistant can answer at all, asked before anything is attempted.
   *
   * A self-hosted model is a process someone can stop. Saying so up front, with the reason, is more
   * use than letting the first question fail.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchAiHealth();
        if (!cancelled) setStatus(response?.data || null);
      } catch {
        if (!cancelled) setStatus({ ok: false, reason: "The assistant could not be reached." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Kept for as long as the page is open, across every section - one conversation, not one per screen.
  useEffect(() => {
    writeThread(turns);
  }, [turns]);

  /*
   * Forgotten after 30 minutes without a question, while the panel is open as well as while it is
   * closed - so what is on screen is never a conversation the next question will not be sent with.
   * Not while an answer is still arriving: that is activity, and the count restarts when it ends.
   */
  useEffect(() => {
    const expiry = expiresAt();
    if (!expiry || busy) return undefined;
    const timer = setTimeout(() => {
      clearThread();
      setTurns([]);
      // Said, not silently emptied - somebody may have been reading the answer when it went.
      setClearedForQuiet(true);
    }, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [turns.length, busy]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(asked) {
    const text = String(asked || "").trim();
    if (!text || busy) return;
    setBusy(true);
    setClearedForQuiet(false);
    // A new question is the new chat being used: an Undo still showing would throw it away.
    clearNotice();
    setQuestion("");
    lastAskedRef.current = text;

    /*
     * The question and an empty answer go in together, so the reply has somewhere to appear as it
     * arrives rather than the thread jumping when it lands.
     */
    // A thread that went quiet while the computer slept - its timer late - is not carried into this one.
    // Reading the store forgets an expired thread, so a thread on screen and none stored is stale.
    const stale = turns.length > 0 && readThread().length === 0;
    markActive();
    // Each question remembers the section it was asked in, so the thread can show where it moved.
    setTurns((current) => [...(stale ? [] : current), { role: "user", content: text, module }, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    const appendToLast = (patch) => setTurns((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = { ...last, ...patch(last) };
      return next;
    });

    try {
      await streamAi(
        /*
         * The thread travels with the question instead of a conversation id.
         *
         * That is what makes this ephemeral: the server writes nothing down, so there is no record
         * to find after a refresh rather than a record the panel merely declines to show.
         */
        { module, message: text, history: historyFor(), vertical, signal: controller.signal },
        {
          token: (data) => appendToLast((last) => ({ content: last.content + (data.t || "") })),
          /*
           * A tool-backed answer arrives whole rather than in pieces - the tool loop has to finish
           * before there is anything to say - so it replaces whatever is there instead of appending.
           */
          answer: (data) => appendToLast(() => ({ content: data.answer || "" })),
          error: (data) => {
            appendToLast((last) => (last.content ? {} : { error: data.message }));
            onError?.(data.message);
          },
        },
      );
    } catch (error) {
      // A stop is not a failure, and whatever had streamed is kept rather than discarded.
      if (error.name !== "AbortError") {
        const message = error.message || "The assistant could not answer.";
        appendToLast((last) => (last.content ? {} : { error: message }));
        onError?.(message);
      }
    } finally {
      // The answer arriving is activity too: the 30 minutes count from the end of it.
      markActive();
      abortRef.current = null;
      setBusy(false);
    }
  }

  /** Stops a generation. What has arrived stays on screen. */
  function stop() {
    abortRef.current?.abort();
  }

  /**
   * Starts again with an empty thread, at once, with Undo on the notice - the previous conversation
   * is one press away, so a mis-press costs nothing and no "are you sure" is needed. An answer still
   * arriving is stopped first, so it cannot land in the new chat.
   */
  function newChat() {
    abortRef.current?.abort();
    const previous = turns;
    clearThread();
    setTurns([]);
    setClearedForQuiet(false);
    showUndo("Started a new chat.", () => {
      setTurns(previous);
      // Brought back is in use again: the 30 minutes start from the undo.
      markActive();
    });
  }

  /** Sends the last question again, dropping the answer that did not work. */
  function retry() {
    const previous = lastAskedRef.current;
    if (!previous || busy) return;
    setTurns((current) => {
      const next = [...current];
      // Take off the failed answer and the question, so the pair is not duplicated.
      if (next[next.length - 1]?.role === "assistant") next.pop();
      if (next[next.length - 1]?.role === "user") next.pop();
      return next;
    });
    send(previous);
  }

  if (status && !status.ok) {
    return (
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 p-5 text-center">
        <p className="text-sm font-medium text-slate-700">{title} is unavailable.</p>
        {/* The reason carries the fix - "run: ollama pull ..." - which is worth showing. */}
        <p className="max-w-md text-xs text-slate-500">{status.reason}</p>
      </div>
    );
  }

  const openers = OPENERS[module] || [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the thread rather than in it, so it stays where it is however long the thread grows -
          and only once there is a conversation to leave. */}
      {turns.length > 0 && (
        <div className="flex shrink-0 justify-end border-b border-slate-100 px-3 py-1.5">
          <Button variant="ghost" size="sm" onClick={newChat} className="gap-1.5">
            <AddCommentOutlinedIcon fontSize="small" aria-hidden="true" />
            New chat
          </Button>
        </div>
      )}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {turns.length === 0 && (
          /*
           * Centred in the whole panel, not in the first twelve rems of it.
           *
           * `min-h-[12rem]` was written for a short popover, where twelve rems was most of the
           * height. In a full-height drawer it left the opening state hanging near the top with an
           * empty screen below it. `min-h-full` takes the height the thread actually has, so
           * `justify-center` centres against the panel rather than against a fixed block.
           */
          <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center">
            <div>
              <p className="text-base font-semibold text-slate-800">{title}</p>
              <p className="mt-1 text-sm text-slate-500">
                {module === "GLOBAL" ? "Ask across the whole business." : "Ask about this module."}
              </p>
              {clearedForQuiet && (
                <p className="mt-2 text-xs text-slate-500">
                  The earlier conversation was cleared after 30 minutes without a question.
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {openers.map((opener) => (
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
          <Fragment key={index}>
            {/* Where the conversation moved to another section: what an answer may read is that
                section's, so the thread says which one each question was asked in. */}
            {turn.role === "user" && movedSection(turns, index) && (
              <p className="text-center text-xs text-slate-500">Now in {moduleLabel(turn.module)}</p>
            )}
            <div className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
              {/* `nebula-bubble` on the received side is a marker for globals.css and nothing else: on a
                  dark ground the pale slate a reply sits on maps to the sunken tone, which is within a
                  shade of the panel behind it - so the answer read as unbubbled text floating on the
                  drawer. It is lifted rather than sunk there, which is what a reply from somebody else
                  should look like in a thread. */}
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${turn.role === "user" ? "bg-blue-50 text-blue-900" : "nebula-bubble bg-slate-50 text-slate-700"}`}>
                {turn.error ? (
                  <span className="text-red-700">
                    {turn.error}
                    <button type="button" onClick={retry} className="ml-2 underline hover:no-underline">
                      Try again
                    </button>
                  </span>
                ) : (
                  <span className="whitespace-pre-line">
                    {turn.content}
                    {/* A cursor while the answer is still arriving, so a pause reads as thinking
                        rather than as a panel that has stopped. */}
                    {busy && index === turns.length - 1 && (
                      <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-400 align-middle" />
                    )}
                  </span>
                )}

              </div>
            </div>
          </Fragment>
        ))}

      </div>

      <form onSubmit={(event) => { event.preventDefault(); send(question); }}>
        <NebulaComposer
          value={question}
          onChange={setQuestion}
          onSubmit={() => send(question)}
          onStop={stop}
          busy={busy}
          module={module}
          placeholder={`Ask ${title}`}
        />
      </form>

      <FloatingNotice notice={notice} onClose={clearNotice} />
    </div>
  );
}
