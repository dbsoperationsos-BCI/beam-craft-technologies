"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import EmployeeAvatar from "@/components/shared/EmployeeAvatar";
import ChevronIcon from "@/components/ui/ChevronIcon";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { ProductionStatusPill } from "@/components/project-management/production/ProductionProjectPanel";
import { shootProductionStatus, shootStatusLabel } from "@/lib/productionBoard.mjs";
import { edgeScrollSpeed } from "@/lib/dragEdgeScroll.mjs";
import { peopleOnOtherServices, scheduleTimeLabel, seatValue, shootColour } from "@/lib/productionSchedule.mjs";
import { formatDay } from "@/lib/productionSteps.mjs";
import FilterDateInput from "@/components/shared/FilterDateInput";
import FilterMultiSelect from "@/components/shared/FilterMultiSelect";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { VENDOR_STATUS_OPTIONS } from "@/lib/productionPlan.mjs";

/*
 * The studio's production schedule sheet, as the team kept it in Google Sheets: one row per shoot, a
 * project's shoots on continuous days together and those runs by date (`scheduleRows`) - Event ID and
 * the event on a run's first row only, then Shoot ID, the date and the shoot, read-only - and then
 * its production plan: a block per service booked on it, the service on the grey line and who works
 * it below, then the shoot's Assist. Each person sits in a picker's box with their face, uncoloured: a
 * service nobody is on reads "Not assigned", a vendor "EXT-name (business, city)" with where they stand under it -
 * Waiting or Confirmed, changed right there (a small menu, no pop-up) by whoever may change the plan.
 *
 * **Only the person under a service is edited here**, and only on a shoot whose plan the viewer may
 * change (`assign.canAssign`) - a picker in place of the name, saved as soon as it is chosen
 * (`assign.onAssign`). Everything else is read; the shoot's name opens its production panel.
 *
 * **A person is dragged from one service to another** - on the same shoot or another the viewer may
 * change - and the two swap (`assign.onSwap`); the service dropped on is outlined while the drag is
 * over it, and the pane scrolls when the drag is held at its edge. Whether the person is free at the
 * other shoot's time is the server's to answer. The picker stays the way to do it without a mouse.
 *
 * **Colour is a shoot's place in its run** (`ordinal`, from `scheduleRows`): every run's first
 * row - the one that names the project - takes the first colour, every second row the
 * next, and on, the same across projects; the number before the shoot's name says the same in words.
 * Each shoot keeps to one line, its text cut with "…" where it does not fit and read in full on hover.
 *
 * **It opens on today** (`focus`): the shoot `focus.id` names is scrolled to the top and outlined for a
 * moment - once each time `focus.at` changes, on the first load and on Today, never on a refresh.
 *
 * From `md` the rows are the sheet's - the shoot's columns at the left, the plan running right, the
 * pane scrolling both ways under a sticky header; below it each shoot is a card.
 *
 * `zoom` is how large it is drawn, in percent: Tailwind's own size variables scaled on the sheet -
 * `--spacing`, which every width, gap and padding is a multiple of, and the two text sizes it uses - so
 * the sheet is laid out afresh at the new size. Not CSS `zoom`: in a scrolling pane under a sticky
 * header Chrome leaves part of the pane blank while it scrolls.
 */
const zoomStyle = (zoom) => {
  const scale = Number(zoom) / 100 || 1;
  return { "--spacing": `${0.25 * scale}rem`, "--text-xs": `${0.75 * scale}rem`, "--text-sm": `${0.875 * scale}rem` };
};

// The shoot's own columns: label, value, and the width each keeps from `md` up. The project's two are
// written on the first row of each run of its shoots only (`firstOfRun`), as the sheet writes them.
// `units` is the default width, in the sheet's spacing units (`--spacing`), so a column keeps its size
// relative to the text as the sheet zooms - and so does one somebody has pulled wider.
const SHOOT_COLUMNS = [
  { id: "eventId", label: "Event ID", value: (shoot) => shoot.eventId, units: 36, project: true },
  { id: "event", label: "Event", value: (shoot) => shoot.clientName, units: 56, project: true },
  { id: "shootId", label: "Shoot ID", value: (shoot) => shoot.shootId, units: 40 },
  // The date with the shoot's time under it, or "No time" where none is set.
  { id: "date", label: "Date", value: (shoot) => formatDay(shoot.shootDate), detail: scheduleTimeLabel, units: 36 },
  // Optional (`extra`): hidden until ticked in Manage Columns, so the sheet opens as it always has.
  { id: "shootPlace", label: "Shoot Place", value: (shoot) => shoot.shootPlace, units: 40, extra: true },
  { id: "district", label: "District", value: (shoot) => shoot.district, units: 36, extra: true },
  { id: "state", label: "State", value: (shoot) => shoot.state, units: 36, extra: true },
  { id: "shootType", label: "Shoot Type", value: (shoot) => shoot.shootType, units: 40, extra: true },
  { id: "productionManager", label: "Production Manager", value: (shoot) => shoot.productionManager, units: 44, extra: true },
  { id: "productionCoordinator", label: "Production Coordinator", value: (shoot) => shoot.productionCoordinator, units: 44, extra: true },
];
/**
 * The columns Manage Columns offers: the shoot's own four, and the optional ones (`extra`), which
 * start hidden. The Shoot and its production plan are the sheet itself and always shown.
 */
