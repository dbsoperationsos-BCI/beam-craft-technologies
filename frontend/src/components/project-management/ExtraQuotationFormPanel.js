"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import useFormErrors from "@/components/shared/useFormErrors";
import useRemoteOptions from "@/components/shared/useRemoteOptions";
import { createExtraQuotation, getExtraQuotationOptions, searchExtraQuotationProjects, searchExtraQuotationShoots, updateExtraQuotation } from "@/services/sales/extra-quotations.service";
import { OTHER_SERVICE, serviceAndDeliverableOptions } from "@/lib/extraQuotationOptions.mjs";

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

const initialValues = { projectId: "", shootId: "", service: "", serviceOther: "", amount: "", remarks: "", addedById: "", addedAt: "", proof: [] };

const shootLabel = (shoot) => `${shoot.shootId} ${shoot.shoot}`.trim();
const projectLabel = (project) => `${project.eventId}${project.name ? ` — ${project.name}` : ""}`;

/**
 * The shoots of the project being quoted against — never another project's.
 *
 * Searched on the server where the screen offers one (`context.remote`), so the list is not the page
 * `options` opened on: that was the most recent 200 shoots for the whole studio, which the picker
 * then filtered down to this project's, so a project whose shoots were all older than the newest 200
 * offered none at all. The server narrows by `projectId` instead, which is the same rule.
 */
const shootsOf = (context, projectId) => {
  const opened = (context?.lookups?.shoots || []).filter((shoot) => shoot.projectId === projectId);
  const remote = context?.remote?.shoots;
  if (!remote) return opened.map((shoot) => ({ value: shoot.id, label: shootLabel(shoot) }));
  return remote.optionsFor(opened, [context?.values?.shootId], shootLabel);
};

/** The projects an extra can be raised against: a page to open on, and the rest by typing. */
const projectsOf = (context) => {
  const opened = context?.projectRows || [];
  const remote = context?.remote?.projects;
  if (!remote) return (context?.options?.projects || []);
  return remote.optionsFor(opened, [context?.values?.projectId], projectLabel);
};

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
        options: (values, context) => projectsOf({ ...context, values }),
        clears: ["shootId"],
        props: (values, context) => ({
          searchable: true,
          // Never disabled while it can be searched: typing is how the rest is reached.
          disabled: !(context?.options?.projects || []).length && !context?.remote?.projects,
          placeholder: "Which project is this for",
          ...(context?.remote?.projects ? context.remote.projects.props : {}),
        }),
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
        options: (values, context) => shootsOf({ ...context, values }, values.projectId),
        props: (values, context) => {
          const count = shootsOf({ ...context, values }, values.projectId).length;
          const remote = context?.remote?.shoots;
          return {
            searchable: true,
            // The project still has to be chosen first - the shoots are its own - but an empty page
            // no longer disables the box, since typing is what fetches the rest.
            disabled: !values.projectId || (!count && !remote),
            placeholder: !values.projectId ? "Choose the project first" : (count || remote) ? "Which shoot is this for" : "This project has no shoots yet",
            ...(remote ? remote.props : {}),
          };
        },
      },
      {
        name: "service",
        label: "Service / Deliverable",
        type: "select",
        required: true,
        options: "services",
        props: { searchable: true, placeholder: "Which service or deliverable is being added" },
      },
      {
        name: "serviceOther",
        label: "Which service or deliverable",
        required: true,
        // Only when the list could not name it. `when` is the schema form's own conditional, so the
        // field is absent rather than disabled when it does not apply — and its answer is dropped
        // on submit if the service is changed back to one from the list.
        when: (values) => values.service === OTHER_SERVICE,
        props: { placeholder: "Name the service or deliverable being added", maxLength: 150 },
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
  const fields = useFormErrors();

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
          if (editing && storedService && ![...(data.services || []), ...(data.deliverables || [])].includes(storedService)) {
            setForm((current) => ({ ...current, service: OTHER_SERVICE, serviceOther: storedService }));
          }
        })
        .catch((optionsError) => { if (live) setError(optionsError.message || "Unable to load the pickers for this form."); })
        .finally(() => { if (live) setLoading(false); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [editing, storedService]);

  const update = (name, value) => {
    fields.clear(name);
    setForm((current) => ({ ...current, [name]: value }));
  };

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
  /*
   * Both pickers are searched on the server; `options` carries a page for them to open on. The shoot
   * search is narrowed to the project chosen, which is the form's own rule - an extra belongs to one
   * project's shoot - rather than a cap.
   */
  const remoteProjects = useRemoteOptions(searchExtraQuotationProjects, { read: (data) => data.projects });
  const remoteShoots = useRemoteOptions(searchExtraQuotationShoots, {
    read: (data) => data.shoots,
    args: { projectId: fixedProject?.id || "" },
  });

  const context = useMemo(() => ({
    fixedProject,
    // The project rows as they come back, for the hook to label one a later search drops.
    projectRows: options.projects || [],
    remote: { projects: remoteProjects, shoots: remoteShoots },
    options: {
      projects: (options.projects || []).map((item) => ({ value: item.id, label: `${item.eventId}${item.name ? ` — ${item.name}` : ""}` })),
      services: serviceAndDeliverableOptions(options.services, options.deliverables),
      employees: (options.employees || []).map((person) => ({ value: String(person.id), label: `${person.employeeName}${person.employeeId ? ` · ${person.employeeId}` : ""}`, avatar: avatarOf(person) })),
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
  }), [editing, fixedProject, options, remoteProjects, remoteShoots]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const service = form.service === OTHER_SERVICE ? form.serviceOther.trim() : form.service;
    // Each problem under its own box; the panel's top line says only how many.
    if (!fields.check({
      projectId: form.projectId ? "" : "Choose the project this extra is for.",
      service: form.service ? "" : "Choose the service or deliverable being added.",
      serviceOther: form.service === OTHER_SERVICE && !service ? "Name the service or deliverable being added." : "",
      amount: Number(form.amount) > 0 ? "" : "Enter an amount greater than zero.",
      addedById: form.addedById ? "" : "Choose the employee who added this extra.",
      addedAt: form.addedAt ? "" : "Enter the date this extra was added.",
    })) return;

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
      if (fields.fromServer(requestError)) return;
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
    errors={fields.errors}
    context={context}
    sidebarAriaLabel="Extra quotation sections"
    closeAriaLabel="Close extra quotation form"
    onClose={onClose}
    onSubmit={submit}
    error={error || fields.summary}
    saving={saving}
    loading={loading}
    loadingLabel="Loading the pickers..."
    submitLabel={editing ? "Update" : "Send for Approval"}
    savingLabel={editing ? "Saving..." : "Sending..."}
    zIndexClassName="z-[130]"
  />;
}
