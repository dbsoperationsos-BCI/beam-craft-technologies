"use client";

import PreProductionSummaryGroup from "@/components/project-management/PreProductionSummaryGroup";
import { detailHelpFor } from "@/constants/detailHelp";
import { formatDay } from "@/lib/productionSteps.mjs";
import { shootTimeLabel } from "@/lib/shootBoard.mjs";

/**
 * The project and shoot as the studio already knows them, side by side at the top of the Plan tab -
 * as Pre Production shows them above its form. Read-only on purpose: each line is changed where it
 * is owned (Projects, and Pre Production for the venue), never here. `detail` is the shoot's
 * production detail.
 */
export default function ProductionContextSummary({ detail }) {
  const summary = detail.summary || {};
  const groups = [
    ["Project", [
      ["Event ID", detail.eventId, detailHelpFor("Project", "eventId")],
      ["Client Name", detail.clientName, detailHelpFor("Project", "clientName")],
      ["Client Number", summary.clientMainNumber, detailHelpFor("Project", "clientMainNumber")],
      ["Vertical", detail.vertical, detailHelpFor("Project", "product")],
      ["Main Event Date", formatDay(summary.mainEventDate), detailHelpFor("Project", "mainEventDate")],
      ["CRM", summary.crm, detailHelpFor("People", "crmName")],
      ["Project Manager", summary.projectManager, detailHelpFor("People", "projectManager")],
      ["Pre Production Coordinator", summary.preProductionCoordinator, detailHelpFor("People", "preProductionCoordinator")],
      ["Creative Manager", summary.creativeManager, detailHelpFor("People", "creativeManager")],
      ["Production Manager", detail.productionManager, detailHelpFor("People", "productionManager")],
    ]],
    ["Shoot", [
      ["Shoot ID", detail.shootId, detailHelpFor("Shoot", "shootId")],
      ["Shoot", detail.shoot, detailHelpFor("Shoot", "shoot")],
      ["Shoot Type", summary.shootType, detailHelpFor("Shoot", "shootType")],
      ["Shoot Date", formatDay(detail.shootDate), detailHelpFor("Shoot", "subEventDate")],
      ["Time", shootTimeLabel(detail), "The event's start and end time on the shoot day, filled in by Pre Production."],
      ["Session Timing", summary.sessionTiming, detailHelpFor("Shoot", "sessionTiming")],
      ["Shoot Place", detail.shootPlace, detailHelpFor("Shoot", "shootPlace")],
      ["District", detail.district, detailHelpFor("Shoot", "district")],
      ["State", summary.state, detailHelpFor("Shoot", "state")],
      ["Travel Paid By", summary.travelPaidBy, detailHelpFor("Shoot", "travelPaidBy")],
      ["Accommodation Paid By", summary.accommodationPaidBy, detailHelpFor("Shoot", "accommodationPaidBy")],
    ]],
    // Where the crew goes, as Pre Production found it: under each name for a shoot held at several places.
    ["Location", detail.locations?.length
      ? detail.locations.flatMap((venue) => [[`${venue.shoot} - Location Link`, venue.locationLink], [`${venue.shoot} - Location Address`, venue.locationAddress]])
      : [["Location Address", detail.location], ["Location Link", detail.locationLink]]],
  ];
  return <div className="grid gap-4 lg:grid-cols-2">
    {groups.map(([title, rows]) => <PreProductionSummaryGroup key={title} title={title} rows={rows} />)}
  </div>;
}