export const SCHEDULE_COLUMNS = SHOOT_COLUMNS.map(({ id, label, extra = false }) => ({ id, label, extra }));
const SHOOT_UNITS = 64;
// How many shoots are drawn at a time, another page as the end of the sheet comes into view.
const PAGE = 60;
// How narrow and how wide a column may be pulled, in the same units.
const MIN_UNITS = 16;
const MAX_UNITS = 160;
// A column's width from md up: a phone's cards are not columns, so they take none.
const COLUMN_WIDTH = "md:w-[var(--col-w)] md:shrink-0";

/*
 * Freeze Columns: the first `count` of the shoot's shown columns, then the Shoot, held at the left
 * while the sheet scrolls sideways - from md up, where they are columns. Each frozen cell is placed
 * at the summed widths of the frozen ones before it, in the same spacing units, so it stays put as
 * the sheet zooms or a column is pulled wider. Answers `pin(id)`: the cell's extra style and classes,
 * or null for one that scrolls.
 */
function freezer(columns, shootUnits, count) {
  const at = new Map();
  let offset = 0;
  for (const column of [...columns, { id: "shoot", units: shootUnits }].slice(0, Math.max(0, Number(count) || 0))) {
    at.set(column.id, offset);
    offset += column.units;
  }
  return (id) => (at.has(id) ? { style: { left: `calc(var(--spacing) * ${at.get(id)})` }, className: "md:sticky md:z-[5]" } : null);
}
const widthStyle = (units) => ({ "--col-w": `calc(var(--spacing) * ${units})` });

// What a seat reads: nobody, or the person - a vendor already named by the server as the crew pickers
// list them ("EXT-name (business, city)").
const seatText = (service) => service.person || "";

/**
 * A seat as a picker's closed box - the person's face and name, the arrow where it opens - drawn
 * without the picker itself, which is mounted only once the box is clicked (`ServiceBlock`): one
 * picker per seat across the whole sheet is what made it crawl. `avatar` is `{ name, photoUrl, seed }`.
 */
// The vendor's tint shows through a toned box (`toned`), its outline in the tint's own ring colour.
const TONED_LINE = { borderColor: "var(--shoot-chip-ring)" };
// The name's line on a toned block: the tint's stronger shade, so the block reads as its status at a glance.
const TONED_HEADER = { borderColor: "var(--shoot-chip-ring)", backgroundColor: "var(--shoot-chip-ring)" };

/*
 * `chips` is for a seat holding a list rather than one person - Assist.
 *
 * Names run together on one line read as "Asha, Ravi, Div...", which answers nothing: the reader
 * has to open the shoot to find out who else is on it. As chips each name is whole, they sit on one
 * line at their own width, and the block they are in widens to hold them - however many there are,
 * and whether or not anybody is picking. One assistant or five, the box is the width of its
 * answer, which is also how the sheet says at a glance which shoots are carrying a crew.
 */
function SeatBox({ text, chips = null, avatar = null, chevron = false, toned = false }) {
  return <span style={toned ? TONED_LINE : undefined} className={`flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-left text-xs font-normal ${toned ? "bg-transparent text-inherit" : "border-slate-300 bg-white text-slate-700"}`}>
    {avatar && <EmployeeAvatar {...avatar} size="xs" decorative />}
    {chips
      ? <span className="flex flex-1 items-center gap-1">
        {chips.map((name) => <span key={name} className="whitespace-nowrap rounded bg-blue-50 px-1.5 py-0.5 font-medium text-slate-700">{name}</span>)}
      </span>
      : <span className={`min-w-0 flex-1 truncate ${text ? "" : "text-slate-500"}`}>{text || "Not assigned"}</span>}
    {chevron && <ChevronIcon direction="down" size={20} className={`-mr-1 shrink-0 ${toned ? "" : "text-slate-500"}`} />}
  </span>;
}

