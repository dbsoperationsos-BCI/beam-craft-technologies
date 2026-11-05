"use client";

import { LINKED_MODULES_NOTE, PROJECT_MODULES } from "@/lib/stageDashboards.mjs";

/**
 * Linked Projects: the projects in the other Visual Curation modules this one is linked to - each
 * its own project, with its own ID - and so the only places its photos can be sent on to. Read only:
 * the links are changed by the form's Linked Modules above, and each linked project is managed in
 * its own module. An unlinked project is not listed (it is kept, in its own module). A module the
 * viewer may not open is not named at all (the server leaves it out of `linkedModules`).
 */
export default function ProjectModuleLinks({ project }) {
  const linked = project?.linkedModules || [];
  return (
    <section className="mt-8 w-full max-w-[410px]" aria-labelledby="linked-projects-heading">
      <h2 id="linked-projects-heading" className="text-sm font-semibold text-slate-900">Linked Projects</h2>
      <p className="mt-1 text-[11px] text-slate-500">{LINKED_MODULES_NOTE}</p>
      {project?.salesProjectId ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">This project comes from Project Management: its modules follow its Post Production Allocation.</p>
      ) : linked.length === 0 ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">No linked projects. Tick a module under Linked Modules to link one.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {linked.map((entry) => (
            <li key={entry.module} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-800">{entry.projectName}</span>
                <span className="block truncate text-[10px] text-slate-500">{entry.projectCode}</span>
              </span>
              <span className="shrink-0 text-[11px] font-medium text-slate-600">{PROJECT_MODULES[entry.module]?.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
