"use client";

import TextField from "@/components/shared/TextField";

/**
 * A technical number in the Face Matching and Privacy sections: the shared number box, with a
 * sentence on what the value does and its valid range in the field's ⓘ. Every tunable value is
 * shown this way so none of them is a bare box a reader has to guess the meaning and the limits of.
 *
 * A box left empty sends nothing - the stored value stays - which is how the previous panel treated
 * an empty number too; see `payloadOf`.
 */
export default function NumberSetting({ label, value, onChange, min, max, step = 1, unit, description, error, disabled = false, readOnly = false }) {
  const rangeText = unit ? `Range: ${min} – ${max} ${unit}` : `Range: ${Number(min).toFixed(2)} – ${Number(max).toFixed(2)}`;
  return <TextField
    label={label}
    helperText={description ? `${description} ${rangeText}.` : `${rangeText}.`}
    type="number"
    min={min}
    max={max}
    step={step}
    inputMode="decimal"
    readOnly={readOnly}
    disabled={disabled && !readOnly}
    error={error}
    value={value ?? ""}
    onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
  />;
}