/**
 * One service's block: its name on the grey line, `children` below. `tone` (an EXT vendor's Waiting /
 * Confirmed tint) colours the whole block - the name's line and the lines round it too, not only the
 * part under the name. `drop` makes the whole block a
 * place to drop a person, and `target` outlines it while a drag is over it. The service's name is
 * never picked up - only the person is (`ServiceBlock`) - and is not selectable, so a drag across it
 * does not highlight it.
 *
 * `grow` is for the block at the end of the row - Assist - which holds a list rather than one seat.
 * A service block is one name wide and stays so, columns being easier to read down when they line
 * up; the last one has nothing to its right to push, so it widens to whatever its names need, up to
 * a ceiling, and the row scrolls past that.
 */
function Block({ name, children, drop = null, target = false, tone = "", grow = false }) {
  return <div
    style={tone && !target ? TONED_LINE : undefined}
    className={`flex min-w-0 flex-col border text-center text-xs md:shrink-0 ${grow ? "md:w-auto md:min-w-44 md:max-w-[32rem]" : "md:w-44"} ${tone} ${target ? "border-blue-500 ring-2 ring-blue-300" : tone ? "" : "border-slate-300"}`}
    {...(drop || {})}
  >
    {/* The service's name on the grey line - or, on a toned block, on the tint with its own line under it. */}
    <span style={tone ? TONED_HEADER : undefined} className={`flex min-w-0 items-center gap-1 border-b px-2 py-0.5 font-semibold select-none ${tone ? "" : "border-slate-300 bg-slate-100 text-slate-700"}`}>
      <span className="min-w-0 flex-1 truncate py-0.5" title={name}>{name}</span>
    </span>
    {children}
  </div>;
}

/*
 * An EXT vendor's service is tinted by their answer - amber while Waiting, green once Confirmed - so
 * a day still waiting on a vendor stands out across the sheet. An employee's, or an empty seat, stays
 * plain. The Shoot Board's hue classes, which carry their own dark-theme pair.
 */
const vendorTone = (service) => (!service.vendorId ? "" : service.vendorStatus === "CONFIRMED" ? "shoot-chip shoot-hue-emerald" : "shoot-chip shoot-hue-amber");

