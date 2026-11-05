-- The deliverable variants a service brings with it, as one list on the service.
--
-- Settings → Project → Services no longer asks Shoot Type, Session Timing, Duration or Size, so a
-- service is no longer split into per-booking pricing lines on screen, and the mapping that rode on
-- each of those lines (`pricing[].deliverables`) has nowhere left to be edited. The studio's answer:
-- one list per service, brought in whenever the service is added to a shoot, whatever its session.
--
-- `deliverables` is `[{ deliverableId, brandId, variantId }]`, ids only - a name cannot identify a
-- variant. NULL on every service already here: until a service is saved again it reads as every
-- variant its pricing lines named (`serviceDeliverables` in the frontend, `serviceDeliverables` in
-- the quotation calculator), so nothing a service was set up to bring is lost. The `pricing` JSON
-- itself is not read, rewritten or cleared by this.
--
-- Additive and nullable: no existing row is touched. Written by hand and applied with
-- `prisma migrate deploy`.

ALTER TABLE `project_service_definition`
  ADD COLUMN `deliverables` JSON NULL AFTER `deliverable_added`;
