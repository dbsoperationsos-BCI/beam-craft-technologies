"use client";

import GroupsOutlined from "@mui/icons-material/GroupsOutlined";
import PersonOutlineRounded from "@mui/icons-material/PersonOutlineRounded";
import PhotoCameraOutlined from "@mui/icons-material/PhotoCameraOutlined";
import PlaceOutlined from "@mui/icons-material/PlaceOutlined";
import ScheduleRounded from "@mui/icons-material/ScheduleRounded";
import Button from "@/components/shared/Button";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import ProductionPendingPill from "@/components/project-management/production/ProductionPendingPill";
import { shootTimeLabel } from "@/lib/shootBoard.mjs";

// `wrap` lets a long line - a team of names - run on rather than be cut off.
function Meta({ icon: Icon, children, wrap = false }) {
  return <span className={`flex min-w-0 gap-1.5 text-xs text-slate-600 ${wrap ? "items-start" : "items-center"}`}>
    <Icon aria-hidden="true" style={{ fontSize: 15 }} className={`shrink-0 text-slate-400 ${wrap ? "mt-px" : ""}`} />
    <span className={wrap ? "min-w-0 break-words" : "truncate"}>{children}</span>
  </span>;
}

/**
 * One shoot on the board. Its project's colour is the bar down the left and the chip naming the
 * project, so a project's run of shoots reads as one across the days; the card itself stays white so
 * the text reads the same on every colour.
 *
 * `onOpen` is given only where the shoot can be opened - it has a production record and the viewer
 * holds `PROJECT / Production` - so a card nobody may open is not a button at all.
 *
 * `menuItems` puts a ⋮ in the card's top corner - beside the card rather than inside it, since a
 * button cannot hold another - and is left out where there is nothing to offer.
 */
export default function ShootBoardCard({ shoot, colour, onOpen, menuItems = [] }) {
  const time = shootTimeLabel(shoot);
  const project = shoot.clientName || shoot.eventId;
  const body = <>
    <span aria-hidden="true" className={`w-1.5 shrink-0 ${colour?.bar || "bg-slate-300"}`} />
    <span className="flex min-w-0 flex-1 flex-col gap-2 p-3 text-left">
      <span className={`flex items-start justify-between gap-2 ${menuItems.length ? "pr-7" : ""}`}>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-5 text-slate-900">{shoot.shoot}</span>
          {(shoot.shootId || shoot.isMainEvent) && <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
            <span className="truncate">{shoot.shootId}</span>
            {shoot.isMainEvent && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-700"><span aria-hidden="true">★</span>Main Event</span>}
          </span>}
        </span>
        {shoot.pending && <span className="shrink-0"><ProductionPendingPill label={shoot.pending} /></span>}
      </span>
      {project && <span className={`inline-flex max-w-full self-start truncate rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${colour?.chip || "bg-slate-100 text-slate-700 ring-slate-200"}`}>{project}</span>}
      <span className="flex flex-col gap-1">
        {time && <Meta icon={ScheduleRounded}>{time}</Meta>}
        {shoot.shootPlace && <Meta icon={PlaceOutlined}>{shoot.shootPlace}</Meta>}
        {shoot.coordinator && <Meta icon={PersonOutlineRounded}>{shoot.coordinator}</Meta>}
        {/* Who is on the shoot: the Production Team, then each service with its person and assistants. */}
        {shoot.team?.length > 0 && <Meta wrap icon={GroupsOutlined}>{shoot.team.join(", ")}</Meta>}
        {(shoot.crew || []).map((entry) => <Meta wrap key={entry.service} icon={PhotoCameraOutlined}>
          {entry.service}: {[entry.person, ...entry.assistants].filter(Boolean).join(", ")}
        </Meta>)}
      </span>
    </span>
  </>;
  // `shoot-card` is its outline in each appearance (globals.css): a light grey ring was drawn bright
  // white on the dark tiers.
  const frame = "shoot-card flex w-full min-w-0 overflow-hidden rounded-xl bg-white shadow-sm";

  const card = !onOpen ? <div className={frame}>{body}</div> : <Button
    type="button"
    variant="plain"
    size="none"
    onClick={() => onOpen(shoot)}
    aria-label={`Open ${shoot.shoot} — ${project}`}
    className={`${frame} !items-stretch !justify-start transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500`}
  >
    {body}
  </Button>;
  if (!menuItems.length) return card;
  return <div className="relative">
    {card}
    <div className="absolute right-1.5 top-1.5">
      {/* Over the dialog the card sits in - the shoot window, the day's pop-up - not behind it. */}
      <OptionsMenu ariaLabel={`Actions for ${shoot.shootId || shoot.shoot || "shoot"}`} items={menuItems} menuZIndexClassName={layers.menuOverPanel} />
    </div>
  </div>;
}
