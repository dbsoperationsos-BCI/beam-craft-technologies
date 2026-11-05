const prisma = require("../../../config/db");

/**
 * What the CRM's Quotation Calculator can quote for, and what is already booked on a date.
 *
 * Services and deliverables are read from the project master data Settings → Project maintains -
 * a service's pricing lines, a deliverable's words and price - so the calculator offers the
 * studio's real lists at the studio's own figures rather than a copy kept beside them. Bookings
 * are the shoots booked against projects. What a lead is quoted is applied back onto the lead,
 * where converting it reads the figure into Signed Quotation.
 *
 * Read-only, and mounted behind `protect` rather than the Super Admin guard the Sales Manager
 * routes carry: quoting is the CRM's daily work, done by the people working the leads.
 */

/**
 * Which of the studio's two session lengths a service is quoted in.
 *
 * Half Session and Full Session are separate timings on a service, so they are separate answers
 * here: a service offered only as a full session gets a full-session stepper and no half-session
 * one, which is what the settings screen says and what the calculator used to get wrong.
 *
 * `timingMode` is the fallback for a service saved before the list existed - it holds only the first
 * of the list, so it can confirm a session but never rule the other one out.
 */
function sessionModesFor(service) {
  const listed = Array.isArray(service?.timingModes) ? service.timingModes.filter(Boolean) : [];
  if (listed.length) return listed;
  return service?.timingMode ? [service.timingMode] : [];
}

/**
 * How a service's pricing line reads on the calculator: the booking it prices, in words.
 *
 * "Studio / In-House · Full Session · 10-12 Hours (Full) · 55 inch" - the shoot type, the timing,
 * how long it runs (the typed hours for an hourly line), and the size where the service is sold by
 * size. Every part is what Settings → Project → Services holds for the line; nothing is invented.
 */
const SHOOT_TYPE_LABEL = { STUDIO: "Studio / In-House", OUTDOOR: "Outdoor / On-Location" };
const TIMING_LABEL = { HALF_SESSION: "Half Session", FULL_SESSION: "Full Session", HOURS_MINUTES: "Hours / Minutes" };
const money = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * The deliverable variants one pricing line brings with it, each named by its three ids.
 *
 * Only where the service answered **Deliverable Added** in Settings - the rule the Quotation
 * Generator's `serviceMappedDeliverableRows` applies, so a service answered No keeps its mapping
 * stored and brings nothing. Anything without all three ids is dropped, as the settings form drops
 * it (`pricingLineDeliverables`), so a half-written mapping cannot reach a quotation.
 */
function lineDeliverables(service, row) {
  if (service?.deliverableAdded !== true) return [];
  return (Array.isArray(row?.deliverables) ? row.deliverables : [])
    .map((entry) => ({
      deliverableId: String(entry?.deliverableId || ""),
      brandId: String(entry?.brandId || ""),
      variantId: String(entry?.variantId || ""),
    }))
    .filter((entry) => entry.deliverableId && entry.brandId && entry.variantId);
}

function serviceLines(service) {
  const rows = (Array.isArray(service?.pricing) ? service.pricing : []).filter((row) => row && money(row.price) !== null);
  if (rows.length) {
    return rows.map((row, index) => ({
      id: `${service.id}:${index}`,
      shootType: SHOOT_TYPE_LABEL[row.shootType] || row.shootType || "",
      timing: TIMING_LABEL[row.timingMode] || row.timingMode || "",
      duration: row.timingMode === "HOURS_MINUTES" ? (row.hours ? `${row.hours} hour${Number(row.hours) === 1 ? "" : "s"}` : "") : (row.duration || ""),
      size: service.sizeEnabled === true ? (row.size || "") : "",
      price: money(row.price),
      // What this booking brings with it, so the calculator adds the same deliverables the
      // Quotation Generator adds when this line is chosen - see `lineDeliverables`.
      deliverables: lineDeliverables(service, row),
    }));
  }
  // A service with no pricing lines is quoted at its flat price, where it has one.
  return [{ id: `${service.id}:flat`, shootType: "", timing: "", duration: "", size: "", price: money(service?.price), deliverables: [] }];
}

/**
 * The bounds of one calendar day, or null when `date` is not a plain YYYY-MM-DD.
 *
 * Shoot dates are stored as the coerced date the project form sent, which lands on UTC midnight,
 * so the day is bounded rather than matched exactly.
 */
function dayRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "").trim())) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  // Rejects the well-formed impossibilities - 2026-02-30 rolls forward to March, so a date that
  // does not survive the round trip was never a real day.
  if (start.toISOString().slice(0, 10) !== date) return null;
  return { start, end: new Date(`${date}T23:59:59.999Z`) };
}

/** The catalogue as the browser needs it: what to list, and which rows take two steppers. */
function shapeCatalogue(services, deliverables = []) {
  return {
    /*
     * One row per pricing line under each service, carrying the price Settings gave it, so the
     * calculator can count how many of each booking the client is taking and total it. Half and
     * Full Session used to be two quantity columns per service; the lines say which bookings the
     * service is actually sold as, at what figure, and a service priced nowhere still appears -
     * unpriced - rather than vanishing from the list.
     */
    services: (services || []).map((service) => ({
      id: service.id,
      name: service.name,
      lines: serviceLines(service),
    })),
    /*
     * The deliverables Settings → Project → Deliverables describes, exactly as entered there:
     * whose they are, how long or big, the frame's inches, and the price. They replaced a list of
     * album tiers and frame sizes that was written into this file and priced nowhere.
     */
    deliverables: (deliverables || []).map((deliverable) => ({
      id: deliverable.id,
      name: deliverable.name,
      mediaType: deliverable.mediaType || null,
      brandName: deliverable.brandName || "",
      // An image's size or a video's length, whichever the deliverable's type asked for.
      imageSize: deliverable.imageSize || "",
      videoLength: deliverable.videoLength || "",
      frameInches: deliverable.frameInches || "",
      price: money(deliverable.price),
      /*
       * And, since the calculator picks deliverables the way the Quotation Generator does, what
       * the generator's picker reads off the definition: the No. of Count answer, the Settings
       * note its option label carries, and every brand and variant the deliverable is sold as -
       * each variant at its own price, which is what a chosen variant is quoted at. The flat
       * fields above stay for a row keyed by the deliverable alone, as every saved draft is.
       */
      photoCountEnabled: deliverable.photoCountEnabled ?? null,
      remarksEnabled: deliverable.remarksEnabled ?? null,
      brands: (deliverable.brands || []).map((brand) => ({
        id: brand.id,
        name: brand.name || "",
        variants: (brand.variants || []).map((variant) => ({
          id: variant.id,
          size: variant.size || "",
          frameInches: variant.frameInches || "",
          videoLength: variant.videoLength || "",
          price: money(variant.price),
        })),
      })),
    })),
  };
}

/** A booked shoot, flattened to the four columns the calculator shows. */
function shapeBookings(shoots) {
  return (shoots || []).map((shoot) => ({
    id: shoot.id,
    bookingId: shoot.shootId,
    branch: shoot.project?.sourceBranch || "",
    vertical: shoot.project?.vertical || "",
    details: shoot.shoot || "",
  }));
}

async function catalogue(req, res) {
  try {
    const [services, deliverables] = await Promise.all([
      prisma.projectServiceDefinition.findMany({
        where: { isActive: true },
        // Alphabetical, the way Project Settings now lists them: Sort Order was a number nobody
        // maintained, and two screens ordering the same services differently is worse than either.
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, price: true, pricing: true, sizeEnabled: true, deliverableAdded: true },
      }),
      prisma.projectDeliverableDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ name: "asc" }],
        select: {
          id: true, name: true, mediaType: true, brandName: true, imageSize: true, videoLength: true, frameInches: true, price: true,
          photoCountEnabled: true, remarksEnabled: true,
          // In the order they were entered, both levels - the order Settings and the Quotation
          // Generator's picker list them in.
          brands: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true, name: true, variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, size: true, frameInches: true, videoLength: true, price: true } } },
          },
        },
      }),
    ]);

    return res.json({ data: shapeCatalogue(services, deliverables) });
  } catch (error) {
    console.error("Unable to load the quotation catalogue:", error);
    return res.status(500).json({ message: "Unable to load the quotation catalogue." });
  }
}

async function bookings(req, res) {
  const date = String(req.query.date || "").trim();
  const range = dayRange(date);
  if (!range) {
    return res.status(400).json({ message: "A date of the form YYYY-MM-DD is required." });
  }

  try {
    const shoots = await prisma.projectShoot.findMany({
      where: {
        deletedAt: null,
        dateCreated: { gte: range.start, lte: range.end },
        project: { deletedAt: null },
      },
      orderBy: [{ dateCreated: "asc" }, { shootId: "asc" }],
      select: {
        id: true,
        shootId: true,
        shoot: true,
        project: { select: { sourceBranch: true, vertical: true } },
      },
    });

    return res.json({ data: shapeBookings(shoots) });
  } catch (error) {
    console.error("Unable to load bookings for the selected date:", error);
    return res.status(500).json({ message: "Unable to load bookings for the selected date." });
  }
}

