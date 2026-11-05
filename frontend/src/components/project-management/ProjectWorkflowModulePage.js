"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useStickyTab from "@/components/shared/useStickyTab";
import ProjectDataTable from "@/components/data-table/ProjectDataTable";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import useCompactView from "@/components/shared/useCompactView";
import { getSalesProjects } from "@/services/sales/projects.service";
// Which stage a project is in the hands of. Shared with the Meetings list, which now reads the
// same register through the same two questions - one rule, so the two can never disagree about
// whether a project is in pre-production.
import { inPostProduction, inPreProduction } from "@/lib/projectStages";

const tabs = ["All", "Yet to Start", "In Progress", "Completed"];
const inProgressStatuses = new Set([
  "Work in Progress - Pre & Production",
  "Work in Progress - Post Production",
]);

function belongsToStatusTab(project, tab) {
  const status = project.projectStatus || "Yet to Start";
  if (tab === "All") return true;
  if (tab === "Yet to Start") return status === "Yet to Start";
  if (tab === "In Progress") return inProgressStatuses.has(status);
  return status === "Delivered";
}

const moduleRules = {
  "pre-production": {
    title: "Pre Production",
    tableTitle: "Pre Production Projects",
    infoTitle: "Pre Production Project Details",
    fileName: "pre-production-projects",
    matches: inPreProduction,
  },
  "pre-production-dum-dum": {
    title: "Pre Production - Dum Dum",
    tableTitle: "Dum Dum Pre Production Projects",
    infoTitle: "Dum Dum Pre Production Project Details",
    fileName: "pre-production-dum-dum-projects",
    matches: (project) =>
      inPreProduction(project) &&
      ["DUM DUM", "WED"].includes(
        String(project.vertical || "").trim().toUpperCase(),
      ),
  },
  "pre-production-qua-qua": {
    title: "Pre Production - Qua Qua",
    tableTitle: "Qua Qua Pre Production Projects",
    infoTitle: "Qua Qua Pre Production Project Details",
    fileName: "pre-production-qua-qua-projects",
    matches: (project) =>
      inPreProduction(project) &&
      ["QUA QUA", "QQ"].includes(
        String(project.vertical || "").trim().toUpperCase(),
      ),
  },
  "pre-production-corp": {
    title: "Pre Production - Corp",
    tableTitle: "Corp Pre Production Projects",
    infoTitle: "Corp Pre Production Project Details",
    fileName: "pre-production-corp-projects",
    matches: (project) =>
      inPreProduction(project) &&
      String(project.vertical || "").trim().toUpperCase() === "CORP",
  },
  production: {
    title: "Production",
    tableTitle: "Production Projects",
    infoTitle: "Production Project Details",
    fileName: "production-projects",
    matches: (project) =>
      project.projectStatus === "Work in Progress - Pre & Production",
  },
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

  async function refresh() {
    clearNotice();
    if (await loadProjects({ notifyOnError: false })) showNotice(`${rule.title} projects refreshed.`);
    else showError("Unable to refresh projects.");
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader
        title={rule.title}
        tabs={tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
        tabValue={activeTab}
        onTabChange={setActiveTab}
        tabsAriaLabel={`${rule.title} project status filters`}
        actions={<IconButton onClick={() => void refresh()} label={`Refresh ${rule.title} projects`}>↻</IconButton>}
      />
      <FloatingNotice notice={notice} onClose={clearNotice} />
      <div className="min-h-0 flex-1">
        <ProjectDataTable
          key={activeTab}
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
          readOnly
          fillAvailableHeight
        />
      </div>
    </section>
  );
}
