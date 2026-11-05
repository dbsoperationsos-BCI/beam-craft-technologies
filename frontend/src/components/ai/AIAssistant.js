"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import { readThread, writeThread, historyFor } from "@/lib/ai/sessionChats";
import { streamAi, confirmAiAction, fetchAiHealth } from "@/services/ai/ai.service";
import { getActiveVertical, onVerticalChange } from "@/lib/ai/activeVertical";
import NebulaComposer from "./NebulaComposer";

/**
 * Nebula, in whichever module it was opened.
 *
 * One component for every module rather than an assistant per screen: the module is a prop, the
 * backend decides whether the person may work in it, and the tools, the conversation and the
 * knowledge follow from that decision. A second implementation would be a second place for the
 * boundary to be got wrong.
 *
 * The panel is deliberately plain - the module's own Button, the same spacing and type as the rest
 * of the app - because it appears inside other screens and should read as part of them.
 */

const OPENERS = {
  SALES: ["How is my pipeline doing?", "Who is behind on follow-ups?", "Where are my leads coming from?"],
  IMAGE_SELECTION: ["Which selections are still open?", "Show me recent projects"],
  GLOBAL: ["What needs my attention today?", "Give me a status across the business"],
};

export default function AIAssistant({ module = "SALES", title = "Nebula AI", onError }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState("");
  /*
   * Seeded from the page's own memory, so closing the panel and reopening it continues the
   * conversation rather than starting a new one. A refresh clears it - see `lib/ai/sessionChats`.
   */
  const [turns, setTurns] = useState(() => readThread(module));
  const [busy, setBusy] = useState(false);
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

  /*
   * Which module the turns currently in state belong to.
   *
   * Needed because a module change arrives one render before the turns catch up: on that render
   * `module` is already the new one while `turns` is still the old one's conversation.
   */
  const belongsTo = useRef(module);

  /*
   * Kept for as long as the page is open, and no longer.
   *
   * Declared before the swap below on purpose - effects run in declaration order, so on the render
   * where the module has just changed this one sees the mismatch and skips, rather than filing the
   * previous module's conversation under the new module's key.
   */
  useEffect(() => {
    if (belongsTo.current !== module) return;
    writeThread(module, turns);
  }, [turns, module]);

  // A different module is a different session, so its own thread is loaded rather than carried over.
  useEffect(() => {
    if (belongsTo.current === module) return;
    belongsTo.current = module;
    setTurns(readThread(module));
  }, [module]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send(asked) {
    const text = String(asked || "").trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion("");
    lastAskedRef.current = text;

    /*
     * The question and an empty answer go in together, so the reply has somewhere to appear as it
     * arrives rather than the thread jumping when it lands.
     */
    setTurns((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "" }]);

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
        { module, message: text, history: historyFor(module), vertical, signal: controller.signal },
        {
          token: (data) => appendToLast((last) => ({ content: last.content + (data.t || "") })),
          /*
           * A tool-backed answer arrives whole rather than in pieces - the tool loop has to finish
           * before there is anything to say - so it replaces whatever is there instead of appending.
           */
          answer: (data) => appendToLast(() => ({ content: data.answer || "" })),
          done: (data) => appendToLast(() => ({ proposals: data.proposals || [] })),
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
      abortRef.current = null;
      setBusy(false);
    }
  }

  /** Stops a generation. What has arrived stays on screen. */
  function stop() {
    abortRef.current?.abort();
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
          <div key={index} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
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

              {turn.proposals?.map((proposal) => (
                <ProposedAction key={proposal.token} module={module} proposal={proposal} onError={onError} />
              ))}
            </div>
          </div>
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
    </div>
  );
}

/**
 * A change the assistant proposes, waiting for a person.
 *
 * Nothing has happened when this appears. The token is what carries it out, it is single-use, and
 * it expires - so a tab left open overnight cannot act in the morning.
 */
function ProposedAction({ module, proposal, onError }) {
  const [state, setState] = useState("idle");

  if (state === "done") {
    return <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900">Done.</p>;
  }

  async function run() {
    setState("running");
    try {
      await confirmAiAction({ module, token: proposal.token });
      setState("done");
    } catch (error) {
      setState("idle");
      onError?.(error.message || "That action could not be carried out.");
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-800">This will change a record.</p>
      <p className="mt-0.5 break-words text-[11px] text-slate-500">{proposal.summary}</p>
      <Button variant="primary" className="mt-2 rounded-md" disabled={state === "running"} onClick={run}>
        {state === "running" ? "Working..." : "Confirm"}
      </Button>
    </div>
  );
}
