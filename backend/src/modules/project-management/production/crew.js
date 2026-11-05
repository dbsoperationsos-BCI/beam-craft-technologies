/**
 * Who works each service of a shoot (`ProjectProductionServiceCrew`).
 *
 * Every service has its own person - an employee, or an external vendor - who takes a camera. A
 * candid service (its name contains "Candid", so Candid Photo, Candid Video and Semi Candid Video
 * alike) also has two assistants, employees or vendors too, who take no camera. Pure: no database, so the rules read the same in the plan and in its tests.
 */
const LEAD = "LEAD";
const ASSISTANT_1 = "ASSISTANT_1";
const ASSISTANT_2 = "ASSISTANT_2";
const CREW_ROLES = [LEAD, ASSISTANT_1, ASSISTANT_2];
const CREW_ROLE_LABELS = { [LEAD]: "Person", [ASSISTANT_1]: "Assistant 1", [ASSISTANT_2]: "Assistant 2" };

const isCandid = (serviceName) => /candid/i.test(String(serviceName || ""));
// A drone service - any service with "drone" in its name - may be flown by somebody who also works
// another service of the shoot: it is not held to one employee, one service (`doubledPerson`).
const isDrone = (serviceName) => /drone/i.test(String(serviceName || ""));

/*
 * Who may work a service's camera: an employee in the **Technical** department, as their employee
 * record names it. Vendors are external shooters and are not asked.
 *
 * It was a list of shooting skills - Candid Photographer, Drone, Outdoor Shoot and six more, matched
 * against Settings → Skills. Which meant somebody the studio sends on shoots could not be put on one
 * until a skill was ticked on their profile, and the list of skills had to be kept in step with the
 * services the studio sells. The department is the answer the studio already maintains: the people
 * who shoot are Technical, and that is one field on one screen rather than nine names in the code.
 *
 * Matched case- and spacing-insensitively but **exactly**, so "Non Technical" - a department of its
 * own - is not read as Technical because the word is inside it.
 */
const SHOOTER_DEPARTMENT = "Technical";
const departmentKey = (name) => String(name || "").toLowerCase().replace(/[^a-z]/g, "");
const SHOOTER_DEPARTMENT_KEY = departmentKey(SHOOTER_DEPARTMENT);
/** Whether any of these department names is the shooting department. */
const isShooter = (departmentNames = []) => departmentNames.some((name) => departmentKey(name) === SHOOTER_DEPARTMENT_KEY);
/*
 * A service's seat on the plan: its own person. Assistants are the shoot's, not a service's - the plan's
 * one Assist field, kept as the shoot's Production Team (`plan.saveTeam`) - so a service takes none.
 * ASSISTANT_1 / ASSISTANT_2 rows written before stay readable, and move to Assist when the plan is next
 * saved with it.
 */
const rolesFor = () => [LEAD];

/**
 * Why this crew list cannot be saved against the shoot's services, or null. `services` maps a
 * service definition id to its name.
 */
/*
 * Where a **vendor** on a service stands. A vendor is asked to hold the day and says so, which is not
 * something a camera answers: WAITING until they confirm, CONFIRMED once they have. It is the
 * service's own person answering - an employee in that seat is asked for a camera instead, and an
 * assistant has neither.
 */
const VENDOR_STATUSES = ["WAITING", "CONFIRMED"];
const VENDOR_CONFIRMED = "CONFIRMED";
const VENDOR_STATUS_LABELS = { WAITING: "Waiting", CONFIRMED: "Confirmed" };

function crewRefusal(crew, services) {
  for (const entry of crew) {
    const name = services.get(entry.serviceDefinitionId);
    if (!name) return "Assign people only to this shoot's services.";
    if (!rolesFor(name).includes(entry.role)) return `${name} takes its own person only. Assistants are chosen once for the whole shoot, under Assist.`;
    if (entry.cameraAssetIds?.length && entry.role !== LEAD) return "Only the service's own person takes a camera.";
    // A vendor brings their own kit; the studio's cameras go to an employee in that seat.
    if (entry.cameraAssetIds?.length && entry.vendorId) return "A vendor on a service takes no camera.";
    if (new Set(entry.cameraAssetIds || []).size !== (entry.cameraAssetIds || []).length) return "Give each camera once to a service.";
    if (entry.employeeId && entry.vendorId) return "Give each role one person: an employee or a vendor, not both.";
    if (entry.vendorStatus && !VENDOR_STATUSES.includes(entry.vendorStatus)) return "A vendor on a service is Waiting or Confirmed.";
    // The status is the service's own person answering, so nobody else carries one: not an employee,
    // and not an assistant - an assistant has no camera to replace and nothing to confirm.
    if (entry.vendorStatus && !entry.vendorId) return "Only a vendor on a service has a Waiting or Confirmed status.";
    if (entry.vendorStatus && entry.role !== LEAD) return "Only the service's own person has a Waiting or Confirmed status.";
  }
  const seen = new Set();
  const cameras = new Set();
  for (const entry of crew) {
    const key = `${entry.serviceDefinitionId}:${entry.role}`;
    if (seen.has(key)) return "Each role of a service can be given once.";
    seen.add(key);
    // A camera goes to one service of a shoot - all of a seat's cameras do; they can still go to
    // other shoots.
    for (const cameraAssetId of entry.cameraAssetIds || []) {
      if (cameras.has(cameraAssetId)) return "A camera can be given to only one service of this shoot.";
      cameras.add(cameraAssetId);
    }
  }
  return null;
}

/** The first service still without its own person, by name, or null when every one has one. */
function missingLead(crew, services) {
  for (const [definitionId, name] of services) {
    if (!crew.some((entry) => entry.serviceDefinitionId === definitionId && entry.role === LEAD && (entry.employeeId || entry.vendorId))) return name;
  }
  return null;
}

/**
 * One employee works one service of a shoot: the employee (`emp:<id>`) a save puts on more of its
 * services than the plan already had them on, or null. A vendor is not held to it - an external
 * studio may send people for several services of one shoot. Counted against `held` - the seats as saved -
 * so a shoot that already had somebody on two services before the rule is not refused for it on every
 * later save; only a save that adds to it is. Assistants are not counted: they are the shoot's Assist.
 * Nor are drone services (`isDrone`, by `services` - definition id to name): the drone may be flown
 * by somebody already on another service, or by another of the team.
 */
function doubledPerson(crew, held = [], services = new Map()) {
  const count = (rows) => {
    const seats = new Map();
    for (const row of rows) {
      if (row.role !== LEAD || isDrone(services.get(row.serviceDefinitionId))) continue;
      const person = row.employeeId ? `emp:${row.employeeId}` : null;
      if (person) seats.set(person, (seats.get(person) || 0) + 1);
    }
    return seats;
  };
  const before = count(held);
  for (const [person, seats] of count(crew)) if (seats > 1 && seats > (before.get(person) || 0)) return person;
  return null;
}

module.exports = { doubledPerson, LEAD, ASSISTANT_1, ASSISTANT_2, CREW_ROLES, CREW_ROLE_LABELS, SHOOTER_DEPARTMENT, VENDOR_STATUSES, VENDOR_CONFIRMED, VENDOR_STATUS_LABELS, isShooter, isCandid, isDrone, rolesFor, crewRefusal, missingLead };
