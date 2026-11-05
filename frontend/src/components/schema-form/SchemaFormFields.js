"use client";

import ComboBoxField from "@/components/shared/ComboBoxField";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import FileUploadField from "@/components/shared/FileUploadField";
import ImageUploadField from "@/components/shared/ImageUploadField";
import MultiSelectField from "@/components/shared/MultiSelectField";
import PhoneField from "@/components/shared/PhoneField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SelectableOption from "@/components/shared/SelectableOption";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import PendingField from "@/components/shared/PendingField";

/**
 * Turns one field description into the shared input that suits it, so a form is a list of fields
 * rather than a wall of JSX. A field is:
 *
 *   { name, label, type, required, placeholder, options, colSpan, when, clears, render, props }
 *
 * `type` picks the input — text, textarea, select, date, time, toggle, checkbox, radio, file, image,
 * or custom for anything with no shared equivalent. `props` is passed straight through to it, which is
 * where the one-off details go (`type: "tel"`, `rows`, `min`, `accept`, `searchable`); it may also
 * be a function of the current values when a field is only sometimes readable or disabled.
 *
 * `options` accepts a list of strings, a list of `{ value, label }`, a key into `context.options`,
 * or a function of the current values — which is how one field narrows another, as a sub category
 * narrows to the category above it.
 *
 * `when(values, context)` hides a field until it applies, `clears` names the fields to empty when
 * this one changes, so a pair can never be left half from one branch and half from another, and
 * `derive(value, values, context)` returns the other fields this answer settles.
 */
export function resolveOptions(options, values, context) {
  const list = typeof options === "function"
    ? options(values, context)
    : typeof options === "string" ? context?.options?.[options] : options;
  return (list || []).map((option) => typeof option === "object" && option !== null ? option : { value: option, label: String(option) });
}

// Defined next door, free of JSX, so the required-field check can load the same two rules this
// renderer draws by. Re-exported here because every caller in the app already reaches for them
// through this file.
export { isVisible, visibleFields } from "./schemaVisibility.mjs";

const isEmptyAnswer = (value) => value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);

/*
 * `context.pendingTags`: a form whose asterisks are exactly what it counts towards being done - Pre
 * Production's shoot form, Production's plan - tags each required field **Pending** while it is
 * unanswered (`PendingField`), gone the moment it is filled.
 */
export default function SchemaFormField(props) {
  const { field, values, context } = props;
  const control = <SchemaFormControl {...props} />;
  if (!context?.pendingTags || field.type === "custom") return control;
  const required = typeof field.required === "function" ? Boolean(field.required(values, context)) : Boolean(field.required);
  // The grid cell is the wrapper when it draws, so it takes the field's span.
  return <PendingField pending={required && isEmptyAnswer(values?.[field.name])} className={field.colSpan === 2 || field.colSpan === "full" ? "md:col-span-2" : ""}>{control}</PendingField>;
}