function ServiceBlock({ shoot, service, assign }) {
  const value = seatText(service);
  const tone = vendorTone(service);
  // The face: an employee's from the people list where it is loaded, else drawn from the name; a vendor has none.
  const avatar = service.employeeId
    ? assign?.avatarOf?.(seatValue(service)) || { name: service.person || "", photoUrl: null, seed: service.employeeId }
    : null;
  // Whether this seat's picker is open in place of its text.
  const [picking, setPicking] = useState(false);
  // Who is out on another shoot at this shoot's time - asked of the server as the picker opens
  // (`assign.busyFor`), never for every seat on the sheet; null until it answers.
  const [busy, setBusy] = useState(null);
  const shootRecordId = shoot.shootRecordId;
  const busyFor = assign?.busyFor;
  useEffect(() => {
    if (!picking || !busyFor) return undefined;
    let live = true;
    busyFor(shootRecordId).then((found) => { if (live) setBusy(found); });
    return () => { live = false; };
  }, [picking, busyFor, shootRecordId]);
  const waiting = service.vendorStatus === "WAITING" && <span className="mt-0.5 block">Waiting</span>;
  if (!assign || !service.definitionId) return <Block name={service.name} tone={tone}><div className="p-1" title={value || "Not assigned"}><SeatBox text={value} avatar={avatar} toned={Boolean(tone)} />{waiting}</div></Block>;
  const current = seatValue(service);
  const key = `${shoot.shootRecordId}:${service.definitionId}`;
  const here = { shootId: shoot.shootRecordId, serviceDefinitionId: service.definitionId, key };
  /*
   * Only the person is picked up - by their name - and only the person is what the pointer carries (`setDragImage`); any service the viewer may change takes the
   * drop. A drop is stopped here, so the pane's own catch-all (below) does not answer it as well.
   */
  const drag = current ? {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
      event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
      assign.onDragStart(here);
    },
    onDragEnd: () => assign.onDragEnd(),
  } : null;
  const drop = assign.dragging && assign.dragging.key !== key ? {
    onDragOver: (event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; assign.onDragOver(key); },
    onDragLeave: () => assign.onDragOver(null),
    onDrop: (event) => { event.preventDefault(); event.stopPropagation(); assign.onDrop(here); },
  } : null;
  // Today's shooters and vendors, and whoever is on the seat now even where they have since left them -
  // less anybody on another of this shoot's services (one person works one service of a shoot) and any
  // employee out on another shoot at this one's time, as the plan form leaves them out.
  // Worked out only once the picker is asked for - not for every seat on the sheet.
  let options = [];
  if (picking) {
    const elsewhere = peopleOnOtherServices(shoot, service.definitionId);
    const free = assign.people.filter((option) => option.value === current || (!elsewhere.has(option.value) && !busy?.has(option.value)));
    options = current && !free.some((option) => option.value === current)
      ? [{ value: current, label: service.person || current }, ...free]
      : free;
  }
  /*
   * A vendor's answer - Waiting or Confirmed - is changed on the line under them, where it is read: the
   * word itself opens a small menu of the two, and a choice is saved at once. No pop-up in between.
   */
  const status = service.vendorStatus === "CONFIRMED" ? "CONFIRMED" : "WAITING";
  const statusLabel = VENDOR_STATUS_OPTIONS.find((option) => option.value === status)?.label || "Waiting";
  const vendorStatus = service.vendorId && assign.onChangeVendorStatus
    ? <span className="mt-0.5 flex justify-center">
      <OptionsMenu
        ariaLabel={`${service.person || "Vendor"} on ${service.name}, ${shoot.shootId}: ${statusLabel}. Change`}
        triggerSize="xxs"
        triggerClassName="!w-auto gap-0.5 !px-1.5 !text-xs font-medium !text-inherit"
        triggerContent={<>{assign.saving === key ? "Saving..." : statusLabel}<ChevronIcon direction="down" size={14} /></>}
        menuClassName="w-32"
        items={VENDOR_STATUS_OPTIONS.map((option) => ({
          label: option.label,
          selected: option.value === status,
          onSelect: () => { if (option.value !== status) assign.onChangeVendorStatus(shoot, service, option.value); },
        }))}
      />
    </span>
    : waiting;
  return <Block name={service.name} drop={drop} target={assign.over === key} tone={tone}>
    <div className="p-1">
      <div className={`min-w-0 ${drag ? "cursor-grab active:cursor-grabbing" : ""}`} {...(drag || {})}>
        {/* The person as text until it is clicked, then the picker, open: one picker on the sheet at a
            time rather than one per service, which on thousands of shoots is what made it crawl. */}
        {picking
          ? <Dropdown
            hideLabel
            defaultOpen
            label={`${service.name} - ${shoot.shootId}`}
            value={current}
            onChange={(next) => { setPicking(false); if (next !== current) assign.onAssign(shoot, service, next); }}
            options={options}
            placeholder="Not assigned"
            // "Not assigned" is always offered - on a submitted plan too, which then reads Work in Progress.
            clearable
            clearLabel="Not assigned"
            disabled={assign.saving === key}
          />
          : <Button
            type="button"
            variant="plain"
            size="none"
            className="!block w-full"
            title={`${value || "Not assigned"} - click to change`}
            aria-label={`${service.name} on ${shoot.shootId}: ${value || "Not assigned"}. Change`}
            disabled={assign.saving === key}
            onClick={() => setPicking(true)}
          >
            <SeatBox text={assign.saving === key ? "Saving..." : value} avatar={avatar} chevron toned={Boolean(tone)} />
          </Button>}
      </div>
      {vendorStatus}
    </div>
  </Block>;
}

/*
 * The shoot's Assist - who assists on the whole shoot - always shown, "Not assigned" when nobody is.
 * Whoever may change the plan (`assign.canAssign`) picks it from a multi-select: the names as a box
 * until it is clicked, then the picker, open, with the shooters and vendors - less any employee out on
 * another shoot at this one's time, though whoever is already on it stays. What was ticked is saved
 * once, as the picker closes (`assign.onSaveAssist`). Never dragged: only a service's own person is.
 */
