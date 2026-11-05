"use client";

import { useEffect, useRef, useState } from "react";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import MicNoneRoundedIcon from "@mui/icons-material/MicNoneRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import { transcribeVoice } from "@/services/ai/ai.service";

/**
 * The box you type or speak a question into.
 *
 * One component for both places Nebula appears - the floating panel and the lead popup - because
 * the behaviour here is fiddly enough that two copies would drift: Enter sends, Shift+Enter starts a
 * new line, the box grows with the text and stops growing before it eats the conversation.
 *
 * It was a single-line `input` before, which meant a question longer than the box scrolled sideways
 * and there was no way to write a second line at all.
 */

// Roughly six lines. Past that the thread would be squeezed out of its own panel.
const MAX_HEIGHT = 140;

/*
 * One circle, in the CRM's own geometry.
 *
 * `h-8 w-8 rounded-full bg-blue-600` is the remark composer's send button in CRMPage - the same
 * control, doing the same job, two panels apart - so it is copied rather than reinvented. The
 * shared `Button` was used here before and carried `min-h-10` from its default size, which is what
 * made this box taller than anything else in the application.
 */
const SEND_BUTTON = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

/*
 * Said once, in six words, in every place Nebula appears.
 *
 * It was three different sentences before - one per panel - each explaining permissions and
 * grounding as well as fallibility. A caveat nobody finishes reading is not a caveat, and the part
 * that matters is the last clause of all three.
 */
const DISCLAIMER = "Nebula AI can make mistakes.";

export default function NebulaComposer({ value, onChange, onSubmit, onStop, busy, placeholder, module }) {
  const textareaRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recorderRef = useRef(null);

  /*
   * Grown to fit what is typed, and no further.
   *
   * Reset to `auto` first, or the box only ever gets taller - `scrollHeight` of an element that is
   * already tall enough is its current height, so deleting a line would never shrink it again.
   */
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function onKeyDown(event) {
    if (event.key !== "Enter") return;
    /*
     * Shift+Enter is a new line, Enter sends.
     *
     * Also left alone while the browser is composing - typing Tamil or any other script through an
     * IME uses Enter to accept a candidate, and sending the message there would submit half a word.
     */
    if (event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    if (!busy) onSubmit();
  }

  /*
   * Dictation, through the studio's own transcription.
   *
   * Not the browser's Web Speech API: that streams audio to Google, and everything else here has
   * been built so nothing about a client leaves this machine. The recording goes to the backend,
   * through the same faster-whisper that handles call recordings, and comes back as text in the box
   * - which the person reads and edits before sending, because a name over a bad microphone is
   * exactly what this mishears.
   */
  async function startRecording() {
    setVoiceError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        // The microphone light goes out as soon as recording ends, not when the transcript returns.
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        if (!chunks.length) return;

        setTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const response = await transcribeVoice({ blob, module });
          const text = response?.data?.text || "";
          // Appended rather than replacing, so dictating after typing adds to what is there.
          if (text) onChange(value ? `${value} ${text}` : text);
          else setVoiceError("Nothing was heard.");
        } catch (error) {
          setVoiceError(error.message || "That could not be transcribed.");
        } finally {
          setTranscribing(false);
          textareaRef.current?.focus();
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      // Refused permission, or no microphone. Said once, quietly, rather than thrown.
      setVoiceError("The microphone is not available.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  // A recording must not outlive the panel it was started in.
  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch { /* Already stopped. */ }
  }, []);

  const canRecord = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";

  const hasQuestion = Boolean(String(value || "").trim());

  return (
    <div className="shrink-0 border-t border-slate-200 px-4 pb-3 pt-2.5">
      {/*
        * `items-end` so the controls stay on the last line as the box grows, and the textarea
        * carries its own `py-1.5` so that on a single line its 20px of text sits level with the
        * 32px circles beside it rather than resting on their baseline.
        */}
      {/* `nebula-composer` is the same kind of marker as `nebula-bubble`: white maps to the panel's
          own surface on a dark ground, so the box you type into was the same colour as the drawer
          around it and read as no box at all. */}
      <div className="nebula-composer flex items-end gap-1 rounded-2xl border border-slate-300 bg-white py-1 pl-3 pr-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-slate-700 outline-none placeholder:text-slate-400"
        />

        {canRecord && (
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing || busy}
            aria-label={recording ? "Stop recording" : "Dictate a question"}
            /* No hover fill and no tooltip, like every other icon control in the application. */
            className={`${SEND_BUTTON} disabled:opacity-40 ${
              recording ? "text-red-600" : "text-slate-400 hover:text-slate-700"
            }`}
          >
            {recording
              // A square while recording: the control stops, it does not start another.
              ? <StopRoundedIcon sx={{ fontSize: 18 }} />
              : <MicNoneRoundedIcon sx={{ fontSize: 18 }} />}
          </button>
        )}

        {busy && onStop ? (
          <button type="button" onClick={onStop} aria-label="Stop answering" className={`${SEND_BUTTON} bg-slate-200 text-slate-700 hover:bg-slate-300`}>
            <StopRoundedIcon sx={{ fontSize: 18 }} />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || transcribing || !hasQuestion}
            className={`${SEND_BUTTON} bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400`}
          >
            <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />
          </button>
        )}
      </div>

      {/*
        * One line of small print, never two.
        *
        * While the microphone is open this is what the microphone is doing, because that is the
        * more urgent thing to say and stacking it above the disclaimer would shift the box.
        */}
      <p className={`mt-1.5 text-[11px] ${voiceError ? "text-red-600" : "text-slate-400"}`}>
        {voiceError
          || (recording && "Recording - press the square to finish.")
          || (transcribing && "Turning that into text...")
          || DISCLAIMER}
      </p>
    </div>
  );
}
