"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import CloseFullscreenRoundedIcon from "@mui/icons-material/CloseFullscreenRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import FormatListNumberedRoundedIcon from "@mui/icons-material/FormatListNumberedRounded";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import { MAX_REMARK_ATTACHMENTS, normalizeRemarkAttachments, normalizeRemarkEntries } from "@/lib/crmRemarks.mjs";
import { formatDateTime } from "@/lib/formatDateTime.mjs";

/**
 * The way this application writes down what somebody said.
 *
 * It lived unexported in the middle of `CRMPage.js`, which is why the Interview register grew a second
 * answer to the same question - a textarea with a button under it, beside the CRM's collapsible blue
 * bubbles, bullet lists, paperclip and Enter-to-post. A recruiter noting a call and a salesperson noting
 * a call are doing the same thing, so they get the same control.
 *
 * **Nothing about it changed for the lead.** The props, the entries, the attachments and the behaviour
 * are as they were; what is new is that two of its controls can be switched off by a caller whose log
 * cannot support them - see `canEdit` and `canAttach`.
 *
 * The composer is the **caller's** to persist. It reports a draft through `onPendingChange` and offers
 * its post through `commitRef`, and the caller decides whether that means rewriting an array of entries
 * (the lead) or posting to an endpoint that appends (the candidate).
 */

function escapeListLine(line) {
  return line.replace(/^\s*(?:•\s*|\d+\.\s*)/, "");
}

function getLineBounds(text, cursor) {
  const source = String(text || "");
  const safeCursor = Math.max(0, Math.min(cursor ?? 0, source.length));
  let start = source.lastIndexOf("\n", safeCursor - 1);
  start = start === -1 ? 0 : start + 1;
  let end = source.indexOf("\n", safeCursor);
  end = end === -1 ? source.length : end;
  return { start, end, line: source.slice(start, end) };
}

function updateListText(value, selectionStart, selectionEnd, mode) {
  const text = String(value || "");
  const lines = text.split("\n");
  let cursor = 0;
  let startLine = 0;
  let endLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const nextCursor = cursor + lines[index].length;
    if (selectionStart >= cursor && selectionStart <= nextCursor + 1) startLine = index;
    if (selectionEnd >= cursor && selectionEnd <= nextCursor + 1) {
      endLine = index;
      break;
    }
    cursor = nextCursor + 1;
  }

  const nextLines = [...lines];
  for (let index = startLine; index <= endLine; index += 1) {
    const current = nextLines[index] || "";
    const clean = escapeListLine(current);
    if (mode === "bullet") {
      nextLines[index] = current.trimStart().startsWith("• ") ? clean : `• ${clean}`;
    } else {
      const numbering = `${index - startLine + 1}. `;
      nextLines[index] = current.trimStart().match(/^\d+\.\s+/) ? clean.replace(/^\d+\.\s*/, numbering) : `${numbering}${clean}`;
    }
  }

  return nextLines.join("\n");
}

function nextListLinePrefix(text, cursor) {
  const { line } = getLineBounds(text, cursor);
  const bullet = /^•\s*/.exec(line);
  if (bullet) return "• ";
  const numbered = /^(\d+)\.\s*/.exec(line);
  if (numbered) return `${Number(numbered[1]) + 1}. `;
  return "";
}

function toggleListPrefix(lineText, mode) {
  const cleanLine = escapeListLine(lineText);
  const trimmed = String(lineText || "").trimStart();
  if (mode === "bullet") {
    return trimmed.startsWith("• ") ? cleanLine : `• ${cleanLine}`;
  }

  if (/^\d+\.\s+/.test(trimmed)) {
    return cleanLine;
  }

  return `1. ${cleanLine}`;
}

function formatAttachmentSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/**
 * Opens one attachment.
 *
 * A file stored in the bucket has a key rather than a link, and the endpoint that serves it is
 * behind the same login as everything else - so the bytes are fetched with the token and handed
 * over as a blob. That is what keeps the bucket private: there is no public URL to a client's
 * attachment, only this request.
 *
 * Remarks written before the bucket still carry a `url` - a base64 data URI - and open directly.
 */