function AssistBlock({ shoot, assign }) {
  const names = shoot.assist || [];
  const text = names.join(", ");
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(null);
  const shootRecordId = shoot.shootRecordId;
  const busyFor = assign?.busyFor;
  useEffect(() => {
    if (!picking || !busyFor) return undefined;
    let live = true;
    busyFor(shootRecordId).then((found) => { if (live) setBusy(found); });
    return () => { live = false; };
  }, [picking, busyFor, shootRecordId]);
  const key = `${shootRecordId}:assist`;
  // Every name a chip, always - not past some count. The block is as wide as its names whatever
  // the reader is doing, so Assist does not change shape between reading it and filling it.
  const chips = names.length ? names : null;
  if (!assign) return <Block name="Assist" grow><div className="p-1" title={text || "Not assigned"}><SeatBox text={text} chips={chips} /></div></Block>;
  /*
   * Who is on it already, as `{ value, label }` - and the labels matter.
   *
   * `assign.people` is who may be put on a shoot *now*; somebody already on this one may not be on
   * that list any more, having left or moved out of the Technical department. Their chip then had
   * no option to read a name from and showed its own value, `emp:27068`. The server sends the name
   * with the id for exactly this, and anyone the list no longer offers is added back from it - so
   * the chip says who they are, and unticking them still takes them off.
   */
  const heldPeople = shoot.assistPeople || [];
  const held = heldPeople.map((person) => person.value);
  const offered = picking ? assign.people.filter((option) => chosen.includes(option.value) || held.includes(option.value) || !busy?.has(option.value)) : [];
  const options = picking
    ? [...offered, ...heldPeople.filter((person) => person.label && !offered.some((option) => option.value === person.value))]
    : [];
  const finish = () => {
    setPicking(false);
    const before = [...held].sort().join("|");
    if ([...chosen].sort().join("|") !== before) assign.onSaveAssist(shoot, chosen);
  };
  return <Block name="Assist" grow>
    <div className="p-1">
      {picking
        ? <MultiSelectField
          hideLabel
          defaultOpen
          searchable
          // The sheet's own rhythm, 36px, and as wide as the names in it: the chips stay on one
          // line at their own width and the block grows sideways to hold them, so five assistants
          // read as five names rather than as "emp:27068" and "EXT-Sathish ..." in a 176px slot.
          size="sm"
          fitChips
          /*
           * The list itself is one size whatever the field does - pinned, not merely floored. A
           * menu that grew with the box would be five names across an empty half-metre.
           */
          menuMinWidth={288}
          menuMaxWidth={288}
          label={`Assist - ${shoot.shootId}`}
          values={chosen}
          onChange={setChosen}
          onClose={finish}
          options={options}
          placeholder="Select assistants"
        />
        : <Button
          type="button"
          variant="plain"
          size="none"
          className="!block w-full"
          title={`${text || "Not assigned"} - click to change`}
          aria-label={`Assist on ${shoot.shootId}: ${text || "Not assigned"}. Change`}
          disabled={assign.saving === key}
          onClick={() => { setChosen(held); setPicking(true); }}
        >
          <SeatBox text={assign.saving === key ? "Saving..." : text} chips={assign.saving === key ? null : chips} chevron />
        </Button>}
    </div>
  </Block>;
}

