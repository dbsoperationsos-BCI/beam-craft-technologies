"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";

/**
 * One size option's settings, configured in a dialog rather than in the table.
 *
 * Two fields is not many, and a dialog for two fields would be fussy on its own. It earns its place
 * by being the third of three: Services and Deliverables are configured this way, and a Size Options
 * table that still edited in place - committing each cell on change, with a Save button that applied
 * only to this section - would be the one screen in Project Settings that behaved differently.
 *
 * The set the value belongs to is named in the description rather than offered as a field: it is
 * chosen above the table, and moving a value between sets is not something this dialog is for.
 */
export default function OptionValueDialog({
  optionValue = null,
  optionSetName = "",
  /* The label typed into the box above the table, carried into a new value. */
  initialLabel = "",
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const isEdit = Boolean(optionValue?.id);
  const [initial] = useState(() => ({
    label: optionValue?.label || initialLabel || "",
    pricePerQuantity: optionValue?.pricePerQuantity == null ? "" : String(optionValue.pricePerQuantity),
  }));
  const [form, setForm] = useState(initial);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  /*
   * The button is disabled until pressing it would do something.
   *
   * Adding needs a name; editing needs a change. An Update that writes the same values back is a
   * request nobody meant to make, and a button that looks live when it has nothing to do is the
   * thing that makes people press it twice and wonder which press counted.
   *
   * The same rule the settings panel's own Save follows, so a dialog and the panel behind it agree
   * about when there is something to save.
   */
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const labelled = form.label.trim();

  return (
    <Dialog
      title={isEdit ? "Edit Option Value" : "Add Option Value"}
      description={optionSetName ? `A value in ${optionSetName}.` : "A value in this option set."}
      size="form"
      layer="dialogOverPanel"
      busy={saving}
      onClose={onClose}
      footer={<>
        <Button className="max-sm:flex-1" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          className="max-sm:flex-1"
          type="button"
          variant="primary"
          disabled={saving || !labelled || (isEdit && !dirty)}
          onClick={() => onSubmit({
            label: labelled,
            // Null is the answer, not the absence of one: it says this size is not priced yet.
            pricePerQuantity: form.pricePerQuantity === "" ? null : Number(form.pricePerQuantity),
          })}
        >
          {saving ? (isEdit ? "Updating..." : "Adding...") : (isEdit ? "Update" : "Add")}
        </Button>
      </>}
    >
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Option Value"
          required
          value={form.label}
          onChange={(event) => set({ label: event.target.value })}
          placeholder="Enter option value"
          disabled={saving}
          className="sm:col-span-2"
        />

        {/* Per unit, because a 12x6 album is not priced like a 36x18 one. */}
        <TextField
          label="Pricing per Sheet or Quantity"
          type="number"
          min="0"
          step="0.01"
          value={form.pricePerQuantity}
          onChange={(event) => set({ pricePerQuantity: event.target.value })}
          placeholder="Leave empty if it is not priced yet"
          disabled={saving}
        />
      </div>
    </Dialog>
  );
}
