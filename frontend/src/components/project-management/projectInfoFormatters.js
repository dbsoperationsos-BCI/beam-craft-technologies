import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import { formatSessionTiming } from "./AddShootDialog";

/**
 * A project's shoots carry their own nested plans, so the info panel summarises them rather than
 * printing the raw array. These live with the project module: the shared info panel formats what
 * every module has (dates, yes/no, images) and takes anything shaped like this as a formatter.
 *
 * Each one receives the project's `shoots` array and returns the text for one field.
 */

function formatDate(value) {
  // `new Date(null)` is the epoch rather than an invalid date, so an unscheduled shoot would
  // otherwise read as 1 Jan 1970. Asked first, before anything tries to parse it.
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/** Every shoot on the project: when it was raised, where it is, and how long it runs. */
function shootList(shoots) {
  if (!shoots.length) return "No shoots added.";
  return `${shoots.length} shoot${shoots.length === 1 ? "" : "s"} added\n${shoots.map((shoot) => `Shoot ID: ${shoot.shootId || "—"} — ${formatDate(shoot.dateCreated)} — ${shoot.shoot} — ${shoot.shootPlace} — ${shoot.district}, ${shoot.state} — ${formatSessionTiming(shoot)}`).join("\n")}`;
}

/** The deliverables planned per shoot, counted first so the panel reads as a summary. */
function shootDeliverables(shoots) {
  const shootsWithPlans = shoots.filter((shoot) => Array.isArray(shoot.deliverables) && shoot.deliverables.length);
  if (!shootsWithPlans.length) return "No production plan added.";
  const totalDeliverables = shootsWithPlans.reduce((total, shoot) => total + shoot.deliverables.length, 0);
  return `${shootsWithPlans.length} shoot${shootsWithPlans.length === 1 ? "" : "s"} with production plan · ${totalDeliverables} deliverable${totalDeliverables === 1 ? "" : "s"}\n${shootsWithPlans.map((shoot) => `${shoot.shoot} · Shoot ID: ${shoot.shootId || "—"}: ${shoot.deliverables.map((item) => `${item.deliverableName} x${item.quantity}`).join(", ")}`).join("\n")}`;
}

/** The services allocated per shoot, in the same summary-then-detail shape as the deliverables. */
function shootServiceAllocations(shoots) {
  const shootsWithAllocations = shoots.filter((shoot) => Array.isArray(shoot.postProductionAllocations) && shoot.postProductionAllocations.length);
  if (!shootsWithAllocations.length) return "No post production allocation added.";
  const totalAllocations = shootsWithAllocations.reduce((total, shoot) => total + shoot.postProductionAllocations.length, 0);
  return `${shootsWithAllocations.length} shoot${shootsWithAllocations.length === 1 ? "" : "s"} with allocations · ${totalAllocations} service allocation${totalAllocations === 1 ? "" : "s"}\n${shootsWithAllocations.map((shoot) => `${shoot.shoot} · Shoot ID: ${shoot.shootId || "—"}: ${shoot.postProductionAllocations.map((item) => `${item.serviceName}${item.serviceDetails ? ` — ${item.serviceDetails}` : ""}`).join(", ")}`).join("\n")}`;
}

const withShootArray = (format) => (value) => format(Array.isArray(value) ? value : []);

const projectInfoFormatters = {
  /*
   * The vertical as the studio says it - **DD**, not the stored `WED`.
   *
   * The register's Vertical column reads it the same way. `WED` is Dum Dum's internal code and
   * belongs to one place only: the WhatsApp group name, which somebody types into WhatsApp and has
   * to go on reading "WED". Anywhere the vertical is a fact *about* the project it is DD.
   */
  vertical: (value) => verticalCode(value) || "—",
  shootList: withShootArray(shootList),
  shootDeliverables: withShootArray(shootDeliverables),
  shootServiceAllocations: withShootArray(shootServiceAllocations),
};

export default projectInfoFormatters;
