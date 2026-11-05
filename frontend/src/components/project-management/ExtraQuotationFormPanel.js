"use client";

import { useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { createExtraQuotation, getExtraQuotationOptions, updateExtraQuotation } from "@/services/sales/extra-quotations.service";

/**
 * Raising an extra: work agreed on top of what a project was sold for.
 *
 * One panel for both places it can be raised from — a project's own Payments tab, where the project
 * is already known, and the requests screen, where it is not. `project` is what tells them apart:
 * given one, the picker goes and a line names it instead, and the shoots offered are that project's.
 * Two forms would have drifted the first time a field changed.
 *
 * It asks for what a manager needs to decide it and nothing more: which service, on which shoot,
 * for how much, why, and what the client agreed to.
 */

const today = () => new Date().toISOString().slice(0, 10);
/**
 * The choice that means "not on the studio's list".
 *
 * A sentinel rather than a real service name, so it can never collide with one the studio adds
 * later — and it is never what gets saved: the typed name is sent in its place, because a row
 * reading "Others" tells a manager approving it nothing at all.
 */
const OTHER_SERVICE = "__other__";

const initialValues = { projectId: "", shootId: "", service: "", serviceOther: "", amount: "", remarks: "", addedById: "", addedAt: "", proof: [] };

/** The shoots of the project being quoted against — never another project's. */
const shootsOf = (context, projectId) => (context?.lookups?.shoots || [])
  .filter((shoot) => shoot.projectId === projectId)
  .map((shoot) => ({ value: shoot.id, label: `${shoot.shootId} ${shoot.shoot}`.trim() }));

const sections = [
  {
    id: "extra",
    title: "Extra Details",
    fields: [
      {
        name: "projectId",
        label: "Project",
        type: "select",
        required: true,
        // Absent when the panel was opened from a project: it is already answered, and a picker
        // offering to change it would be offering to file the extra somewhere else.
        when: (values, context) => !context?.fixedProject,
        options: "projects",
        clears: ["shootId"],
        props: (values, context) => ({ searchable: true, disabled: !(context?.options?.projects || []).length, placeholder: "Which project is this for" }),
      },
      { name: "projectFixed", type: "custom", colSpan: 2, when: (values, context) => Boolean(context?.fixedProject) },
      // Who the extra belongs to and when it was agreed — asked rather than assumed, because a
      // coordinator often enters one for the person who settled it with the client, and an extra
      // agreed on the shoot day is typed in the morning after. Left empty they fall back to whoever
      // is signed in, today.
      {
        name: "addedById",
        label: "Added by",
        type: "select",
        required: true,
        options: "employees",
        props: (values, context) => ({ searchable: true, disabled: !(context?.options?.employees || []).length, placeholder: "Which employee added this" }),
      },
      { name: "addedAt", label: "Added at", type: "date", required: true, props: { restriction: "future" } },
      {
        name: "shootId",
        label: "Shoot",
        type: "select",
        // Optional: an extra agreed for the project as a whole belongs to no one shoot.
        options: (values, context) => shootsOf(context, values.projectId),
        props: (values, context) => {
          const count = shootsOf(context, values.projectId).length;
          return { searchable: true, disabled: !values.projectId || !count, placeholder: !values.projectId ? "Choose the project first" : count ? "Which shoot is this for" : "This project has no shoots yet" };
        },
      },
      {
        name: "service",
        label: "Service",
        type: "select",
        required: true,
        options: "services",
        props: { searchable: true, placeholder: "Which service is being added" },
      },
      {
        name: "serviceOther",
        label: "Which service",
        required: true,
        // Only when the list could not name it. `when` is the schema form's own conditional, so the
        // field is absent rather than disabled when it does not apply — and its answer is dropped
        // on submit if the service is changed back to one from the list.
        when: (values) => values.service === OTHER_SERVICE,
        props: { placeholder: "Name the service being added", maxLength: 150 },
      },
      { name: "amount", label: "Amount", required: true, props: { type: "number", min: 0, step: "0.01", inputMode: "decimal", placeholder: "0.00" } },
      { name: "remarks", label: "Remarks", type: "textarea", colSpan: 2, props: { rows: 3, placeholder: "What was agreed, and with whom." } },
      {
        name: "proof",
        label: "Attachments",
        type: "file",
        colSpan: 2,
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 5 },
      },
    ],
  },
];

