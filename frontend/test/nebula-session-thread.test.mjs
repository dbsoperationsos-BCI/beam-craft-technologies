import assert from "node:assert/strict";
import test from "node:test";

/*
 * Nebula's conversation across the app: one thread for every section, forgotten after 30 minutes
 * without a question.
 *
 * It was kept per section, so a conversation in Projects was gone from the panel the moment you
 * walked to HRM - still in memory, filed under the screen you had left.
 */

import { readThread, writeThread, historyFor, markActive, expiresAt, clearThread, IDLE_LIMIT_MS } from "../src/lib/ai/sessionChats.js";

const asked = (content, module) => ({ role: "user", content, module });
const answered = (content) => ({ role: "assistant", content });

test("one thread whichever section reads it - a question in Projects is there in HRM", () => {
  clearThread();
  writeThread([asked("Which projects are in progress?", "PROJECT"), answered("Two.")]);
  markActive(1_000);
  assert.equal(readThread(1_000 + 60_000).length, 2);
  assert.deepEqual(historyFor(1_000 + 60_000), [
    { role: "user", content: "Which projects are in progress?" },
    { role: "assistant", content: "Two." },
  ], "the server gets roles and words, not the section tag");
});

test("forgotten 30 minutes after the last question or answer, not before", () => {
  clearThread();
  writeThread([asked("hello", "HRM"), answered("Hello.")]);
  markActive(10_000);
  assert.equal(expiresAt(), 10_000 + IDLE_LIMIT_MS);
  assert.equal(readThread(10_000 + IDLE_LIMIT_MS - 1).length, 2, "a minute short of the limit it is still there");
  assert.equal(readThread(10_000 + IDLE_LIMIT_MS).length, 0);
  assert.equal(expiresAt(), 0, "nothing left to forget");
  assert.deepEqual(historyFor(), [], "and nothing is sent with the next question");
});

test("opening the panel does not keep a thread alive - only asking does", () => {
  clearThread();
  writeThread([asked("hello", "HRM"), answered("Hello.")]);
  markActive(1_000);
  // The panel writes back what it was handed when it opens; that is looking, not talking.
  writeThread(readThread(1_000 + IDLE_LIMIT_MS - 5));
  assert.equal(expiresAt(), 1_000 + IDLE_LIMIT_MS);
  markActive(1_000 + IDLE_LIMIT_MS - 5);
  assert.equal(readThread(1_000 + IDLE_LIMIT_MS + 60_000).length, 2, "a new question restarts the 30 minutes");
});

test("a failed or still-empty answer is not sent back to the server", () => {
  clearThread();
  writeThread([asked("hi", "SALES"), { role: "assistant", content: "", error: "Timed out" }, asked("again", "SALES"), answered("")]);
  markActive(1_000);
  assert.deepEqual(historyFor(0), [{ role: "user", content: "hi" }, { role: "user", content: "again" }]);
});
