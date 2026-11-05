"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import ShootBoardCard from "@/components/project-management/shoot-board/ShootBoardCard";
import ShootProjectCard from "@/components/project-management/shoot-board/ShootProjectCard";
import { shootRunOf, shootsByProject } from "@/lib/schedule";
import { PROJECT_COLOURS } from "@/lib/shootBoard.mjs";

/**
 * A month day's shoots, opened from its "Shoots · 6" chip, in the Shoot Board's own cards: first the
 * projects shooting that day, each with how many of its shoots fall on it; a project opens to those
 * shoots, each a `ShootBoardCard` in the project's colour; a shoot opens on Projects (`onOpenShoot`),
 * and its ⋮ carries `menuFor(card)`. Back returns from the shoots to
 * the projects.
 */
export default function CalendarShootsDialog({ entry, dateLabel, onOpenShoot, menuFor, onClose }) {
  const projects = shootsByProject(entry?.meta?.shoots || []).map((project, index) => ({ ...project, colour: PROJECT_COLOURS[index % PROJECT_COLOURS.length] }));
  const [projectKey, setProjectKey] = useState(projects.length === 1 ? projects[0].key : null);
  const project = projects.find((candidate) => candidate.key === projectKey) || null;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  // The calendar's entries as the cards read them, each kept beside the entry it opens.
  const cards = project ? shootRunOf(project.shoots).run.shoots.map((card, index) => ({ card, shoot: project.shoots[index] })) : [];

  return <Dialog
    title={project ? project.name : entry?.title}
    description={project ? [project.eventId, dateLabel, plural(project.shoots.length, "shoot")].filter(Boolean).join(" · ") : [dateLabel, plural(projects.length, "project")].filter(Boolean).join(" · ")}
    size="md"
    height="mid"
    onBack={project && projects.length > 1 ? () => setProjectKey(null) : undefined}
    backAriaLabel="Back to the projects"
    onClose={onClose}
    footer={<Button type="button" className="max-sm:w-full" onClick={onClose}>Close</Button>}
  >
    <div className="flex flex-col gap-2">
      {project
        ? cards.map(({ card, shoot }) => <ShootBoardCard key={card.id} shoot={card} colour={project.colour} onOpen={() => onOpenShoot(shoot)} menuItems={menuFor?.(card) || []} />)
        : projects.map((candidate) => <ShootProjectCard
          key={candidate.key}
          name={candidate.name}
          eventId={candidate.eventId}
          count={candidate.shoots.length}
          colour={candidate.colour}
          onOpen={() => setProjectKey(candidate.key)}
        />)}
    </div>
  </Dialog>;
}