export default function ExtraQuotationFormPanel({ project = null, extra = null, onClose, onCreated }) {
  const editing = Boolean(extra);
  const [form, setForm] = useState(() => (editing
    ? {
      projectId: extra.projectId || "",
      shootId: extra.shootId || "",
      service: extra.service || "",
      amount: extra.amount === null || extra.amount === undefined ? "" : String(extra.amount),
      remarks: extra.remarks || "",
      addedById: extra.addedById ? String(extra.addedById) : "",
      addedAt: (extra.addedAt || extra.createdAt || "").slice(0, 10),
      // The proof works in links: the files already stored come back as their URLs and are sent
      // again untouched, so an edit never rewrites who uploaded what or when.
      proof: Array.isArray(extra.proof)
        ? extra.proof.map((file) => file?.url).filter(Boolean)
        : (extra.proofUrls || []),
    }
    : { ...initialValues, projectId: project?.id || "", addedAt: today() }));
  const [options, setOptions] = useState({ projects: [], shoots: [], services: [], employees: [] });
  // Read once rather than off `extra` inside the effect, so the effect depends on the one string it
  // actually cares about instead of on a prop object that is a new reference every render.
  const storedService = editing ? extra.service || "" : "";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void getExtraQuotationOptions()
        .then((result) => {
          if (!live) return;
          const data = result?.data || { projects: [], shoots: [], services: [], employees: [] };
          setOptions(data);
          /*
           * A stored service the studio's list does not hold was typed through Others when it was
           * raised, so editing puts the form back into that state.
           *
           * It cannot be settled when the form is first built: the list arrives from the server a
           * moment later, and until it does there is no way to tell a custom name from one that is
           * simply not loaded yet. Without this the picker would open on nothing and a save would
           * quietly replace the typed service with whatever was chosen instead.
           */
          if (editing && storedService && !(data.services || []).includes(storedService)) {
            setForm((current) => ({ ...current, service: OTHER_SERVICE, serviceOther: storedService }));
          }
        })
        .catch((optionsError) => { if (live) setError(optionsError.message || "Unable to load the pickers for this form."); })
        .finally(() => { if (live) setLoading(false); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [editing, storedService]);

  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  /*
   * The project this form is settled on, whichever way it was opened: handed in when raising from a
   * project, and read off the extra when editing one. Memoised because it is a fresh object each
   * render otherwise, which would rebuild the context — and with it every field's props — on every
   * keystroke.
   */
  const fixedProject = useMemo(
    () => project || (editing ? { id: extra.projectId, eventId: extra.projectCode, name: extra.projectName } : null),
    [editing, extra, project],
  );
  const context = useMemo(() => ({
    fixedProject,
    options: {
      projects: (options.projects || []).map((item) => ({ value: item.id, label: `${item.eventId}${item.name ? ` — ${item.name}` : ""}` })),
      // Last, after the studio's own list, so it reads as the way out rather than a service.
      services: [...(options.services || []).map((name) => ({ value: name, label: name })), { value: OTHER_SERVICE, label: "Others" }],
      employees: (options.employees || []).map((person) => ({ value: String(person.id), label: `${person.employeeName}${person.employeeId ? ` · ${person.employeeId}` : ""}` })),
    },
    // The shoot list is narrowed to the project chosen, so the records themselves are kept rather
    // than a ready-made option list.
    lookups: { shoots: options.shoots || [] },
    renderers: {
      projectFixed: () => <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">Project</span>
          <p className="break-words text-xs font-medium text-slate-900 sm:text-sm">{[fixedProject?.eventId, fixedProject?.name].filter(Boolean).join(" — ") || "—"}</p>
        </div>
        <span className="text-[11px] text-slate-500 sm:text-xs">{editing ? "An extra stays on the project it was raised against." : "The project this was opened from."}</span>
      </div>,
    },
  }), [editing, fixedProject, options]);

  async function submit(event) {
    event.preventDefault();
    if (!form.projectId) return setError("Choose the project this extra is for.");
    if (!form.service) return setError("Choose the service being added.");
    const service = form.service === OTHER_SERVICE ? form.serviceOther.trim() : form.service;
    if (!service) return setError("Name the service being added.");
    if (!(Number(form.amount) > 0)) return setError("Enter an amount greater than zero.");
    if (!form.addedById) return setError("Choose the employee who added this extra.");
    if (!form.addedAt) return setError("Enter the date this extra was added.");

    setSaving(true);
    setError("");
    try {
      const payload = {
        projectId: form.projectId,
        shootId: form.shootId || null,
        // The typed name, never the sentinel: what is stored is the service itself.
        service,
        amount: Number(form.amount),
        remarks: form.remarks.trim() || null,
        addedById: form.addedById ? Number(form.addedById) : null,
        addedAt: form.addedAt || undefined,
        proof: Array.isArray(form.proof) ? form.proof : [],
      };
      const result = editing ? await updateExtraQuotation(extra.id, payload) : await createExtraQuotation(payload);
      const code = result?.data?.requestCode || "The extra";
      onCreated?.(result?.data, editing ? `${code} updated.` : `${code} raised. It is waiting for the project manager's approval.`);
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message || `Unable to ${editing ? "update" : "raise"} this extra quotation.`);
    } finally {
      setSaving(false);
    }
  }

  return <SchemaFormPanel
    title={editing ? `Edit ${extra.requestCode || "Extra Quotation"}` : "Raise an Extra Quotation"}
    description={editing
      ? "Only while it is still waiting: once the manager has approved it, the figure is what the project agreed to sell."
      : "Work agreed on top of what this project was sold for. The project's manager approves it."}
    sections={sections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Extra quotation sections"
    closeAriaLabel="Close extra quotation form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    loading={loading}
    loadingLabel="Loading the pickers..."
    submitLabel={editing ? "Update" : "Send for Approval"}
    savingLabel={editing ? "Saving..." : "Sending..."}
    zIndexClassName="z-[130]"
  />;
}