async function openAttachment(attachment, onFetchAttachment) {
  let target = attachment?.url || attachment?.href || attachment?.previewUrl;
  if (!target && attachment?.key) {
    try {
      target = await onFetchAttachment?.(attachment.key);
    } catch {
      return;
    }
  }
  if (!target) return;
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  // A window opened after an await can be refused by the browser's popup blocking. The anchor
  // is not, so a blocked tab becomes a download rather than a button that did nothing.
  if (!opened) {
    const link = document.createElement("a");
    link.href = target;
    link.download = attachment?.name || "attachment";
    link.rel = "noopener";
    link.click();
  }
}

/**
 * One file on a remark. The remove control cannot sit inside the chip - a button may not
 * contain another button - so the two are siblings in a positioned wrapper.
 */
/*
 * `onFetch` is handed down rather than imported, for the reason the composer's own two props give: a
 * stored file is fetched through whichever module owns the bucket it is in, and this chip must not name
 * one of them.
 */
function RemarkFileChip({ file, onRemove, onFetch }) {
  return (
    <span className="relative inline-flex max-w-full">
      <button
        type="button"
        onClick={() => void openAttachment(file, onFetch)}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[13px] text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
        title={file.url || file.key ? `Open ${file.name}` : file.name}
      >
        <AttachFileRoundedIcon sx={{ fontSize: 14 }} className="shrink-0 text-slate-400" />
        <span className="truncate">{file.name}</span>
        {formatAttachmentSize(file.size) && <span className="shrink-0 text-slate-400">{formatAttachmentSize(file.size)}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          title={`Remove ${file.name}`}
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[12px] leading-none text-slate-500 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
        >
          ×
        </button>
      )}
    </span>
  );
}

