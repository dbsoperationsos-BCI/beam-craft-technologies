"use client";

import { useCallback, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import ProjectActivityTab from "@/components/project-management/ProjectActivityTab";
import Button from "@/components/shared/Button";
import Tabs from "@/components/ui/Tabs";

/*
 * View, for a row of Client Management - a client's request, an offer, an invitation design, a song,
 * an invitation the client is paying for: the full-screen panel a project opens in, with two tabs.
 *
 * - **Details**: the record's facts in sections, each a label over its value as a project's
 *   Identification reads, beside a picture of it where it has one (`preview`).
 * - **Activity**: what has happened to it, oldest first, drawn as the project's flow is
 *   (`ProjectActivityTab`) with the record's own stages - who raised it, quoted it, changed it, paid.
 *
 * `sections` is `[{ title, fields: [{ label, value }] }]` (an empty value reads "—"); `activity` the
 * flow's lines `[{ id, stage, at, title, detail, by }]`; `stages` its journey. `actions` sit before Close.
 * A record that is more than facts - a client's requests, shoot by shoot - passes its own first tab
 * as `children` (named `detailsLabel`) in place of the sections.
 */
export default function ClientRecordPanel({ title, titleAddon, description, sections = [], preview = null, stages, activity = [], heading, onClose, actions = null, children = null, detailsLabel = "Details" }) {
  const [tab, setTab] = useState("details");
  const tabs = [{ id: "details", label: detailsLabel }, { id: "activity", label: "Activity" }];
  const load = useCallback(() => Promise.resolve({ data: activity }), [activity]);
  return <SchemaFormPanel
    title={title}
    titleAddon={titleAddon}
    description={description}
    tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Record sections" />}
    sections={[]}
    values={{}}
    onChange={() => {}}
    onSubmit={(event) => event.preventDefault()}
    onClose={onClose}
    closeAriaLabel="Close"
    footer={<>
      {actions}
      <Button className="max-sm:w-full" type="button" variant="primary" onClick={onClose}>Close</Button>
    </>}
  >
    {tab === "details" && children ? <div className="w-full max-w-[1200px] px-4 py-5 sm:px-6">{children}</div> : null}
    {tab === "details" && !children && <div className="flex w-full max-w-[1100px] flex-col gap-8 px-4 py-5 sm:px-6 lg:flex-row">
      {preview ? <div className="shrink-0 lg:w-64">{preview}</div> : null}
      <div className="min-w-0 flex-1 space-y-8">
        {sections.map((section) => <section key={section.title}>
          <h2 className="border-b border-slate-200 pb-3 text-lg font-medium text-slate-900">{section.title}</h2>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {section.fields.map((field) => <div key={field.label} className="border-b border-slate-100 py-4">
              <dt className="text-sm text-slate-500">{field.label}</dt>
              <dd className="mt-1 break-words text-base text-slate-900">{field.value === null || field.value === undefined || field.value === "" ? "—" : field.value}</dd>
            </div>)}
          </dl>
        </section>)}
      </div>
    </div>}
    {tab === "activity" && <div className="w-full">
      <ProjectActivityTab load={load} refreshKey={activity.length} stages={stages} heading={heading || "Activity, oldest first"} emptyText="Nothing has been recorded on this yet." searchPlaceholder="Search activity" />
    </div>}
  </SchemaFormPanel>;
}
