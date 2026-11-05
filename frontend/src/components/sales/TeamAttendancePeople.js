/**
 * The people behind a Team Attendance chip, as the calendar's pop-up lists them: each name with
 * their employee ID, branch and department, in the order the register reads them.
 *
 * A day is **one** chip now - "Attendance · 5" - rather than one per status, so this is where the
 * day is actually read: the names stand under the status they are counted as, Absent first and
 * then On leave, each heading saying how many. A day that holds only one status draws no heading;
 * the chip and the pop-up's own title have already said what it is.
 */
export default function TeamAttendancePeople({ people = [] }) {
  if (!people.length) return null;
  // The order the server sent them in, which is the order the statuses are counted in.
  const statuses = [...new Set(people.map((person) => person.status).filter(Boolean))];
  const groups = statuses.length > 1
    ? statuses.map((status) => ({ status, people: people.filter((person) => person.status === status) }))
    : [{ status: "", people }];
  return <div className="space-y-3">
    {groups.map((group) => <section key={group.status || "all"} className="space-y-1.5">
      {group.status && <h3 className="text-xs font-semibold text-slate-600">{group.status} · {group.people.length}</h3>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label={group.status ? `${group.status} employees` : "Employees"}>
        {group.people.map((person) => (
          <li key={person.employeeId} className="px-3 py-2">
            <p className="text-sm font-medium text-slate-900">{person.employeeName}</p>
            <p className="mt-0.5 text-xs text-slate-500">{[person.employeeCode, person.branchName, person.department].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
    </section>)}
  </div>;
}