function ShootRow({ shoot, columns, shootUnits, pin, onOpenShoot, assign, rowMenu }) {
  const menuItems = rowMenu ? rowMenu(shoot) : [];
  const ordinal = shoot.ordinal || 0;
  const colour = shootColour(ordinal);
  const services = shoot.services || [];
  const editable = assign?.canAssign(shoot) ? assign : null;
  // A heavier line where a project starts, as the sheet's blank row between projects does.
  return <li data-shoot={shoot.shootRecordId} className={`flex scroll-mt-2 flex-col gap-3 px-4 py-3 md:scroll-mt-20 md:w-full md:flex-row md:items-stretch md:gap-0 md:px-0 md:py-0 ${shoot.firstOfRun ? "border-t-2 border-slate-400 first:border-t-0" : "border-t border-slate-200"}`}>
    {/* The shoot's own columns: a label above each on a phone, the sheet's cells from md up. */}
    <dl className={`grid grid-cols-2 gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-sm md:flex md:shrink-0 md:gap-0 md:rounded-none md:px-0 md:py-0 ${colour.chip}`}>
      {columns.map((column) => (column.project && !shoot.firstOfRun
        // The project is named on its first row; the cell stays, empty, so the sheet's columns line up -
        // and on a phone, where nothing lines up, it is left out.
        ? <div key={column.label} aria-hidden="true" style={{ ...widthStyle(column.units), ...pin(column.id)?.style }} className={`hidden bg-white md:block md:border-r md:border-slate-200 ${COLUMN_WIDTH} ${pin(column.id)?.className || ""}`} />
        // A frozen cell takes the row's own tint, so what scrolls under it does not show through.
        : <div key={column.label} style={{ ...widthStyle(column.units), ...pin(column.id)?.style }} className={`min-w-0 md:border-r md:border-slate-200 md:px-3 md:py-2 ${COLUMN_WIDTH} ${pin(column.id) ? `${pin(column.id).className} ${colour.chip}` : ""}`}>
          <dt className="text-xs opacity-70 md:sr-only">{column.label}</dt>
          <dd className="truncate" title={column.value(shoot) || ""}>{column.value(shoot) || "—"}</dd>
          {column.detail && <dd className="truncate text-xs opacity-70" title={column.detail(shoot)}>{column.detail(shoot)}</dd>}
        </div>))}
      <div style={{ ...widthStyle(shootUnits), ...pin("shoot")?.style }} className={`col-span-2 min-w-0 md:border-r md:border-slate-200 md:px-3 md:py-2 ${COLUMN_WIDTH} ${pin("shoot") ? `${pin("shoot").className} ${colour.chip}` : ""}`}>
        <dt className="text-xs opacity-70 md:sr-only">Shoot</dt>
        {/* One line: the shoot's number in its project, its name - cut with "…" - and its status. */}
        <dd className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-semibold" aria-label={`Shoot ${ordinal + 1} of this run`}>{ordinal + 1}</span>
          <Button variant="plain" size="none" className="min-h-10 min-w-16 flex-1 !justify-start text-left !text-sm font-semibold hover:underline md:min-h-0" onClick={() => onOpenShoot(shoot.shootRecordId)}>
            <span className="truncate" title={shoot.shoot || "Shoot"}>{shoot.isMainEvent && <span aria-hidden="true">★ </span>}{shoot.isMainEvent && <span className="sr-only">Main event: </span>}{shoot.shoot || "Shoot"}</span>
          </Button>
          {/* A long status ("Shoot in progress") is cut, never the shoot's name. */}
          <span className="min-w-0 shrink overflow-hidden" title={shootStatusLabel(shoot)}><ProductionStatusPill status={shootProductionStatus(shoot)} label={shootStatusLabel(shoot)} /></span>
        </dd>
      </div>
    </dl>
    {/* The production plan: the services in the studio's order (the server's `inStudioOrder`, which
        reads Settings -> Project -> Services), then the shoot's Assist, which is always last. */}
    <div className="grid min-w-0 grid-cols-2 gap-1 md:flex md:flex-1 md:flex-nowrap md:items-start md:px-3 md:py-2">
      {services.length === 0 && <p className="text-xs text-slate-500 md:self-center md:px-2">No services booked on this shoot.</p>}
      {services.map((service, index) => <ServiceBlock key={`${service.definitionId || service.name}-${index}`} shoot={shoot} service={service} assign={editable} />)}
      {/* Always there, with or without anybody on it, so it can be filled from here. */}
      <AssistBlock shoot={shoot} assign={editable} />
    </div>
    {/* The shoot's own ⋮ at the row's end - Navigate to, as the tables' rows offer it - held in view
        while the sheet scrolls sideways, under the header's Table Options. */}
    {menuItems.length > 0 && <div className="flex justify-end md:sticky md:right-0 md:items-start md:bg-white md:px-1 md:py-1">
      <OptionsMenu ariaLabel={`Actions for ${shoot.shootId || shoot.shoot || "shoot"}`} items={menuItems} />
    </div>}
  </li>;
}

/*
 * While a person is carried, the whole pane accepts the drop - so letting go anywhere ends the drag at
 * once, rather than the browser sliding the carried name back to where it came from first, which read
 * as the release being slow - and the pane scrolls when the drag is held at its edge.
 */
function scrollAtEdge(event) {
  event.preventDefault();
  const pane = event.currentTarget;
  const rect = pane.getBoundingClientRect();
  const x = edgeScrollSpeed(rect, event.clientX, event.clientY, { axis: "x" });
  const y = edgeScrollSpeed(rect, event.clientX, event.clientY, { axis: "y" });
  if (x || y) pane.scrollBy(x, y);
}

// The outline on the shoot the schedule has just brought into view, taken off again after a moment.
const FOCUS_RING = ["ring-2", "ring-inset", "ring-blue-500"];

