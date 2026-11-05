/**
 * Which parts of a schema form apply to the answers so far.
 *
 * Two rules, and the only two, so that everything reading a schema agrees about what is on screen:
 * the renderer that draws the fields, the panel that lays out the sections, and the required-field
 * check that refuses a submit. A check that judged the schema flat while the panel drew it
 * conditionally would demand answers to questions nobody was asked - a shipment address on a status
 * form that is not a shipment, the far side of a branch nobody took.
 *
 * Free of React and of JSX so `test/schema-form-required.test.mjs` can load it; `SchemaFormFields`
 * re-exports both, so the many callers that already import them from there are unchanged.
 */

/** A field or a section applies unless its `when` says otherwise. */
export const isVisible = (item, values, context) => !item.when || item.when(values, context);

/** The fields of a section that apply to the values currently in the form. */
export const visibleFields = (fields, values, context) => (fields || []).filter((field) => isVisible(field, values, context));
