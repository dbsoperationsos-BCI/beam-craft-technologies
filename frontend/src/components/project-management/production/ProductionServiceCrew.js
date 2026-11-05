"use client";

import PendingField from "@/components/shared/PendingField";
import CallOutlinedIcon from "@mui/icons-material/CallOutlined";
import Dropdown from "@/components/shared/Dropdown";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { CREW_ROLE_LABELS, VENDOR_STATUS_OPTIONS, isDroneService, isVendorPerson } from "@/lib/productionPlan.mjs";

/**
 * The plan's Services section: each service booked on the shoot (Edit Project's), with who works
 * it. A person is an employee or a vendor (listed after the employees, as "EXT-name (business, city)"). The
 * service's own person is asked for the cameras they carry, or, where they are a vendor, for where
 * the vendor stands. Assistants are the shoot's, not a service's - chosen once, under Assist below the
 * services (`ProductionShootPanel`). `crew` is the form's rows (`productionPlanForm`); a change replaces
 * the one row it touches.
 *
 * The person and assistant lists offer only who can shoot: employees in the **Technical** department
 * (`shooter`, the server's `crew.isShooter`) and the vendors, who are external shooters. An employee
 * already on another shoot's crew at an overlapping time (`busyEmployeeIds`, the server's
 * `availability.js`: by time, never by day) is left out as well, and so is a camera out on one
 * (`busyCameraAssetIds`) - a camera is one object and cannot be on two shoots at once. Whatever is
 * already chosen stays, so a saved plan never silently loses anybody or anything.
 *
 * `errors` is keyed by service definition: a service whose person is still blank says so under it.
 */
/**
 * How to reach the vendor on a service, under the two fields: who to ask for and a number that
 * dials. The coordinator rings a vendor more often than they do anything else on this form, and the
 * number was only on the vendor's own record in Asset Management. Nothing is drawn for an employee,
 * for a vendor with no number on their record, or for one since retired - whose option is a name
 * only (`productionPlan.mjs` keeps them listed so the seat still reads).
 */
function VendorContact({ option }) {
  if (!option?.phone && !option?.contactPerson) return null;
  return <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 md:col-span-2">
    <CallOutlinedIcon aria-hidden="true" sx={{ fontSize: 14 }} className="shrink-0 text-slate-400" />
    {option.contactPerson && <span className="min-w-0 break-words">{option.contactPerson}</span>}
    {option.phone && <a href={`tel:${option.phone.replace(/[^+\d]/g, "")}`} className="font-medium text-blue-600 hover:text-blue-700">{option.phone}</a>}
  </p>;
}

