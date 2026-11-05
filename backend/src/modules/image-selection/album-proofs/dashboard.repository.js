const prisma = require("../../../config/db");

/**
 * The Album Proofing dashboard's reads: every live album with the project it belongs to, its
 * latest frozen version and its latest client link, in one query; the corrections grouped by
 * album, source and state in a second; the newest activity stamp per album in a third; and the
 * period's events in a fourth. No page row, no correction row and no activity row is ever loaded
 * — an album of four hundred spreads costs the dashboard the same as one of four.
 *
 * The link select deliberately carries no short code, token or PIN, exactly as the publication
 * card's own select does not: the dashboard says a link exists and when it stops, never what it is.
 */
// An album the Projects page can show: live, under a project that is live and not archived — the
// same reach the projects rail has, so every row the dashboard counts is one a double click can open.
const liveAlbums = { deletedAt: null, project: { deletedAt: null, archivedAt: null } };

function createDashboardRepository(client = prisma) {
  return {
    readAlbums: () => client.albumProof.findMany({
      where: liveAlbums,
      select: {
        id: true, projectId: true, name: true, albumType: true, status: true, archivedAt: true, completedAt: true,
        createdAt: true, updatedAt: true, revisionLimit: true, revisionsUsed: true,
        project: { select: { id: true, projectName: true, clientName: true, salesProject: { select: { whatsappGroupName: true } } } },
        versions: { where: { status: "FROZEN" }, select: { versionNumber: true }, orderBy: [{ versionNumber: "desc" }], take: 1 },
        publications: { select: { id: true, revisionNumber: true, expiresAt: true, revokedAt: true, publishedAt: true, version: { select: { versionNumber: true } } }, orderBy: [{ publishedAt: "desc" }], take: 1 },
      },
    }),
    correctionCounts: () => client.albumProofCorrection.groupBy({ by: ["albumId", "source", "status"], where: { album: liveAlbums }, _count: { _all: true } }),
    latestActivityByAlbum: () => client.albumProofActivity.groupBy({ by: ["albumId"], where: { album: liveAlbums }, _max: { createdAt: true } }),

    /** What happened inside the range, read from the timeline the services already write. */
    async periodCounts({ from, to }) {
      const inRange = { gte: from, lt: to };
      const [albumsCreated, events] = await Promise.all([
        client.albumProof.count({ where: { ...liveAlbums, createdAt: inRange } }),
        client.albumProofActivity.groupBy({ by: ["event"], where: { album: liveAlbums, createdAt: inRange, event: { in: ["SENT_TO_QC", "PUBLISHED_TO_CLIENT", "ALBUM_COMPLETED"] } }, _count: { _all: true } }),
      ]);
      const count = (name) => events.find((row) => row.event === name)?._count._all || 0;
      return { albumsCreated, sentToQc: count("SENT_TO_QC"), sentToClient: count("PUBLISHED_TO_CLIENT"), completed: count("ALBUM_COMPLETED") };
    },
  };
}

module.exports = { createDashboardRepository, dashboardRepository: createDashboardRepository() };
