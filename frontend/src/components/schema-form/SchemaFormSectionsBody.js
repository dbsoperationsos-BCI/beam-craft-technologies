"use client";

import SchemaFormField, { isVisible, visibleFields } from "./SchemaFormFields";
import SchemaFormSection from "./SchemaFormSection";
import SchemaFormSummary from "./SchemaFormSummary";

/**
 * `SchemaFormPanel`'s own section-and-field rendering, drawn as plain content rather than as a
 * panel of its own.
 *
 * For embedding a config-driven set of sections — the Login Credentials fields, say — inside one
 * page of a *different* panel's rail, rather than opening a second full-screen panel over the
 * first. `SchemaFormPanel` already renders `sections` this exact way internally; this is that same
 * logic, pulled out so a caller hosting more than one section-set under one rail is not left
 * copying it by hand.
 */
export default function SchemaFormSectionsBody({ sections, values, onChange, errors, context }) {
  return <>
    {(sections || []).filter((section) => isVisible(section, values, context)).map((section) => <SchemaFormSection key={section.id} id={section.id} title={section.title}>
      {section.summary && <SchemaFormSummary items={section.summary(values, context)} className="mb-4" />}
      {section.render?.({ values, onChange, context, errors })}
      {section.fields && <div className={`grid gap-4 ${section.columns === 1 ? "" : "md:grid-cols-2"}`}>
        {visibleFields(section.fields, values, context).map((field) => <SchemaFormField key={field.name} field={field} values={values} onChange={onChange} errors={errors} context={context} />)}
      </div>}
    </SchemaFormSection>)}
  </>;
}