/**
 * The grip on a header cell's right edge, as the tables have: pulled, the column follows the pointer,
 * and the width is saved when it is let go. `scale` is the sheet's zoom, so a pixel dragged becomes
 * the right number of spacing units at any size.
 */
function ResizeGrip({ label, units, scale, onResize }) {
  const [dragging, setDragging] = useState(false);
  function start(event) {
    event.preventDefault();
    const startX = event.touches ? event.touches[0].clientX : event.clientX;
    const pxPerUnit = 4 * scale;
    let last = units;
    setDragging(true);
    const move = (moved) => {
      const x = moved.touches ? moved.touches[0].clientX : moved.clientX;
      last = Math.min(MAX_UNITS, Math.max(MIN_UNITS, Math.round(units + (x - startX) / pxPerUnit)));
      onResize(last, false);
    };
    const end = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
      onResize(last, true);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
  }
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={`Resize ${label}`}
    draggable={false}
    onMouseDown={start}
    onTouchStart={start}
    // 12px to grab, the thin line inside it showing where the edge is - as the tables have.
    className="group/resize absolute inset-y-0 right-0 z-20 flex w-3 cursor-col-resize touch-none select-none justify-end"
  ><span className={`h-full w-px transition-colors duration-150 ${dragging ? "bg-slate-500" : "bg-transparent group-hover/resize:bg-slate-300"}`} /></div>;
}

/**
 * `widths` is the viewer's own column widths, by id, over the defaults; `onResize(id, units, done)`
 * moves one while it is dragged and saves it when `done`. `menu` is the Table Options, drawn at the
 * end of the header row as the tables draw theirs. `rowMenu(shoot)` is each shoot's own ⋮ entries.
 */
/**
 * The quick filters, one box under each column as the app's tables have them - from md up in the
 * header, under its labels; on a phone a strip above the cards. `filters` is `{ values, options,
 * onChange(key, value) }` (`filterScheduleShoots`): the shoot columns pick from what the shoots hold,
 * Date takes a typed or picked day, and the Production plan's one box picks people, on a service or
 * the Assist.
 */
function FilterRow({ columns, shootUnits, pin, filters }) {
  // Each box names its column: on a phone there is no header above it to say which is which.
  const box = (key, label, placeholder = label) => (key === "date"
    ? <FilterDateInput ariaLabel={`Filter ${label}`} placeholder={placeholder} value={filters.values.date} onChange={(next) => filters.onChange("date", next)} />
    : <FilterMultiSelect ariaLabel={`Filter ${label}`} placeholder={placeholder} options={filters.options[key] || []} values={filters.values[key] || []} onChange={(next) => filters.onChange(key, next)} />);
  const cell = "min-w-0 md:border-r md:border-slate-200 md:px-1.5 md:py-1";
  return <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-white p-2 text-xs md:flex md:w-full md:gap-0 md:bg-slate-50 md:p-0">
    {columns.map((column) => <div key={column.id} style={{ ...widthStyle(column.units), ...pin(column.id)?.style }} className={`${cell} ${COLUMN_WIDTH} ${pin(column.id) ? `${pin(column.id).className} md:bg-slate-50` : ""}`}>{box(column.id, column.label)}</div>)}
    <div style={{ ...widthStyle(shootUnits), ...pin("shoot")?.style }} className={`${cell} ${COLUMN_WIDTH} ${pin("shoot") ? `${pin("shoot").className} md:bg-slate-50` : ""}`}>{box("shoot", "Shoot")}</div>
    <div className={`${cell} col-span-2 md:w-64 md:shrink-0 md:border-r-0`}>{box("person", "Production plan people", "People (service or Assist)")}</div>
  </div>;
}

