const prisma = require("../../../config/db");
const config = require("../shared/config");

/**
 * The Photo Selling overview, from the rows and nothing else - no figure here is estimated.
 *
 * - Gross sales: what buyers paid on PAID orders in the range, tax included.
 * - Net sales: gross less the tax in it. (Refunds are made in the Cashfree dashboard and are not
 *   recorded here, so net is before refunds - the screen says so.)
 * - Average order value: gross over paid orders.
 * - Conversion: paid orders over store visits, offered only once there are enough visits to mean
 *   something; a store visit is a store session opened.
 */
const RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null };
const MIN_VISITS_FOR_CONVERSION = 20;

async function overview({ range = "30d" } = {}) {
  const days = Object.prototype.hasOwnProperty.call(RANGES, range) ? RANGES[range] : 30;
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  const inRange = since ? { gte: since } : undefined;
  const now = new Date();
  // A failed attempt on an order a later attempt paid needs nobody's attention; a paid amount that
  // did not match the order always does.
  const needsLook = { OR: [{ status: "MISMATCH" }, { status: "FAILED", order: { status: { not: "PAID" } } }] };
  const liveGallery = { status: "PUBLISHED", archivedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

  const [liveGalleries, publishedPhotos, paid, failedPayments, undeliverable, searches, completedSearches, visits, recent, failedRecent] = await Promise.all([
    prisma.photoSaleGallery.count({ where: liveGallery }),
    prisma.photoSalePhoto.count({ where: { available: true, removedAt: null, originalKey: { not: null }, gallery: liveGallery } }),
    prisma.photoSaleOrder.aggregate({ where: { status: "PAID", ...(inRange ? { paidAt: inRange } : {}) }, _count: { _all: true }, _sum: { totalPaise: true, taxPaise: true } }),
    prisma.photoSalePayment.count({ where: { ...needsLook, ...(inRange ? { createdAt: inRange } : {}) } }),
    // Bought, but its original is gone - a buyer who cannot download what they paid for.
    prisma.photoSaleOrderItem.count({ where: { fulfilment: "UNAVAILABLE", order: { status: "PAID" } } }),
    prisma.photoSaleSelfieSearch.count({ where: inRange ? { createdAt: inRange } : {} }),
    prisma.photoSaleSelfieSearch.count({ where: { status: "COMPLETED", ...(inRange ? { createdAt: inRange } : {}) } }),
    prisma.photoSaleGallery.aggregate({ _sum: { visitCount: true } }),
    prisma.photoSaleOrder.findMany({ where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 8, include: { gallery: { select: { id: true, title: true } }, _count: { select: { items: true } } } }),
    prisma.photoSalePayment.findMany({ where: needsLook, orderBy: { createdAt: "desc" }, take: 5, include: { order: { select: { id: true, orderRef: true, buyerName: true, totalPaise: true, status: true } } } }),
  ]);

  const paidOrders = paid._count._all;
  const grossPaise = paid._sum.totalPaise || 0;
  const taxPaise = paid._sum.taxPaise || 0;
  const totalVisits = visits._sum.visitCount || 0;
  // All-time paid orders over all-time visits: visits are a running count, not dated.
  const allTimePaid = days ? await prisma.photoSaleOrder.count({ where: { status: "PAID" } }) : paidOrders;
  return {
    range: days ? range : "all",
    liveGalleries, publishedPhotos, paidOrders,
    grossPaise, netPaise: grossPaise - taxPaise, taxPaise,
    averageOrderPaise: paidOrders ? Math.round(grossPaise / paidOrders) : 0,
    searches, completedSearches,
    conversion: totalVisits >= MIN_VISITS_FOR_CONVERSION ? { rate: allTimePaid / totalVisits, paidOrders: allTimePaid, visits: totalVisits } : null,
    failedPayments, undeliverable,
    recentOrders: recent.map((order) => ({ id: order.id, orderRef: order.orderRef, buyerName: order.buyerName, totalPaise: order.totalPaise, currency: order.currency, paidAt: order.paidAt, itemCount: order._count.items, gallery: order.gallery })),
    recentFailures: failedRecent.map((payment) => ({ paymentId: payment.id, status: payment.status, failureReason: payment.failureReason, createdAt: payment.createdAt, order: payment.order })),
    server: config.status(),
  };
}

module.exports = { overview, RANGES, MIN_VISITS_FOR_CONVERSION };
