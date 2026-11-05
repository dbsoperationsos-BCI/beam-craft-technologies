import { PLATE_MODES, takesTickets } from "../lib/productionPlan.mjs";

/*
 * The Production Manager's plan for one shoot. There is no Production Team to pick: the team is the
 * Production Coordinator and whoever works each service, both under People. **Travel Mode** and the
 * **Studio Start Date and Time** are marked required, on an outdoor shoot: a draft still saves
 * half-filled, and the server is what refuses a submit without a coordinator, a travel mode, the studio
 * start or a person on each service. Every section is one column (its `columns` is 1): the manager fills
 * this on a phone, and one column is what a phone shows anyway.
 *
 * Travel asks only the field its mode uses: a number plate for Own / Car, the vehicle for Office
 * Vehicle, a line for Other; Bus / Train / Flight a Ticket Status - Yet to Take, Taken (the tickets
 * then attached through the `tickets` renderer) or On the Fly. Changing the
 * mode hides the others, and the payload sends them as null, so the server clears them on save.
 * The Studio Start Date and Time - when the crew leaves the studio - close the section; they moved
 * here from Pre Production's form, and are mandatory on an outdoor shoot as Travel Mode is.
 */
export const productionPlanSections = [
  {
    id: "people",
    title: "People",
    columns: 1,
    fields: [
      // Mandatory on every shoot, indoor or out, and one of the three parts a plan is counted on
      // (`planCompleteness`) - so it carries the mark, as Travel Mode beside it does.
      { name: "productionCoordinatorEmployeeId", label: "Production Coordinator", type: "select", options: "employees", required: true, placeholder: "Select employee", helperText: "The employee who runs this shoot on the day; needed before the plan is submitted.", props: { searchable: true } },
      // Anybody the old sheet named who has since left the studio: shown, as written, and left alone.
      { name: "keptNames", type: "custom", colSpan: 2 },
      // The shoot's own services, as Edit Project booked them, each with who works it and its camera:
      // with the coordinator, they are the shoot's production team, so they sit here under People.
      { name: "crew", type: "custom", colSpan: 2 },
    ],
  },
  /*
   * Not asked of an indoor shoot at all.
   *
   * A Studio / In-House shoot happens where the crew already is: there is no journey to plan, no
   * plate, no ticket and no vehicle, which is why the mode was left unmarked there and why the
   * server submits such a plan without one. Leaving the section on screen asked the question
   * anyway - an empty Travel panel reads as something still to fill in. Pre Production drops it
   * from an indoor shoot's form the same way (`INDOOR_SKIPPED_SECTIONS`).
   */
  {
    id: "travel",
    title: "Travel",
    columns: 1,
    when: (values, context) => !context?.indoor,
    fields: [
      /*
       * Mandatory, beside the Production Coordinator and each service's person - the three parts a
       * plan is counted on, and the three the server asks for before it is submitted. The `required`
       * function stays a function: an indoor shoot never draws this section, and the check that
       * refuses a submit reads the schema flat, where the shoot's kind is all that answers for it.
       */
      { name: "travelMode", label: "Travel Mode", type: "select", options: "travelModes", placeholder: "Select travel mode", helperText: "How the crew reaches the venue; it decides which travel details are asked next.", required: (values, context) => !context?.indoor },
      { name: "vehicleNumberPlate", label: "Vehicle Number Plate", placeholder: "e.g. TN 33 AB 1234", helperText: "The number plate of the vehicle the crew travels in.", props: { maxLength: 20, autoCapitalize: "characters", autoComplete: "off", inputClassName: "uppercase" }, when: (values) => PLATE_MODES.includes(values.travelMode) },
      { name: "travelVehicleAssetId", label: "Office Vehicle", type: "select", options: "vehicles", placeholder: (values, context) => (context?.options?.vehicles?.length ? "Select vehicle" : "No vehicles in Asset Management"), helperText: "The studio vehicle the crew takes, from the vehicles in Asset Management.", props: { searchable: true }, when: (values) => values.travelMode === "Office Vehicle" },
      // Bus, Train and Flight: where the tickets stand. Taken opens the Tickets upload below.
      { name: "ticketStatus", label: "Ticket Status", type: "select", options: "ticketStatuses", placeholder: "Select ticket status", helperText: "Where the crew's tickets stand; Taken lets you attach the tickets below.", when: (values) => takesTickets(values.travelMode) },
      { name: "travelModeOther", label: "Travel Mode (Other)", placeholder: "Say how the crew travels", helperText: "How the crew is travelling, since it is not one of the listed modes.", props: { maxLength: 191 }, when: (values) => values.travelMode === "Other" },
      { name: "tickets", type: "custom", colSpan: 2 },
      // When the crew leaves the studio - the start of the journey, so it sits with the travel.
      // Mandatory on an outdoor shoot, as Travel Mode is, and counted in the plan's progress.
      { name: "studioStartDate", label: "Studio Start Date", type: "date", helperText: "The day the crew leaves the studio for the shoot.", required: (values, context) => !context?.indoor },
      { name: "studioStartTime", label: "Studio Start Time", type: "time", helperText: "The time the crew leaves the studio.", required: (values, context) => !context?.indoor },
    ],
  },
  { id: "remarks", title: "Remarks", columns: 1, fields: [{ name: "remarks", label: "Remarks", type: "textarea", colSpan: 2, placeholder: "Anything the crew should know", helperText: "Optional notes for the crew about this shoot's plan." }] },
];