export default function NotesComposer({
  entries = [],
  onEntriesChange,
  attachments = [],
  onAttachmentsChange,
  // The lead an attachment belongs to, which decides the client folder it is filed under in the
  // bucket. Empty on Add Lead, where the lead does not exist yet - the server files those apart
  // rather than refusing them.
  enquiryId = "",
  className = "",
  label = "Remarks",
  placeholder = "I add your notes here...",
  showEmptyState = true,
  // Let a caller know whether anything is waiting to be posted, and post it on the caller's
  // behalf. The lead popup and the info panel use both: neither will update a lead without a
  // remark, and a note typed but never posted should count as one rather than being thrown
  // away on save.
  onPendingChange,
  commitRef,
  // The panel replaces the send button with its own Update and Next, so the same action is
  // not offered twice within a few centimetres of itself.
  showSendButton = true,
  /*
   * ── The two controls a caller may switch off ──
   *
   * Both default on, because the lead popup this was written for wants both, and a move that quietly
   * changed the CRM would be the worst outcome of sharing it.
   *
   * `canEdit` draws the pencil that rewrites a remark in place. A candidate's remarks are `statusNotes`:
   * append-only, no id per entry, and no endpoint that rewrites one - so for them the pencil would be a
   * control that cannot work.
   *
   * `canAttach` draws the paperclip and the row of files already on the record. A candidate's remark has
   * nowhere to put a file: the endpoint takes a body and nothing else.
   */
  canEdit = true,
  canAttach = true,
  /*
   * Something extra in an entry's own header, after the date - a node, or nothing. The candidate's log
   * carries the **stage** each remark was written at, which is the reason it is worth reading at all:
   * "they asked to be called back" means one thing at Follow Up and another at Selected. A lead's
   * remarks have no such thing and pass nothing.
   */
  entryMeta,
  /*
   * The one entry just written, for a caller whose log is append-only and lives on the server - see
   * `submitDraft`. A caller passes this **or** `onEntriesChange`, not both.
   */
  onPost,
  /*
   * What is in the box, on every change - see `reportPending`. For a caller that must post the draft
   * itself; the lead popup does not pass it.
   */
  onDraftTextChange,
  /*
   * ── The attachment calls belong to the caller ──
   *
   * A component in `shared/` is one a second module can use, and wired to the CRM's own attachment
   * endpoint this was not: a module wanting attachments would have had to fork it or repoint a
   * sales-only import, which is the near-copy this component was moved here to remove. No other file in
   * `components/shared/` imports from `@/services/`.
   *
   * A caller that passes neither simply has no working paperclip, which is why `canAttach` exists.
   */
  onUploadAttachment,
  onFetchAttachment,
  // The form's refusal of an empty box ("Add a remark…"), drawn under it like any field's error.
  error = "",
}) {
  const textRef = useRef(null);
  const fileRef = useRef(null);
  const [expandedComposer, setExpandedComposer] = useState(false);
  const [draftText, setDraftText] = useState("");
  const draft = draftText;
  // Files chosen for the note being written. They belong to the remark, and are only stored
  // once it is posted - so cancelling a half-written note takes its files with it.
  const [pendingFiles, setPendingFiles] = useState([]);
  // Mirrors pendingFiles so an attach handler wired up by an earlier render still appends to
  // the list as it stands now rather than as it stood then.
  const pendingFilesRef = useRef([]);
  // Counts up for the lifetime of the composer, so two copies of the same file are still two
  // attachments with two ids.
  const attachmentSeqRef = useRef(0);
  // Says why a file was refused. Cleared by the next successful attach.
  const [attachNotice, setAttachNotice] = useState("");

  function reportPending(text, files) {
    onPendingChange?.(Boolean(String(text ?? "").trim()) || (files || []).length > 0);
    /*
     * And what is actually in the box, for a caller that has to post it itself. `onPendingChange` says
     * *whether* there is a draft, which is all the lead popup needs - it owns the array and saves it. A
     * caller whose log is on the server needs the words, or it cannot post the note that satisfied its
     * own mandatory-remark gate.
     */
    onDraftTextChange?.(String(text ?? ""));
  }

  // Every path that changes the note - typing, the list buttons, posting, picking a remark
  // to rewrite - goes through here, so the caller cannot be told a stale draft.
  function setDraft(value) {
    setDraftText(value);
    reportPending(value, pendingFiles);
  }

  function setFiles(files) {
    pendingFilesRef.current = files;
    setPendingFiles(files);
    // Read from the box rather than the render's copy: files are read asynchronously, and
    // the user may have typed while that was happening.
    reportPending(textRef.current?.value ?? draftText, files);
  }
  const [editingIndex, setEditingIndex] = useState(null);
  const [openEntryIds, setOpenEntryIds] = useState(() => new Set());
  const normalizedEntries = useMemo(() => normalizeRemarkEntries(entries), [entries]);

  const attachmentInputId = useMemo(
    () => `attach-${String(label || "remarks").replace(/\s+/g, "-").toLowerCase()}`,
    [label],
  );

  // Remarks start collapsed and open only when their chevron is clicked. There used to be
  // an effect here that pruned ids and, finding none open, expanded the first entry - which
  // is why opening the panel always showed one remark already unfolded. Pruning is not
  // needed either: an id is only ever looked up against an entry that still exists, and
  // ids are unique per remark, so a stale one can never match a later entry.

  function insertFormatting(mode) {
    const input = textRef.current;
    if (!input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const fullValue = input.value || "";
    const lineStart = fullValue.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = fullValue.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? fullValue.length : lineEndIndex;
    const lineText = fullValue.slice(lineStart, lineEnd);
    const hasSelection = start !== end;

    if (!hasSelection) {
      const nextLine = toggleListPrefix(lineText, mode);
      const nextValue = `${fullValue.slice(0, lineStart)}${nextLine}${fullValue.slice(lineEnd)}`;
      setDraft(nextValue);
      window.requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(lineStart + nextLine.length, lineStart + nextLine.length);
      });
      return;
    }

    const nextValue = updateListText(input.value, start, end, mode);
    setDraft(nextValue);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start, start);
    });
  }

  // `overrideText` is needed when the caller has just rewritten the draft: setDraft has not
  // been applied yet at that point, so the state still holds the previous text.
  function submitDraft(overrideText) {
    const text = String(overrideText ?? draft ?? "").trim();
    const files = normalizeRemarkAttachments(pendingFiles);
    // A file on its own is a remark. Only an empty box with nothing clipped to it is not.
    if (!text && !files.length) return null;
    const nextEntries = [...normalizedEntries];
    const editingExisting = editingIndex !== null && editingIndex >= 0 && editingIndex < normalizedEntries.length;
    // Built from the posting time and the position in the list rather than a random suffix:
    // two remarks cannot be written in the same millisecond at the same length, and a random
    // id is a value that changes on its own, which React's rules do not allow here.
    const createdAt = normalizedEntries[editingIndex]?.createdAt || new Date().toISOString();
    const nextEntry = {
      id: normalizedEntries[editingIndex]?.id || `remark-${createdAt}-${normalizedEntries.length}`,
      text,
      createdAt,
      // Only a rewrite is stamped. The original posting time stays in `createdAt`, so the
      // remark still reads in the order it was written.
      editedAt: editingExisting ? new Date().toISOString() : "",
      attachments: files,
    };
    if (editingIndex !== null && editingIndex >= 0 && editingIndex < nextEntries.length) {
      nextEntries[editingIndex] = nextEntry;
    } else {
      nextEntries.push(nextEntry);
    }
    onEntriesChange?.(nextEntries);
    /*
     * For a caller that does not own the array. The lead's remarks are a column on the lead, so the whole
     * list goes back and the popup saves it; a candidate's are an **append-only** log on the server, so
     * what that caller needs is the one entry just written, to post. Both are offered and each caller
     * passes the one that matches its store.
     */
    onPost?.(nextEntry, { editing: editingExisting });
    setEditingIndex(null);
    setDraftText("");
    pendingFilesRef.current = [];
    setPendingFiles([]);
    setAttachNotice("");
    // Reported directly: setDraft and setFiles each read the other's pre-clear value, and
    // between them would report the box as still holding something.
    onPendingChange?.(false);
    window.requestAnimationFrame(() => textRef.current?.focus());
    // Handed back as well as reported through onEntriesChange. A caller that saves in the
    // same breath as committing cannot read the posted remark out of state yet - the update
    // has not been applied - so it needs the new list in its hand. Null when there was
    // nothing to post.
    return nextEntries;
  }

  // No dependency list: the handle is re-pointed on every render, because submitDraft closes
  // over the draft and the entries as they are now.
  useEffect(() => {
    if (!commitRef) return undefined;
    commitRef.current = submitDraft;
    return () => {
      commitRef.current = null;
    };
  });

  /*
   * The composer is unmounted when the panel moves to Activity Logs, and an unposted note
   * goes with it. The caller is told the box is empty on the way out, or the lead popup
   * would still believe a remark was waiting and let the lead be updated without one.
   */
  const draftReportRef = useRef(onPendingChange);
  useEffect(() => {
    draftReportRef.current = onPendingChange;
  });
  useEffect(() => () => draftReportRef.current?.(false), []);

  function handleKeyDown(event) {
    if (event.key !== "Enter") return;
    // Shift+Enter keeps its usual meaning - a line break within the note being written.
    if (event.shiftKey) return;
    const input = textRef.current;
    if (!input) return;
    const cursor = input.selectionStart ?? 0;
    const { line } = getLineBounds(input.value, cursor);
    const trimmed = line.trimStart();
    const bulletMatch = /^•\s*(.*)$/.exec(trimmed);
    const numberMatch = /^(\d+)\.\s*(.*)$/.exec(trimmed);

    // Enter on an empty bullet or number ends the list and posts the note. Dropping the
    // empty item and stopping there left no way out: the line above is still a list item,
    // so the next Enter simply started a new one and a note containing a list could never
    // be added at all.
    if ((bulletMatch && !bulletMatch[1]) || (numberMatch && !numberMatch[2])) {
      event.preventDefault();
      const fullValue = String(input.value || "");
      const lineStart = fullValue.lastIndexOf("\n", cursor - 1) + 1;
      const lineEndIndex = fullValue.indexOf("\n", cursor);
      const lineEnd = lineEndIndex === -1 ? fullValue.length : lineEndIndex;
      const nextValue = `${fullValue.slice(0, lineStart)}${fullValue.slice(lineEnd + 1)}`;
      setDraft(nextValue);
      // A lone empty bullet has nothing to post; it is just cleared.
      submitDraft(nextValue);
      return;
    }

    // Outside a list, Enter posts the note. submitDraft had no caller at all before this,
    // so a note could be typed but never actually added to the remarks.
    if (!bulletMatch && !numberMatch) {
      event.preventDefault();
      submitDraft();
      return;
    }

    const prefix = bulletMatch ? "• " : `${Number(numberMatch[1]) + 1}. `;
    event.preventDefault();
    const { selectionStart = 0, selectionEnd = 0, value: currentValue } = input;
    const nextValue = `${currentValue.slice(0, selectionStart)}\n${prefix}${currentValue.slice(selectionEnd)}`;
    setDraft(nextValue);
    window.requestAnimationFrame(() => {
      const position = selectionStart + 1 + prefix.length;
      input.focus();
      input.setSelectionRange(position, position);
    });
  }

  /**
   * Reads the chosen files onto the note being written.
   *
   * Three things this has to get right, none of which it used to:
   *
   *   * A cap. A remark carries at most MAX_REMARK_ATTACHMENTS files, and they are stored
   *     inline as data URLs on the lead, so an unbounded pile is a row that will not save.
   *     Whatever fits is taken and the rest are refused out loud.
   *   * Unique ids. The id was name-lastModified-size, so attaching the same photo twice gave
   *     two files sharing one id - React saw duplicate keys, and removing either removed both.
   *     A counter makes every attachment its own.
   *   * The current list. It appended to `pendingFiles` as captured by the render that wired
   *     this handler up, so picking files twice in quick succession dropped the first batch.
   *     The ref is always up to date.
   *
   * A file the browser could not read is left out rather than attached as an empty one.
   */
  function handleAttach(event) {
    const files = Array.from(event.target.files || []);
    // Cleared straight away, or picking the same file again fires no change event at all.
    event.target.value = "";
    if (!files.length) return;

    const current = pendingFilesRef.current;
    const room = Math.max(0, MAX_REMARK_ATTACHMENTS - current.length);
    if (room === 0) {
      setAttachNotice(`A remark can carry ${MAX_REMARK_ATTACHMENTS} attachments. Remove one to add another.`);
      return;
    }
    const accepted = files.slice(0, room);
    const refused = files.length - accepted.length;

    /*
     * Uploaded rather than read into the note.
     *
     * Each file used to be turned into a base64 data URI and kept on the lead, so a photo on a
     * remark was carried by every query that read that lead - and cost a third more than the
     * bytes it encoded. Now it goes to the bucket under the client it belongs to, and what the
     * remark keeps is the key.
     */
    Promise.all(accepted.map(async (file, index) => {
      const id = `${file.name}-${file.lastModified}-${file.size}-${attachmentSeqRef.current += 1}-${index}`;
      try {
        const response = await onUploadAttachment?.(file, enquiryId);
        const stored = response?.data;
        return stored?.key ? { id, ...stored, fileType: stored.type } : null;
      } catch {
        // Answered as unreadable below, which is what the user already sees for a file that
        // could not be taken - the reason differs, the outcome does not.
        return null;
      }
    })).then((read) => {
      const usable = read.filter((file) => file && file.key);
      const unreadable = read.length - usable.length;
      setFiles([...pendingFilesRef.current, ...usable]);
      setAttachNotice(refused || unreadable
        ? [
            refused ? `only ${MAX_REMARK_ATTACHMENTS} attachments are allowed on a remark, so ${refused} ${refused === 1 ? "file was" : "files were"} left out` : "",
            unreadable ? `${unreadable} ${unreadable === 1 ? "file" : "files"} could not be uploaded` : "",
          ].filter(Boolean).join("; ")
        : "");
    });
  }

  function startEdit(index) {
    const entry = normalizedEntries[index];
    if (!entry) return;
    setEditingIndex(index);
    pendingFilesRef.current = entry.attachments || [];
    setPendingFiles(entry.attachments || []);
    setDraft(entry.text);
    // setDraft reported against the files as they were before the line above, so the count
    // is stated again now that both are set.
    reportPending(entry.text, entry.attachments || []);
    window.requestAnimationFrame(() => {
      textRef.current?.focus();
    });
  }

  function toggleEntry(entryId) {
    setOpenEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  return (
    <div className={`w-full ${className}`}>
      <div className="sr-only">{label}</div>
      <div className="flex w-full flex-col">
        {/* The box, its files and its toolbar are one block, first in the pane, and they scroll
            with the remarks. This block was once pinnable - `sticky` at the top of the pane while
            the bubbles ran under it - and both callers have since dropped it: a box that holds the
            top spends the pane's height on an empty textarea. What brings it back when it is needed
            is the caller scrolling its own pane, which is where the refusal that needs it lives. */}
        <div>
        <div className={`w-full rounded-[1rem] border bg-white ${error ? "border-red-400" : "border-slate-300"}`}>
          <textarea
            ref={textRef}
            aria-invalid={error ? true : undefined}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`block w-full resize-none border-0 bg-white px-4 py-3 text-[15px] leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:ring-0 ${pendingFiles.length ? "rounded-t-[1rem]" : "rounded-[1rem]"} ${expandedComposer ? "min-h-[14rem]" : "min-h-[12rem]"}`}
          />
          {/* Inside the box, under the text, because these files are part of the note being
              written - not a list belonging to the lead. They are stored with the remark when
              it is posted, and go with it if it is never posted. */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 pb-3 pr-5 pt-4">
              {pendingFiles.map((file) => (
                <RemarkFileChip
                  key={file.id}
                  file={file}
                  onFetch={onFetchAttachment}
                  onRemove={() => setFiles(pendingFiles.filter((item) => item.id !== file.id))}
                />
              ))}
            </div>
          )}
        </div>

        {/* Files from before attachments belonged to a remark. Nothing new is ever added
            here - the paperclip clips to the note being written - so this row appears only
            for the few leads that already carry one, and empties as they are removed. */}
        {canAttach && (attachments || []).length > 0 && (
          <div className="mt-3 flex w-full flex-wrap items-center gap-2 pr-1.5 pt-1.5">
            <span className="text-[13px] text-slate-500">Attached to this lead:</span>
            {attachments.map((file) => (
              <RemarkFileChip
                key={file.id}
                file={file}
                onFetch={onFetchAttachment}
                onRemove={onAttachmentsChange ? () => onAttachmentsChange((attachments || []).filter((item) => item.id !== file.id)) : undefined}
              />
            ))}
          </div>
        )}

        {/* Said only when something was actually refused - a count sitting there permanently
            would be noise on the great majority of notes, which carry no files at all. */}
        {attachNotice && (
          <p role="alert" className="px-1 pb-1 text-xs font-medium text-rose-600">{attachNotice}</p>
        )}

        <div className="flex items-center justify-end gap-4 px-1 py-2 text-slate-800">
          {canAttach && <>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.txt" multiple onChange={handleAttach} className="sr-only" id={attachmentInputId} />
            <label htmlFor={attachmentInputId} className="inline-flex cursor-pointer items-center justify-center rounded-md p-1 hover:bg-slate-100" aria-label="Attach files">
              <AttachFileRoundedIcon sx={{ fontSize: 18 }} />
            </label>
          </>}
          <button type="button" onClick={() => insertFormatting("bullet")} className="inline-flex items-center justify-center rounded-md p-1 hover:bg-slate-100" aria-label="Bullet list">
            <FormatListBulletedRoundedIcon sx={{ fontSize: 18 }} />
          </button>
          <button type="button" onClick={() => insertFormatting("number")} className="inline-flex items-center justify-center rounded-md p-1 hover:bg-slate-100" aria-label="Numbered list">
            <FormatListNumberedRoundedIcon sx={{ fontSize: 18 }} />
          </button>
          <button type="button" onClick={() => setExpandedComposer((current) => !current)} className="inline-flex items-center justify-center rounded-md p-1 hover:bg-slate-100" aria-label="Resize notes">
            {expandedComposer ? <CloseFullscreenRoundedIcon sx={{ fontSize: 18 }} /> : <OpenInFullRoundedIcon sx={{ fontSize: 18 }} />}
          </button>
          {/* Appears only once something has been typed, last in the row after the resize
              control. Enter already posts the note; this is the same action for a mouse, and
              the only visible sign that a note has to be posted at all. In the module's blue
              rather than the messaging-app green, so it reads as this CRM's primary action. */}
          {showSendButton && (draft.trim() || pendingFiles.length > 0) && (
            <button
              type="button"
              onClick={() => submitDraft()}
              aria-label={editingIndex !== null ? "Save remark" : "Add remark"}
              title={editingIndex !== null ? "Save remark" : "Add remark"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <SendRoundedIcon sx={{ fontSize: 17 }} />
            </button>
          )}
        </div>
        {error && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{error}</p>}
        </div>
        {/* Newest first, under the box that writes the next one: the remark somebody wants is the
            last one written, and it should be the first thing under the composer rather than at
            the bottom of a list that grows with every call. The array itself stays in the order
            it was written - the caller saves it, and `startEdit` and `submitDraft` address an
            entry by its stored index - so only the render is turned round. */}
        <div className="mt-3 w-full">
          <div className="flex w-full flex-col gap-3">
            {normalizedEntries.length ? (
              normalizedEntries.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => (
                <div key={entry.id || `${index}`} className="w-full overflow-hidden rounded-[1.35rem] bg-blue-50">
                  <div className="flex items-start justify-between gap-3 px-5 py-4">
                    <button
                      type="button"
                      onClick={() => toggleEntry(entry.id)}
                      className="flex min-w-0 items-start gap-2 text-left text-[15px] text-slate-700"
                      aria-label={openEntryIds.has(entry.id) ? "Collapse remark" : "Expand remark"}
                    >
                      <span className="mt-0.5 text-[22px] leading-none text-slate-700">{openEntryIds.has(entry.id) ? "⌄" : "›"}</span>
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{formatDateTime(entry.createdAt)}</span>
                        {entryMeta?.(entry)}
                        {entry.editedAt && (
                          <span className="ml-1.5 text-[13px] text-slate-400" title={`Edited ${formatDateTime(entry.editedAt)}`}>(edited)</span>
                        )}
                        <span className="text-slate-500"> : {entry.text.split("\n")[0] || entry.attachments?.[0]?.name || ""}</span>
                        {/* Collapsed, a remark shows only its first line, and a file clipped
                            to it would be invisible until opened. */}
                        {entry.attachments?.length > 0 && (
                          <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[13px] text-slate-500">
                            <AttachFileRoundedIcon sx={{ fontSize: 14 }} />
                            {entry.attachments.length}
                          </span>
                        )}
                      </span>
                    </button>
                    {canEdit && <button
                      type="button"
                      onClick={() => startEdit(index)}
                      className="shrink-0 p-1 text-slate-800 transition hover:text-slate-950"
                      aria-label={`Edit remark ${index + 1}`}
                    >
                      <EditRoundedIcon sx={{ fontSize: 18 }} />
                    </button>}
                  </div>
                  {openEntryIds.has(entry.id) && (
                    <div className="px-12 pb-5">
                      <div className="text-[15px] leading-6 text-slate-500 whitespace-pre-wrap">
                        {entry.text.split("\n").slice(1).join("\n")}
                      </div>
                      {entry.attachments?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 pr-1.5 pt-1.5">
                          {entry.attachments.map((file) => (
                            <RemarkFileChip key={file.id} file={file} onFetch={onFetchAttachment} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : showEmptyState ? (
              <div className="w-full rounded-[1.35rem] bg-blue-50 px-5 py-5 text-[15px] text-slate-500">
                No remarks yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