export default function ProductionScheduleView({ shoots, zoom = "100", onOpenShoot, assign = null, focus = null, hiddenColumns = [], widths = {}, freezeCount = 0, onResize = null, menu = null, rowMenu = null, filters = null }) {
  const paneRef = useRef(null);
  // The shoot's own columns this viewer keeps (Manage Columns), at the widths they pulled them to.
  const columns = SHOOT_COLUMNS.filter((column) => !hiddenColumns.includes(column.id)).map((column) => ({ ...column, units: widths[column.id] || column.units }));
  const shootUnits = widths.shoot || SHOOT_UNITS;
  const pin = freezer(columns, shootUnits, freezeCount);
  const scale = Number(zoom) / 100 || 1;
  /*
   * Drawn a page at a time - `PAGE` shoots, and another page as the end comes into view - so thousands
   * of shoots open as fast as sixty. Only grows: a refresh after a change keeps the rows already drawn.
   */
  const [limit, setLimit] = useState(PAGE);
  const endRef = useRef(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end || limit >= shoots.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((current) => current + PAGE);
    }, { root: paneRef.current, rootMargin: "600px" });
    observer.observe(end);
    return () => observer.disconnect();
  }, [limit, shoots.length]);
  // "Today" may name a shoot further down than is drawn: draw down to it first.
  const focusIndex = focus?.id ? shoots.findIndex((shoot) => shoot.shootRecordId === focus.id) : -1;
  if (focusIndex >= limit) setLimit(focusIndex + PAGE);
  const drawn = shoots.slice(0, limit);
  const handled = useRef(0);
  useEffect(() => {
    if (!focus?.id || handled.current === focus.at) return undefined;
    const row = paneRef.current?.querySelector(`[data-shoot="${CSS.escape(focus.id)}"]`);
    if (!row) return undefined;
    handled.current = focus.at;
    row.scrollIntoView({ block: "start" });
    // Back to the sheet's left edge, where the shoot's own columns are.
    paneRef.current.scrollLeft = 0;
    row.classList.add(...FOCUS_RING);
    const timer = window.setTimeout(() => row.classList.remove(...FOCUS_RING), 1600);
    return () => { window.clearTimeout(timer); row.classList.remove(...FOCUS_RING); };
  }, [focus?.at, focus?.id]);
  /*
   * `relative`: the pane is the box its screen-reader-only labels are placed in. Without it they were
   * placed in the app shell's, outside this pane's clipping, and the lower rows' labels hung below
   * the window and scrolled the whole page.
   *
   * The sheet is as wide as its widest row (`w-max`, never narrower than the pane), and every row and
   * the header take that width, so each row's lines run the whole way across however few services it has.
   */
  return <div ref={paneRef} role="region" tabIndex={0} className="relative min-h-0 flex-1 overflow-auto" aria-label="Production schedule" onDragOver={assign?.dragging ? scrollAtEdge : undefined} onDrop={assign?.dragging ? (event) => { event.preventDefault(); assign.onDragEnd(); } : undefined}>
    <div className="md:w-max md:min-w-full" style={zoomStyle(zoom)}>
      {/* The sheet's header, from md up - a phone's cards label each value instead - with the quick
          filters under it, held in view as the sheet scrolls. */}
      <div className="z-10 md:sticky md:top-0">
      <div className="hidden w-full border-b border-slate-300 bg-slate-100 text-xs font-semibold text-slate-600 md:flex">
        {columns.map((column) => <span key={column.label} style={{ ...widthStyle(column.units), ...pin(column.id)?.style }} className={`relative truncate border-r border-slate-200 px-3 py-2 ${COLUMN_WIDTH} ${pin(column.id) ? `${pin(column.id).className} bg-slate-100` : ""}`}>
          {column.label}
          {onResize && <ResizeGrip label={column.label} units={column.units} scale={scale} onResize={(units, done) => onResize(column.id, units, done)} />}
        </span>)}
        <span style={{ ...widthStyle(shootUnits), ...pin("shoot")?.style }} className={`relative border-r border-slate-200 px-3 py-2 ${COLUMN_WIDTH} ${pin("shoot") ? `${pin("shoot").className} bg-slate-100` : ""}`}>
          Shoot
          {onResize && <ResizeGrip label="Shoot" units={shootUnits} scale={scale} onResize={(units, done) => onResize("shoot", units, done)} />}
        </span>
        <span className="flex-1 px-3 py-2">Production plan</span>
        {/* The Table Options at the row's end, held in view while the sheet scrolls sideways. */}
        {menu && <span className="sticky right-0 flex items-center bg-slate-100 px-1">{menu}</span>}
      </div>
      {filters && <FilterRow columns={columns} shootUnits={shootUnits} pin={pin} filters={filters} />}
      </div>
      {shoots.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No shoots match these filters.</p>}
      <ul>{drawn.map((shoot) => <ShootRow key={shoot.shootRecordId || shoot.id} shoot={shoot} columns={columns} shootUnits={shootUnits} pin={pin} onOpenShoot={onOpenShoot} assign={assign} rowMenu={rowMenu} />)}</ul>
      {limit < shoots.length && <p ref={endRef} className="px-4 py-3 text-center text-xs text-slate-500">Showing {limit} of {shoots.length} shoots - scroll for more.</p>}
    </div>
  </div>;
}
