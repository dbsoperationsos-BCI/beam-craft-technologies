"use client";

import { useEffect, useRef } from "react";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFormErrors from "@/components/shared/useFormErrors";

/**
 * The card a correction is written in, in both proofing rooms.
 *
 * It opens **against the spot it is about** — the canvas anchors it to the pin just dropped, or to
 * the correction being edited, on whichever side of it has room. That is the whole idea, and it is
 * the one every reviewer already knows from Figma: mark the place, and the box to say what is
 * wrong appears there, beside the mark, over the picture. The eye never leaves the thing being
 * described.
 *
 * It replaced a dialog titled "Spread N — Add Correction" with a labelled textarea, Cancel and Add
 * Correction. That asked for a form to be filled in, and it covered the very photograph the remark
 * was about — the reviewer described what they could no longer see.
 *
 * The same component serves the QC Lead and the client. Two composers would be two sets of rules
 * about an empty correction, the Enter key and the Escape key, and they would drift — the rooms are
 * separate on purpose, but what a person types into them is the same act.
 */
export default function ProofCommentComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy = false,
  editing = false,
  maxLength = 2000,
}) {
  const inputRef = useRef(null);
  const fields = useFormErrors();

  // The field grows with what is typed, from one line to a few, and scrolls after that: a comment
  // is usually a sentence, and a box sized for a paragraph asks for one.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 88)}px`;
  }, [value]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape leaves the comment, through the one arbiter every dismissible thing goes through — the
  // dialog this replaced got that for free, and losing it would have made Escape close the room.
  useEscapeKey(() => { if (!busy) onCancel(); });

  // An empty send is answered under the box rather than by a button that will not press.
  function submit() {
    if (busy) return;
    if (fields.check({ comment: value.trim() ? "" : "Write the correction." })) onSubmit();
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      className="w-[min(17rem,70vw)] cursor-default rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-black/10"
    >
      <div className="flex items-end gap-1.5">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          maxLength={maxLength}
          disabled={busy}
          aria-label={editing ? "Edit your correction" : "Add a correction"}
          placeholder={editing ? "Edit your correction" : "Add a correction"}
          aria-invalid={fields.errors.comment ? true : undefined}
          aria-describedby={fields.errors.comment ? "proof-comment-error" : undefined}
          onChange={(event) => { fields.clear("comment"); onChange(event.target.value); }}
          // Enter sends, the way it does in every comment box; a deliberate newline is Shift+Enter.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          className="max-h-24 min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none placeholder:text-slate-400 disabled:text-slate-400"
        />
        <button
          type="button"
          aria-label="Discard this correction"
          onClick={onCancel}
          disabled={busy}
          className="mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
        >
          <CloseRounded style={{ fontSize: 16 }} />
        </button>
        <button
          type="submit"
          aria-label={editing ? "Save correction" : "Add correction"}
          disabled={busy}
          className="mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <ArrowUpwardRounded style={{ fontSize: 16 }} />
        </button>
      </div>
      {fields.errors.comment && <p id="proof-comment-error" role="alert" className="px-2 pb-1 text-xs font-normal text-red-600">{fields.errors.comment}</p>}
    </form>
  );
}
