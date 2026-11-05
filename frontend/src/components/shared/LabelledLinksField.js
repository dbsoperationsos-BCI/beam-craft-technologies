"use client";

import { useState } from "react";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { MAX_LABELLED_LINKS, newLinkProblems } from "@/lib/labelledLinks.mjs";

/**
 * A list of links added under a label, inside a form grid - a branch's External URLs and its Social
 * Media Links.
 *
 * Each added link is a row: a field under the label it was given, still editable, and a button to
 * take it off. Under the rows, `addLabel` opens a dialog asking for the label and the link together;
 * both are checked there (`newLinkProblems`) and the row arrives filled in.
 *
 * Two ways to name a link. Freely, by default: the Label is a text box, and at `max` the button gives
 * way to a note. Or from a fixed set, with `labelOptions`: the Label is a dropdown of the options not
 * yet added, and once every one is added the button stays, disabled, saying why.
 *
 * Rendered as grid items of the form it sits in, so its rows fall into the form's own columns. The
 * dialog sits over the form on `layer`. `errors` is one message per row, or `{ list }` for a message
 * about the whole list from the server.
 */
export default function LabelledLinksField({
  links = [],
  onChange,
  errors,
  disabled = false,
  addLabel,
  dialogTitle,
  dialogDescription = "Name the link and paste its address.",
  labelPlaceholder = "e.g. YouTube",
  linkPlaceholder = "https://...",
  reservedLabels = [],
  labelOptions = null,
  max = MAX_LABELLED_LINKS,
  layer = "dialogOverPanel",
}) {
  // The link being added, label and address together, while the dialog is open.
  const [draft, setDraft] = useState(null);
  const [problems, setProblems] = useState({});
  const rowErrors = Array.isArray(errors) ? errors : [];
  // From a fixed set: the labels not yet added, in the order the set lists them.
  const remaining = labelOptions ? labelOptions.filter((option) => !links.some((link) => link.label === option)) : null;

  const edit = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setProblems((current) => ({ ...current, [field]: "" }));
  };
  function add() {
    const found = newLinkProblems(draft, { links, reservedLabels });
    if (found.label || found.url) { setProblems(found); return; }
    onChange([...links, { label: draft.label.trim(), url: draft.url.trim() }]);
    setDraft(null);
  }
  const submitOnEnter = (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } };

  return <>
    {links.map((link, index) => <div key={`${link.label}-${index}`} className="flex items-end gap-2">
      <TextField
        className="min-w-0 flex-1"
        label={link.label}
        inputMode="url"
        maxLength={500}
        value={link.url}
        error={rowErrors[index] || ""}
        onChange={(event) => onChange(links.map((entry, at) => (at === index ? { ...entry, url: event.target.value } : entry)))}
        placeholder="https://..."
      />
      <IconButton size="md" ariaLabel={`Remove the ${link.label} link`} onClick={() => onChange(links.filter((_, at) => at !== index))} disabled={disabled} className="mb-0.5 shrink-0 text-slate-500">
        <DeleteOutlineRounded sx={{ fontSize: 20 }} />
      </IconButton>
    </div>)}
    <div className="sm:col-span-2">
      {remaining
        ? <Button type="button" variant="secondary" onClick={() => { setProblems({}); setDraft({ label: remaining[0] || "", url: "" }); }} disabled={disabled || !remaining.length} title={remaining.length ? undefined : "All of them are added."}>{addLabel}</Button>
        : links.length < max
          ? <Button type="button" variant="secondary" onClick={() => { setProblems({}); setDraft({ label: "", url: "" }); }} disabled={disabled}>{addLabel}</Button>
          : <p className="text-xs text-slate-500">Up to {max} added links.</p>}
      {errors?.list && <p role="alert" className="mt-1.5 text-xs text-red-600">{errors.list}</p>}
    </div>

    {draft && <Dialog
      layer={layer}
      title={dialogTitle}
      description={dialogDescription}
      onClose={() => setDraft(null)}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setDraft(null)}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant="primary" onClick={add}>Add link</Button>
      </>}
    >
      {/* Padded underneath, as every dialog form here is, so the last box's border and focus ring
          are not cut off by the body's scroll edge. Enter in either box adds the link. No <form>:
          this dialog opens over forms that are already one. */}
      <div className="space-y-3 pb-2">
        {remaining
          ? <Dropdown
            required
            label="Label"
            value={draft.label}
            options={remaining.map((option) => ({ value: option, label: option }))}
            onChange={(value) => edit("label", value || "")}
            error={problems.label}
            searchable={false}
            sorted={false}
          />
          : <TextField required label="Label" maxLength={50} value={draft.label} error={problems.label} onChange={(event) => edit("label", event.target.value)} onKeyDown={submitOnEnter} placeholder={labelPlaceholder} autoFocus />}
        <TextField required label="Link" inputMode="url" maxLength={500} value={draft.url} error={problems.url} onChange={(event) => edit("url", event.target.value)} onKeyDown={submitOnEnter} placeholder={linkPlaceholder} autoFocus={Boolean(remaining)} />
      </div>
    </Dialog>}
  </>;
}