function SchemaFormControl({ field, values, onChange, errors, notes, context }) {
  const { name, label: fieldLabel, type = "text", required: fieldRequired = false, placeholder: fieldPlaceholder, options, colSpan, clears, derive, render, helperText: fieldHelper, props: fieldProps = {} } = field;
  // A label, placeholder, the props themselves or **whether it is required** can depend on the
  // answers so far, which is how one reason field asks for a cancellation reason and the next for a
  // disposal reason, how a permanent address stops taking input once it is being copied from the
  // current one, and how a production plan asks for a Travel Mode on an outdoor shoot alone.
  const required = typeof fieldRequired === "function" ? Boolean(fieldRequired(values, context)) : fieldRequired;
  const label = typeof fieldLabel === "function" ? fieldLabel(values, context) : fieldLabel;
  const placeholder = typeof fieldPlaceholder === "function" ? fieldPlaceholder(values, context) : fieldPlaceholder;
  const props = typeof fieldProps === "function" ? fieldProps(values, context) : fieldProps;
  const value = values?.[name];
  const error = errors?.[name] || "";
  /*
   * A remark about the answer, as opposed to a fault in it - drawn amber under the box, in the slot
   * the error uses, and never alongside one.
   *
   * It is what lets a form say "this number is already on the register" while the number is being
   * typed, rather than refusing the record once somebody has filled the whole thing in. Carried
   * here beside `errors` so a form passes it the same way, and reaching only the controls that can
   * draw it - a note under a toggle or a file picker would be a slot nothing fills.
   */
  const note = notes?.[name] || "";
  const className = `${colSpan === 2 || colSpan === "full" ? "md:col-span-2" : ""} ${props.className || ""}`.trim();
  // `helperText` on the field: what to enter and what it changes, shown as the ⓘ beside its label.
  const helperText = typeof fieldHelper === "function" ? fieldHelper(values, context) : fieldHelper;
  const rest = { ...(helperText ? { helperText } : {}), ...props };
  delete rest.className;

  // An input can report a problem with what was picked alongside the value itself — an image that is
  // the wrong type or too large — which is passed on to the form to decide how to say so. Every
  // other input is wrapped below rather than handed `set` bare, since several of them pass a second
  // argument of their own (the event, the chosen option) that is not a rejection.
  function set(next, rejection) {
    onChange(name, next, rejection);
    // Emptied to the shape the field already holds, not to `""` regardless. A file or image field
    // holds a list, and handing it an empty string leaves the form carrying a value of the wrong
    // type — which the field itself survives, since it coerces on the way in, and the server then
    // rejects on submit with a complaint about a field nobody touched.
    (clears || []).forEach((other) => onChange(other, Array.isArray(values?.[other]) ? [] : ""));
    // A field can fill in the ones its answer implies — choosing a sub category settles which
    // category it belongs to, so the form does not ask again for something it already knows.
    const derived = derive?.(next, values, context);
    if (derived) Object.entries(derived).forEach(([key, value]) => onChange(key, value));
  }

  // A field with no shared input draws itself: either from `render` on the field, or from a
  // renderer the form passes in `context.renderers`, which keeps JSX out of the field lists.
  if (type === "custom") {
    const renderer = render || context?.renderers?.[name];
    // `min-w-0`: this div is the grid cell, and a cell is as wide as its content by default - a
    // multi-select's chips in one line pushed the whole column wider instead of scrolling inside it.
    return <div className={`min-w-0 ${className || ""}`.trim()}>{renderer?.({ values, onChange: (next) => set(next), context, field, error })}</div>;
  }

  // `error` reaches every branch below. Four of them took none at all - a toggle, a checkbox, a time
  // and a file - so a required agreement, a required tick, a required time and a missing proof
  // document were the four kinds of unanswered question this renderer could not show. Each said so
  // only in the notice at the top of the panel, which names the field and cannot point at it.
  if (type === "toggle") return <ToggleSwitch label={label} error={error} checked={Boolean(value)} onCheckedChange={(checked) => set(checked)} className={className} {...rest} />;

  if (type === "checkbox") return <SelectableOption label={label} error={error} checked={Boolean(value)} onCheckedChange={(checked) => set(checked)} className={className} {...rest} />;

  /*
   * `combobox` is a `select` whose list is a suggestion rather than a rule: the common answers are
   * offered so they are spelled consistently, and anything the list's author did not think of can
   * still be typed. For a field that usually comes from a known set but is not closed - who an
   * emergency contact is to somebody, where a lead heard about the studio.
   *
   * Its own type rather than a flag on `select`, because the two behave differently in the way that
   * matters most: a select settles only on a row being chosen, and this settles on every keystroke.
   */
  // `error` reaches both of these. It was left off, and neither says so quietly: `ComboBoxField`
  // draws a red border and the message from it, and `RadioGroupField` marks itself `aria-invalid`
  // and reddens its border - so a required combo box or radio group refused on a form drawn from
  // this renderer looked exactly like one that had been answered. The employee panel's own
  // `FormField` had always passed it; this is the shared renderer catching up, which is what the
  // public onboarding form draws Emergency Contact Relationship with.
  if (type === "combobox") return <ComboBoxField label={label} required={required} error={error} value={value ?? ""} onChange={(next) => set(next)} options={resolveOptions(options, values, context).map((option) => option.label)} placeholder={placeholder || "Select or type"} className={className} {...rest} />;

  /*
   * A stored answer that is not on the list is added to it rather than lost.
   *
   * `Dropdown` shows its placeholder for a value it cannot find among its options, so a record
   * answered before that field had a list - or before an option was retired from one - would read
   * "Select" while still holding and re-submitting the old answer. The value is kept and the box
   * says what it says, which is the same rule the Employee Repository's own form already applies.
   *
   * An **optional** select can also be put back to unanswered, through the menu's own None row; a
   * required one cannot, since the panel would refuse the save for the answer it gives. `clearable`
   * sits before `rest`, so a field description can still say otherwise.
   */
  if (type === "select") {
    const listed = resolveOptions(options, values, context);
    const stored = value ?? "";
    const selectOptions = stored === "" || listed.some((option) => option.value === stored)
      ? listed
      : [...listed, { value: stored, label: String(stored) }];
    return <Dropdown label={label} required={required} clearable={!required} error={error} value={stored} onChange={(next) => set(next)} options={selectOptions} placeholder={placeholder || "Select"} className={className} {...rest} />;
  }

  // Several answers from one list, held as a list - people to name, say. Searchable, since such a list
  // is usually long, and an option carrying `avatar` shows the person's face beside their name.
  if (type === "multiselect") return <MultiSelectField label={label} required={required} error={error} values={Array.isArray(value) ? value : []} onChange={(next) => set(next)} options={resolveOptions(options, values, context)} placeholder={placeholder || "Select"} searchable className={className} {...rest} />;

  // The options are passed through rather than flattened to their labels, so a radio can store a
  // value that is not the words shown — and carry a description explaining the choice.
  if (type === "radio") return <RadioGroupField label={label} required={required} error={error} value={value ?? ""} onChange={(next) => set(next)} options={resolveOptions(options, values, context)} className={className} {...rest} />;

  if (type === "date") return <DateField label={label} required={required} error={error} value={value ?? ""} onChange={(next) => set(next)} className={className} {...rest} />;

  if (type === "phone") return <PhoneField label={label} field={name} required={required} error={error} note={note} value={value ?? ""} onChange={(fieldName, val) => set(val)} className={className} {...rest} />;

  if (type === "time") return <TimeField label={label} required={required} error={error} value={value ?? ""} onChange={(event) => set(event.target.value)} className={className} {...rest} />;

  if (type === "file") return <FileUploadField label={label} required={required} error={error} value={Array.isArray(value) ? value : []} onChange={(next) => set(next)} className={className} {...rest} />;

  if (type === "image") return <ImageUploadField label={label} required={required} error={error} value={value} onChange={(next, imageError) => set(next, imageError)} className={className} {...rest} />;

  if (type === "textarea") return <TextAreaField label={label} required={required} error={error} value={value ?? ""} onChange={(event) => set(event.target.value)} placeholder={placeholder} className={className} {...rest} />;

  return <TextField label={label} required={required} error={error} note={note} value={value ?? ""} onChange={(event) => set(event.target.value)} placeholder={placeholder} className={className} {...rest} />;
}
