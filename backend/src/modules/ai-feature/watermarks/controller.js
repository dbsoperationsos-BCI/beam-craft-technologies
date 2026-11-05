const { z } = require("zod");
const service = require("./service");
const { validate, route } = require("../shared/http");
const { presetBodySchema, textMarkSchema } = require("./config");

const idParams = z.object({ presetId: z.string().trim().min(1).max(191) });
const notFound = (res) => res.status(404).json({ message: "Watermark preset not found." });

const listPresets = route("load watermark presets", async (req, res) => res.json({ data: await service.list() }));

const createPreset = route("save the watermark preset", async (req, res) => {
  const body = validate(presetBodySchema, req.body, res, "Please check the watermark.");
  if (!body) return;
  res.status(201).json({ data: await service.create(body, req.user) });
});

const updatePreset = route("save the watermark preset", async (req, res) => {
  const p = idParams.safeParse(req.params); if (!p.success) return notFound(res);
  const body = validate(presetBodySchema, req.body, res, "Please check the watermark.");
  if (!body) return;
  res.json({ data: await service.update(p.data.presetId, body, req.user) });
});

const deletePreset = route("delete the watermark preset", async (req, res) => {
  const p = idParams.safeParse(req.params); if (!p.success) return notFound(res);
  res.json({ data: await service.remove(p.data.presetId) });
});

/** The server's own drawing of a text mark, so the preset screen previews exactly what guests get. */
const textMark = route("draw the watermark text", async (req, res) => {
  const body = validate(textMarkSchema, req.body, res, "Please check the watermark text.");
  if (!body) return;
  res.json({ data: await service.textMarkPng(body) });
});

module.exports = { listPresets, createPreset, updatePreset, deletePreset, textMark };
