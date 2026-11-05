"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import useLinkedProject from "@/components/shared/useLinkedProject";
import ProjectDataTable, { ProjectRecordPanel, useProjectRowActions } from "@/components/data-table/ProjectDataTable";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import useProjectMoney from "@/components/project-management/useProjectMoney";
import { moneyColumn, moneyFlag } from "@/lib/projectMoney.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { projectManagementInfoSections } from "@/constants/infoPanelConfig";
import { PROJECT_BOARD_CARD, projectBoardStatus, projectColumnAmount } from "@/lib/projectStatuses.mjs";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import useCompactView from "@/components/shared/useCompactView";
import { getSalesProjects } from "@/services/sales/projects.service";
// Which stage a project is in the hands of. Shared with the Meetings list, which reads the same
// register through the same questions. Pre Production has its own page (PreProductionPage).
import { inPostProduction } from "@/lib/projectStages";

const tabs = ["All", "Yet to Start", "In Progress", "Completed"];

/*
 * The Board's columns: the status tabs, in their order, then any other status a project here holds
 * (On Hold, Rejected), so no project is left out of the Board the way it is left to All on the tabs.
 * The board is read-only, as the table is - nothing on it changes a project.
 */
function boardColumns(projects) {
  const base = tabs.filter((tab) => tab !== "All");
  const others = [...new Set(projects.map(projectBoardStatus))].filter((status) => !base.includes(status));
  return [...base, ...others].map((status) => ({ value: status, label: status }));
}

function belongsToStatusTab(project, tab) {
  // An old status (Delivered, Work in Progress...) is under the tab that replaced it, as on Projects
  // and as on the Board beside it.
  return tab === "All" || projectBoardStatus(project) === tab;
}

/**
 * The workflow boards that list projects. Pre Production and Production are not among them any more:
 * their rows are shoots rather than projects, so each has its own screen (PreProductionPage,
 * production/ProductionPage).
 */
const moduleRules = {
  "post-production": {
    title: "Post Production",
    tableTitle: "Post Production Projects",
    infoTitle: "Post Production Project Details",
    fileName: "post-production-projects",
    matches: inPostProduction,
  },
};

export default function ProjectWorkflowModulePage({ moduleKey }) {
  const rule = moduleRules[moduleKey];
  const [projects, setProjects] = useState([]);
  const [activeTab, setActiveTab] = useStickyTab(`workflow-${moduleKey}`, "All", tabs);
  const [loading, setLoading] = useState(true);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadProjects = useCallback(async ({ notifyOnError = true } = {}) => {
    setLoading(true);
    try {
      const response = await getSalesProjects();
      setProjects(Array.isArray(response?.data) ? response.data : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) {
        showError(error.message || "Unable to load projects.");
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  const moduleProjects = useMemo(
    () => projects.filter(rule.matches),
    [projects, rule],
  );
  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((tab) => [
          tab,
          moduleProjects.filter((project) => belongsToStatusTab(project, tab))
            .length,
        ]),
      ),
    [moduleProjects],
  );
  const tabProjects = useMemo(
    () =>
      moduleProjects.filter((project) =>
        belongsToStatusTab(project, activeTab),
      ),
    [activeTab, moduleProjects],
  );

  /*
   * A "Navigate to" from another board names its project in the address. The board comes to All if the
   * project is not on the tab in front of the reader - otherwise the link lands on a list that does
   * not contain it - and the table then selects the row and scrolls to it.
   */
  const [linkedEventId, clearLinkedProject] = useLinkedProject({ tab: activeTab, onTab: setActiveTab });

  const [layout, setLayout] = useTableBoardLayout(`workflow-${moduleKey}`);
  const onBoard = layout === "board";
  // The projects' money under each column, and "Balance due ₹…" on a card whose client still owes - only for
  // somebody who may see a project's Payments tab (`useProjectMoney`), and only while the Board is open.
  const money = useProjectMoney(onBoard ? moduleProjects : null);
  const columns = useMemo(() => boardColumns(moduleProjects), [moduleProjects]);
  const [viewing, setViewing] = useState(null);
  // The tab the board's record opens on: Activity for the ⋮'s "View activity", else its details.
  const [viewingTab, setViewingTab] = useState(null);
  // The card's ⋮ is the row's ⋮ - read-only here, like the table below: View, its activity, the other boards.
  const projectActions = useProjectRowActions({
    board: moduleKey,
    onView: (project) => { setViewingTab(null); setViewing(project); },
    onViewActivity: (project) => { setViewingTab("activity"); setViewing(project); },
    onNotice: showNotice,
    readOnly: true,
  });
  // A "Jump to" from another board filters the table to its project, so it brings the table back.
  useEffect(() => {
    if (!linkedEventId || !onBoard) return undefined;
    const timer = window.setTimeout(() => setLayout("table"), 0);
    return () => window.clearTimeout(timer);
  }, [linkedEventId, onBoard, setLayout]);

  async function refresh() {
    clearNotice();
    if (await loadProjects({ notifyOnError: false })) showNotice(`${rule.title} projects refreshed.`);
    else showError("Unable to refresh projects.");
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title={rule.title}
        // The Board stands every project under its status, so the status tabs step aside while it shows.
        tabs={onBoard ? undefined : tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
        tabValue={activeTab}
        onTabChange={setActiveTab}
        tabsAriaLabel={`${rule.title} project status filters`}
        actions={<>
          <TableBoardSwitch value={layout} onChange={setLayout} />
          <IconButton onClick={() => void refresh()} label={`Refresh ${rule.title} projects`}>↻</IconButton>
        </>}
      />
      <FloatingNotice notice={notice} onClose={clearNotice} />
      {onBoard ? <KanbanBoard
        rows={moduleProjects}
        columns={columns}
        statusOf={projectBoardStatus}
        card={PROJECT_BOARD_CARD}
        columnAmount={money ? (rows) => moneyColumn(rows, money) : projectColumnAmount}
        cardFlag={money ? (row) => moneyFlag(row, money) : undefined}
        onOpen={setViewing}
        cardActions={projectActions}
        viewOnly="A project's status is changed on the Projects page."
        loading={loading}
        noun="projects"
        ariaLabel={`${rule.title} board`}
      /> : <div className="min-h-0 flex-1">
        <ProjectDataTable
          key={activeTab}
          // Which board this is, so a row's ⋮ offers the other three rather than this one.
          board={moduleKey}
          // A "Navigate to" from another board: the table is filtered to the project, nothing opened.
          revealEventId={linkedEventId}
          onRevealed={clearLinkedProject}
          projects={tabProjects}
          density={density}
          loading={loading}
          lastUpdated={lastUpdated}
          title={rule.tableTitle}
          fileName={rule.fileName}
          emptyMessage="No projects found."
          noMatchMessage="No projects found."
          loadingMessage={`Loading ${rule.title.toLocaleLowerCase()} projects...`}
          onNotice={showNotice}
          infoPanelTitle={rule.infoTitle}
          projectManagement
          showActivity
          readOnly
          fillAvailableHeight
        />
      </div>}
      {/* The record a double-click on a row opens, the same panel with the same sections. */}
      {onBoard && <ProjectRecordPanel project={viewing} initialTab={viewingTab} sections={projectManagementInfoSections} projectManagement showActivity onClose={() => { setViewing(null); setViewingTab(null); }} />}
    </section>
  );
}