export default function ProductionServiceCrew({ services = [], crew = [], onChange, people = [], busyEmployeeIds = [], cameras = [], busyCameraAssetIds = [], readOnly = false, errors = {} }) {
  const rowFor = (definitionId, role) => crew.find((row) => row.definitionId === definitionId && row.role === role);
  const vendorOn = (row) => (isVendorPerson(row?.person) ? people.find((option) => option.value === row.person) : null);
  const busy = new Set((busyEmployeeIds || []).map((id) => `emp:${id}`));
  const shoots = (option) => String(option.value).startsWith("ven:") || option.shooter;
  /*
   * One employee works one service of a shoot: an employee already chosen for another of its services
   * is left out of this one's list (the server holds the same rule, `crew.doubledPerson`). A vendor is
   * not - an external studio may cover several services of one shoot - and neither is a drone service:
   * its list keeps everybody, and flying the drone leaves nobody out of another service.
   */
  const drones = new Set(services.filter((service) => isDroneService(service.name)).map((service) => service.definitionId));
  const peopleFor = (chosen, definitionId) => {
    const elsewhere = drones.has(definitionId) ? new Set() : new Set(crew.filter((row) => row.definitionId !== definitionId && !drones.has(row.definitionId) && row.role === "LEAD" && row.person && !isVendorPerson(row.person)).map((row) => row.person));
    return people.filter((option) => option.value === chosen || (shoots(option) && !busy.has(option.value) && !elsewhere.has(option.value)));
  };
  /*
   * The cameras this service may be given: every one in Asset Management's Cameras, less any already
   * on **another** service of this shoot - a camera is in one place at a time, though other shoots
   * may use it. A seat may take several.
   */
  const camerasFor = (definitionId) => {
    // A seat whose person is now a vendor sends no cameras, so the ones it still holds are nobody's.
    const taken = new Set(crew.filter((row) => row.definitionId !== definitionId && !isVendorPerson(row.person)).flatMap((row) => row.cameraAssetIds || []));
    const elsewhere = new Set((busyCameraAssetIds || []).map((id) => String(id)));
    const chosen = new Set(rowFor(definitionId, "LEAD")?.cameraAssetIds || []);
    return cameras.filter((option) => chosen.has(option.value) || (!taken.has(option.value) && !elsewhere.has(option.value)));
  };
  const set = (definitionId, role, patch) => onChange(crew.map((row) => (row.definitionId === definitionId && row.role === role ? { ...row, ...patch } : row)));

  if (services.length === 0) {
    return <p className="text-sm text-slate-500">No services are booked on this shoot. They are added in Edit Project.</p>;
  }

  return <div className="flex flex-col gap-3">
    {services.map((service) => <section key={service.id} className="rounded-lg border border-slate-200 p-3 sm:p-4">
      <h4 className="text-sm font-semibold text-slate-900">{service.name}</h4>
      {service.details && <p className="mt-0.5 text-xs text-slate-500">{service.details}</p>}
      {!service.definitionId
        ? <p className="mt-2 text-xs text-slate-500">This service is not in Settings → Project → Services, so nobody can be assigned to it here.</p>
        : <div className="mt-3 flex flex-col gap-3">
          {(service.roles || ["LEAD"]).map((role) => {
            const row = rowFor(service.definitionId, role) || {};
            return <div key={role} className={`grid gap-3 ${role === "LEAD" ? "md:grid-cols-2" : ""}`}>
              {/* The service's own person is counted for Planned: Pending until somebody is on it. */}
              <PendingField pending={role === "LEAD" && !row.person}><Dropdown
                label={CREW_ROLE_LABELS[role]}
                required={role === "LEAD"}
                helperText={role === "LEAD" ? "The employee or vendor who works this service on the shoot." : "An optional assistant for this service."}
                error={role === "LEAD" ? errors[service.definitionId] : ""}
                value={row.person || ""}
                onChange={(value) => set(service.definitionId, role, { person: value })}
                options={peopleFor(row.person, service.definitionId)}
                placeholder={role === "LEAD" ? "Select person" : "Select assistant (optional)"}
                searchable
                sorted={false}
                clearable={role !== "LEAD"}
                readOnly={readOnly}
              /></PendingField>
              {/* A vendor is asked where they stand - they hold the day, they do not bring the
                  studio's camera - and an employee is asked for the camera, as before. The service is
                  not planned while its vendor is Waiting. */}
              {role === "LEAD" && (isVendorPerson(row.person)
                // Counted too: a vendor still Waiting has not held the day, so the service is Pending.
                ? <PendingField pending={(row.vendorStatus || "WAITING") !== "CONFIRMED"}><Dropdown
                  label="Status"
                  required
                  helperText="Whether the vendor has confirmed the day; Waiting keeps the service unplanned."
                  value={row.vendorStatus || "WAITING"}
                  onChange={(value) => set(service.definitionId, role, { vendorStatus: value })}
                  options={VENDOR_STATUS_OPTIONS}
                  placeholder="Select status"
                  searchable={false}
                  sorted={false}
                  readOnly={readOnly}
                /></PendingField>
                : <MultiSelectField
                  label="Cameras"
                  helperText="Studio cameras from Asset Management this person takes to the shoot."
                  values={row.cameraAssetIds || []}
                  onChange={(next) => set(service.definitionId, role, { cameraAssetIds: next })}
                  options={camerasFor(service.definitionId)}
                  placeholder={cameras.length ? "Select cameras (optional)" : "No cameras in Asset Management"}
                  searchable
                  readOnly={readOnly}
                />)}
              {/* Across both columns, under the pair, so it reads as the row's own footnote. */}
              <VendorContact option={vendorOn(row)} />
            </div>;
          })}
        </div>}
    </section>)}
  </div>;
}
