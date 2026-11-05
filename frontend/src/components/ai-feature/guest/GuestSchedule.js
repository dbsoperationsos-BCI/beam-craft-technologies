import Schedule from "@mui/icons-material/Schedule";
import Place from "@mui/icons-material/Place";
import { formatEventDate, formatTime } from "@/lib/aiFeature.mjs";

/** The sub-events in order, each with its day, its hours and where it is. Nothing when there are none. */
export default function GuestSchedule({ schedule = [] }) {
  if (!schedule.length) return null;
  return <section aria-labelledby="guest-schedule" className="mx-auto w-full max-w-3xl px-4">
    <h2 id="guest-schedule" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Schedule</h2>
    <ol className="mt-3 space-y-3">
      {schedule.map((item) => {
        const day = formatEventDate(item.date);
        const start = formatTime(item.startTime); const end = formatTime(item.endTime);
        const hours = start && end ? `${start} – ${end}` : start || end;
        return <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <p className="text-base font-semibold text-slate-900">{item.name}</p>
            {day && <p className="text-sm text-slate-500">{day}</p>}
          </div>
          {(hours || item.location) && <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:gap-4">
            {hours && <span className="inline-flex items-center gap-1.5"><Schedule style={{ fontSize: 16 }} aria-hidden="true" className="text-slate-400" />{hours}</span>}
            {item.location && <span className="inline-flex items-center gap-1.5"><Place style={{ fontSize: 16 }} aria-hidden="true" className="text-slate-400" />{item.location}</span>}
          </div>}
          {item.description && <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>}
        </li>;
      })}
    </ol>
  </section>;
}