/*
 * The quote a lead was given, kept on the lead.
 *
 * Read and written through the lead's own scope - the same rule the CRM board applies - so a lead
 * the caller may not see reads as not found, on purpose, on both.
 */
const { leadAccessWhere } = require("../../../services/leadScope");
const { z } = require("zod");

const quoteSchema = z.object({
  amount: z.coerce.number().min(0).max(999999999),
  // The choices the total was built from, kept as sent so the calculator reopens on them. Bounded
  // in size rather than in shape: it is the calculator's own state, read by nothing else.
  draft: z.object({
    serviceQuantities: z.record(z.string(), z.coerce.number().int().min(0).max(9999)).optional(),
    // The service rows as the screen holds them: the service, the pricing line chosen for it (blank
    // while it is still being chosen), and the quantity. `serviceQuantities` is what they resolve to.
    serviceRows: z.array(z.object({
      serviceId: z.string().max(200),
      lineId: z.string().max(200),
      quantity: z.number().int().min(0).max(9999),
    })).max(500).optional(),
    // Keyed by the deliverable's id, or by `deliverable::brand::variant` for a chosen variant.
    deliverableQuantities: z.record(z.string(), z.coerce.number().int().min(0).max(9999)).optional(),
    // No. of Count per deliverable row, where its definition asks for one.
    deliverableCounts: z.record(z.string(), z.coerce.number().int().min(0).max(999999)).optional(),
    // Which deliverable rows a service line brought in, keyed by the row and naming the line - so
    // reopening the draft still knows what goes when that service goes.
    autoDeliverables: z.record(z.string(), z.string().max(200)).optional(),
    // The priced lines the total was built from, as the calculator resolved them. The screen no
    // longer prints a unit price, so what was applied is written down here in full instead.
    lines: z.array(z.object({
      kind: z.enum(["SERVICE", "DELIVERABLE"]),
      id: z.string().max(200),
      name: z.string().max(300),
      detail: z.string().max(600),
      quantity: z.number().int().min(0).max(9999),
      count: z.number().int().min(0).max(999999).nullable().optional(),
      unitPrice: z.number().nullable(),
      total: z.number(),
    })).max(500).optional(),
    basePackagePrice: z.string().max(20).optional(),
    extras: z.string().max(20).optional(),
    discountPercent: z.string().max(5).optional(),
  }).optional(),
});

async function scopedLead(req, enquiryId) {
  return prisma.salesCrmLead.findFirst({
    where: { enquiryId, deletedAt: null, AND: [await leadAccessWhere({ userId: Number(req.user.id), permissions: req.permission })] },
    select: { enquiryId: true, quotedAmount: true, quotedDraft: true },
  });
}

async function getQuote(req, res) {
  try {
    const lead = await scopedLead(req, String(req.params.leadId || ""));
    if (!lead) return res.status(404).json({ message: "Lead not found." });
    return res.json({ data: { amount: lead.quotedAmount === null ? null : Number(lead.quotedAmount), draft: lead.quotedDraft || null } });
  } catch (error) {
    console.error("Unable to load the lead's quote:", error);
    return res.status(500).json({ message: "Unable to load the lead's quote." });
  }
}

async function saveQuote(req, res) {
  const parsed = quoteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter a valid quote." });
  try {
    const lead = await scopedLead(req, String(req.params.leadId || ""));
    if (!lead) return res.status(404).json({ message: "Lead not found." });
    const updated = await prisma.salesCrmLead.update({
      where: { enquiryId: lead.enquiryId },
      data: { quotedAmount: parsed.data.amount, quotedDraft: parsed.data.draft || null },
      select: { quotedAmount: true, quotedDraft: true },
    });
    return res.json({ data: { amount: Number(updated.quotedAmount), draft: updated.quotedDraft || null }, message: "Quote applied to the lead." });
  } catch (error) {
    console.error("Unable to save the lead's quote:", error);
    return res.status(500).json({ message: "Unable to save the lead's quote." });
  }
}

module.exports = { catalogue, bookings, getQuote, saveQuote, dayRange, shapeCatalogue, shapeBookings, sessionModesFor, serviceLines, lineDeliverables, quoteSchema };
