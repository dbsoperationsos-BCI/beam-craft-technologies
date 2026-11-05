"""The AI Editing render engine: one long-lived process per worker, spoken to over JSON lines -
the same contract as the scene engine (ai-culling/scene/scene_engine.py) and the face engine, run
by the face engine's own interpreter (backend/.venv-face: numpy, OpenCV headless, scipy, pillow,
onnxruntime and insightface are already there, so this needs no new package).

It never writes a file. A request carries the source photo's bytes (the studio's original when the
server can open it, else the uploaded preview), the recipe (ai-editing/recipe.js) and, when the
recipe names one, the reference photo's bytes; it answers the edited photo as a JPEG plus the
recipe it actually applied - every "auto" slider filled in with the number it chose, the scene and
lighting it read, the reference profile it measured - and plain notes about anything it could not
do. A photo that cannot be decoded fails alone, with an error, never the process.

What is real here, so the UI never claims more than it does:

  analysis         scene (from the culling run's CLIP label when the server has one, else from the
                   faces and the light: portrait / couple / group / candid / details), lighting
                   (daylight, cloudy, tungsten, mixed, night), the cast, the dynamic range, the key
                   luminance of the faces, a bright dress and dark suit present or not.
  auto edit        a restrained, photographic base: exposure aimed at the faces when there are
                   faces (middle grey otherwise), highlights pulled where a dress or a sky is blown,
                   shadows opened where a suit or a dark venue is crushed, whites and blacks set
                   from the percentiles, white balance from the neutral mid-tones with skin left
                   out and the cast named, vibrance and contrast kept small.
  adjustments      a float pipeline in linear light where it matters: exposure (stops), highlights
                   and shadows (luminance-masked, skin-protected), whites and blacks (end points),
                   contrast (S-curve), temperature and tint (channel gains), vibrance (weighted to
                   the least saturated pixels, skin protected) and saturation.
  advanced         HSL per hue band (hue / saturation / luminance), colour balance for shadows,
                   midtones and highlights, clarity (local contrast) and texture (fine detail).
  styles           named looks: tone curve, colour grade (split toning), HSL tilt, skin treatment,
                   sharpening and grain where the look wants it - all parameters of this pipeline.
  reference        the reference is MEASURED into an editing profile (slider deltas and tone
                   colours) that the recipe carries and a batch copies; a Lab colour transfer,
                   blended by strength, follows the profile when the reference bytes are at hand.
  denoise          OpenCV non-local-means on luma and chroma separately, edges and fine texture
                   blended back by "keep detail".
  sharpen          unsharp mask under an edge mask, skin faces protected, halos limited.
  remove object    OpenCV Telea inpainting of painted rectangles (classical; wires, poles, small
                   things). "Suggest" marks background people from the small faces the detector
                   finds away from the main subjects - a proposal the photographer confirms.
  sky              a heuristic sky mask (blue, sunset or blown, low texture, touching the top edge)
                   -> exposure, recovery, contrast, colour and sunset warmth inside it.
  background       GrabCut seeded from the detected faces (head and shoulders), feathered ->
                   background brightness, blur, and "calm" (a gentle desaturate-and-soften).
  faces            InsightFace SCRFD detection and, when the buffalo_l 68-point landmark model is
                   present, the eyes, under-eyes and mouth: skin smoothing (bilateral + detail
                   blend, texture kept), blemish reduction, under-eye lift, shine reduction, skin
                   exposure, skin tone balancing, teeth whitening, face exposure, eye enhancement
                   and facial detail. Nothing reshapes a face.
  smart crop       face-aware (every face kept, headroom respected, the faces on the upper third)
                   or, with no faces, gradient-energy weighted, to the chosen aspect.
  retouching       ten regions, one intensity each, every change confined to its mask: facial skin
                   and body skin (the skin mask split at the face, body skin inside the subject
                   outline) - specks replaced by the median and the low-frequency tone evened with
                   the pores and fine detail put back; eyebrows, the sclera, the iris and pupil,
                   the lips and the teeth from the 68 landmarks (the iris as the dark disc inside
                   the eye); hair (flyaways in the band at the edge of the head outline), facial
                   hair (the textured, non-skin part of the lower face) and clothes (the subject
                   outline minus skin and head, plain areas only) from heuristic outlines - said to
                   be approximate in `capabilities`, where a face-parsing model would make them
                   exact. Nothing changes a colour, a shape or a pattern.

Protocol. On start it prints one line: {"ready": true, "engine", "version", "capabilities",
"python"} or {"ready": false, "error"}. Then each request line:
  {"id", "op": "render", "image": b64, "reference": b64 | null, "recipe", "maxEdge", "sceneHint"}
    -> progress lines {"id", "stage": "..."} and then {"id", "result": {"image": b64 JPEG, "width",
       "height", "applied", "notes", "faces", "analysis", "referenceProfile"}}
  {"id", "op": "profile", "image": b64}  -> {"id", "result": {profile}}   (measure a reference)
  {"id", "op": "suggest", "image": b64}  -> {"id", "result": {"masks": [...], "faces": n}}
  {"id", "op": "capabilities"}           -> the capability map
Anything else answers {"id", "error"}.

Environment: AI_EDIT_THREADS (default min(4, cores)), AI_EDIT_JPEG_QUALITY (default 92),
INSIGHTFACE_HOME (where the face engine keeps its models; absent models mean no face tools),
AI_EDIT_HOST_LABEL (where this engine runs, for the studio's words when a model is missing:
"this server" by default; the desktop app says "this computer").
"""
import base64, io, json, os, sys

try:
    import numpy as np
except Exception:  # pragma: no cover - reported by main()
    np = None

ENGINE = "edit-engine"
VERSION = "2.1.0"
MAX_EDGE_DEFAULT = 3000
MAX_SOURCE_PIXELS = 120_000_000
JPEG_QUALITY = int(os.environ.get("AI_EDIT_JPEG_QUALITY", "92") or 92)
FACE_MODEL = os.environ.get("AI_FACE_MODEL_NAME", "buffalo_l")
# Where this engine runs, and the one file the landmark tools need - named in every note and
# capability reason, so a missing model says what is missing and where it was looked for (the
# desktop renders from originals on a workstation, and "this server" was the wrong place there).
HOST_LABEL = (os.environ.get("AI_EDIT_HOST_LABEL") or "this server").strip() or "this server"
LANDMARK_FILE = "1k3d68.onnx"
LANDMARK_MISSING = f"the face landmark model ({FACE_MODEL}/{LANDMARK_FILE}), which is not installed on {HOST_LABEL}"

# Named looks: parameters of the pipeline below, nothing else. Restrained on purpose.
#   exposure (stops), lift / roll / contrast (tone curve), shadows / highlights RGB gains (split
#   toning), sat (overall), vibrance, hsl tilts [band -> (hue, sat, lum)], skin (smoothing 0..1),
#   sharpen (0..1), grain (sd), warmth (temperature-like), clarity
STYLE_LOOKS = {
    "natural": None,
    "warmWedding": {"exposure": 0.05, "lift": 0.012, "roll": 0.03, "contrast": 0.04, "shadows": (1.02, 1.0, 0.97), "highlights": (1.03, 1.01, 0.97), "sat": 0.02, "vibrance": 0.08, "hsl": {"orange": (0, 4, 4)}, "skin": 0.15, "warmth": 0.08, "grain": 0.0},
    "luxuryWedding": {"exposure": -0.03, "lift": 0.02, "roll": 0.06, "contrast": 0.09, "shadows": (0.99, 0.985, 1.0), "highlights": (1.03, 1.015, 0.985), "sat": -0.04, "vibrance": 0.1, "hsl": {"orange": (0, -4, 6), "yellow": (-3, -8, 0), "green": (0, -14, -4)}, "skin": 0.25, "clarity": 0.08, "sharpen": 0.15, "grain": 0.0},
    "cinematic": {"lift": 0.02, "roll": 0.05, "contrast": 0.14, "shadows": (0.94, 1.0, 1.06), "highlights": (1.05, 1.02, 0.96), "sat": -0.08, "hsl": {"orange": (0, 6, 0), "blue": (0, 8, -4)}, "grain": 0.012},
    "moody": {"exposure": -0.25, "lift": 0.06, "roll": 0.08, "contrast": 0.08, "shadows": (0.98, 0.99, 1.02), "highlights": (1.0, 0.99, 0.97), "sat": -0.24, "hsl": {"green": (0, -20, -8), "yellow": (-4, -12, -4)}, "grain": 0.0},
    "brightAiry": {"exposure": 0.35, "lift": 0.03, "roll": 0.02, "contrast": -0.06, "shadows": (1.01, 1.01, 1.03), "highlights": (1.01, 1.0, 1.0), "sat": -0.08, "hsl": {"orange": (0, -6, 10), "green": (0, -18, 8), "blue": (0, -10, 8)}, "skin": 0.2},
    "editorial": {"lift": 0.0, "roll": 0.02, "contrast": 0.06, "shadows": (1.0, 1.0, 1.0), "highlights": (1.0, 1.0, 1.0), "sat": -0.1, "vibrance": 0.04, "hsl": {"yellow": (0, -10, 0), "green": (0, -22, -6)}, "clarity": 0.12, "sharpen": 0.2, "skin": 0.1},
    "filmLook": {"lift": 0.07, "roll": 0.06, "contrast": 0.02, "shadows": (1.0, 1.0, 0.96), "highlights": (1.03, 1.01, 0.95), "sat": -0.1, "hsl": {"green": (-6, -10, 0), "red": (0, -6, 0)}, "grain": 0.035},
    "classic": {"lift": 0.01, "roll": 0.03, "contrast": 0.05, "shadows": (1.01, 1.0, 0.98), "highlights": (1.02, 1.01, 0.98), "sat": -0.02, "vibrance": 0.04, "warmth": 0.04, "skin": 0.1},
    "goldenHour": {"exposure": 0.05, "lift": 0.015, "roll": 0.05, "contrast": 0.05, "shadows": (1.04, 1.0, 0.94), "highlights": (1.06, 1.02, 0.92), "sat": 0.02, "vibrance": 0.08, "hsl": {"orange": (0, 8, 4), "yellow": (-6, 6, 2), "blue": (0, -8, -2)}, "warmth": 0.16, "skin": 0.12},
}
ASPECTS = {"1:1": 1.0, "4:5": 0.8, "5:7": 5 / 7, "2:3": 2 / 3, "3:2": 1.5, "16:9": 16 / 9}
HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]
# Band centres on OpenCV's 0..180 hue scale (red wraps).
HSL_CENTRES = {"red": 0, "orange": 15, "yellow": 30, "green": 60, "aqua": 90, "blue": 120, "purple": 140, "magenta": 160}
# What the culling run's CLIP label means for the edit.
SCENE_FROM_HINT = {
    "BRIDE_PORTRAIT": "bride_portrait", "GROOM_PORTRAIT": "groom_portrait", "COUPLE": "couple", "PORTRAIT": "portrait",
    "FAMILY": "family", "GROUP": "group", "CANDID": "candid", "EMOTIONAL": "candid", "CEREMONY": "ceremony", "GETTING_READY": "getting_ready",
    "DANCE": "reception", "STAGE": "reception", "DECOR": "decor", "DETAILS": "details", "FOOD": "details", "VENUE": "venue", "KIDS": "candid",
}


def log(message):
    print(f"[edit-engine] {message}", file=sys.stderr, flush=True)


class Faces:
    """Face detection (and the 68-point landmarks when the pack has them), lazily loaded, optional."""

    def __init__(self):
        self.app = None
        self.landmarks = False
        self.error = None
        self.tried = False

    def ready(self):
        if self.tried:
            return self.app is not None
        self.tried = True
        try:
            import onnxruntime  # noqa: F401
            from insightface.app import FaceAnalysis
            root = os.path.expanduser(os.environ.get("INSIGHTFACE_HOME", "~/.insightface"))
            model_dir = os.path.join(root, "models", FACE_MODEL)
            if not os.path.exists(os.path.join(model_dir, "det_10g.onnx")):
                self.error = "the face engine's detection model is not downloaded"
                return False
            self.landmarks = os.path.exists(os.path.join(model_dir, LANDMARK_FILE))
            modules = ["detection"] + (["landmark_3d_68"] if self.landmarks else [])
            app = FaceAnalysis(name=FACE_MODEL, root=root, allowed_modules=modules, providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=-1, det_size=(640, 640))
            self.app = app
            return True
        except Exception as error:  # pragma: no cover - depends on the machine
            self.error = f"{type(error).__name__}: {error}"
            return False

    def detect(self, bgr):
        """Faces on a frame scaled to at most 1280 px, boxes and landmarks scaled back. [] without the engine."""
        if not self.ready():
            return []
        import cv2
        import numpy as np
        h, w = bgr.shape[:2]
        scale = min(1.0, 1280.0 / max(h, w))
        frame = cv2.resize(bgr, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else bgr
        found = []
        for face in self.app.get(frame):
            box = (np.array(face.bbox, dtype=np.float32) / scale).tolist()
            entry = {"box": box, "score": float(face.det_score), "kps": (np.array(face.kps, dtype=np.float32) / scale).tolist() if getattr(face, "kps", None) is not None else None}
            marks = getattr(face, "landmark_3d_68", None)
            entry["landmarks"] = (np.array(marks, dtype=np.float32)[:, :2] / scale).tolist() if marks is not None and len(marks) >= 68 else None
            found.append(entry)
        found.sort(key=lambda face: -(face["box"][2] - face["box"][0]) * (face["box"][3] - face["box"][1]))
        return found[:30]


FACES = Faces()


# ------------------------------------------------------------------------------------------ maths
def srgb_to_linear(x):
    import numpy as np
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    import numpy as np
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def luminance(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def channel_spread(rgb):
    """max - min over the three channels: the numbers of rgb.max(axis=2) - rgb.min(axis=2), without
    numpy's slow reduction over a 3-wide axis (about ten times faster on a full frame)."""
    import numpy as np
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)


def smoothstep(edge0, edge1, x):
    import numpy as np
    t = np.clip((x - edge0) / max(1e-6, edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def feather(mask, radius):
    import cv2
    if radius <= 0:
        return mask
    k = int(radius) * 2 + 1
    return cv2.GaussianBlur(mask, (k, k), 0)


def skin_mask(bgr8):
    """Classic YCrCb skin threshold, soft at the edges. 0..1 float."""
    import cv2
    import numpy as np
    ycrcb = cv2.cvtColor(bgr8, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    cr, cb = ycrcb[..., 1], ycrcb[..., 2]
    m = smoothstep(133, 140, cr) * (1 - smoothstep(170, 178, cr)) * smoothstep(77, 85, cb) * (1 - smoothstep(125, 133, cb))
    return feather(m.astype(np.float32), 4)


def face_region_mask(shape, faces, grow=0.35, extra_top=0.45):
    import cv2
    import numpy as np
    h, w = shape[:2]
    mask = np.zeros((h, w), dtype=np.float32)
    for face in faces:
        x0, y0, x1, y1 = face["box"]
        fw, fh = x1 - x0, y1 - y0
        center = (int((x0 + x1) / 2), int((y0 + y1) / 2 - fh * 0.05))
        axes = (max(1, int(fw * (0.5 + grow))), max(1, int(fh * (0.5 + grow) + fh * extra_top * 0.3)))
        cv2.ellipse(mask, center, axes, 0, 0, 360, 1.0, -1)
    return feather(mask, 15)


def polygon_mask(shape, points, grow_px=0):
    import cv2
    import numpy as np
    mask = np.zeros(shape[:2], dtype=np.float32)
    pts = np.array(points, dtype=np.int32).reshape(-1, 1, 2)
    cv2.fillPoly(mask, [pts], 1.0)
    if grow_px:
        mask = cv2.dilate(mask, np.ones((grow_px * 2 + 1, grow_px * 2 + 1), np.uint8))
    return mask


# ------------------------------------------------------------------------------------- analysis
def sky_mask(bgr8):
    """Sky: bright, low-texture pixels connected to the top edge, kept only when the component is
    genuinely blue, a sunset band, or nearly blown out - a white indoor wall is bright and smooth too."""
    import cv2
    import numpy as np
    h, w = bgr8.shape[:2]
    hsv = cv2.cvtColor(bgr8, cv2.COLOR_BGR2HSV).astype(np.float32)
    gray = cv2.cvtColor(bgr8, cv2.COLOR_BGR2GRAY)
    texture = cv2.GaussianBlur(cv2.convertScaleAbs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)).astype(np.float32), (0, 0), 3)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    bluish = (hue > 90) & (hue < 130) & (sat > 35) & (val > 90)
    warm_sky = (hue < 25) & (sat > 40) & (val > 150)
    blown = (sat < 30) & (val > 232)
    candidate = ((bluish | blown | warm_sky) & (texture < 10)).astype(np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    count, labels = cv2.connectedComponents(candidate)
    top = set(np.unique(labels[: max(2, h // 40), :]).tolist()) - {0}
    keep = np.zeros((h, w), dtype=bool)
    for label in top:
        member = labels == label
        if member.mean() < 0.02:
            continue
        # A blown sky spans the top of the frame; a white wall or a dress is a patch.
        columns = member.any(axis=0).mean()
        if bluish[member].mean() > 0.35 or warm_sky[member].mean() > 0.5 or (val[member].mean() > 246 and columns > 0.4):
            keep |= member
    if keep.mean() < 0.03:
        return None
    return feather(keep.astype(np.float32), max(9, min(h, w) // 60))


def noise_level(bgr8):
    """Residual noise in the smooth areas, 0..1-ish: the high-frequency energy where there is no edge."""
    import cv2
    import numpy as np
    gray = cv2.cvtColor(bgr8, cv2.COLOR_BGR2GRAY).astype(np.float32)
    scale = min(1.0, 1200 / gray.shape[1])
    small = cv2.resize(gray, (max(1, int(gray.shape[1] * scale)), max(1, int(gray.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    high = small - cv2.GaussianBlur(small, (0, 0), 1.2)
    edges = cv2.GaussianBlur(np.abs(cv2.Laplacian(small, cv2.CV_32F, ksize=3)), (0, 0), 2)
    flat = edges < np.percentile(edges, 50)
    if flat.sum() < 100:
        return 0.0
    return float(np.clip(high[flat].std() / 6.0, 0, 1))


def analyze(bgr8, faces, sky, scene_hint=None, skin=None):
    """What the photo is: scene, lighting, cast, dynamic range, the faces' key, dress and suit.
    `skin` is this frame's skin_mask when the caller already has it."""
    import cv2
    import numpy as np
    rgb = bgr8[..., ::-1].astype(np.float32) / 255.0
    lum = luminance(rgb)
    skin = skin_mask(bgr8) if skin is None else skin
    p1, p5, p50, p95, p99 = np.percentile(lum, [1, 5, 50, 95, 99])
    hsv = cv2.cvtColor(bgr8, cv2.COLOR_BGR2HSV).astype(np.float32)
    sat_mean = float(hsv[..., 1].mean() / 255.0)
    weight = smoothstep(0.15, 0.3, lum) * (1 - smoothstep(0.75, 0.9, lum)) * (1 - skin) * (1 - smoothstep(0.25, 0.6, hsv[..., 1] / 255.0))
    total = float(weight.sum()) + 1e-6
    mean = np.maximum(np.array([float((rgb[..., c] * weight).sum() / total) for c in range(3)]), 1e-4)
    rb = float(np.log2(mean[0] / mean[2]))
    gm = float(np.log2(mean[1] / ((mean[0] + mean[2]) / 2)))
    cast = "neutral"
    if rb > 0.22:
        cast = "tungsten" if rb > 0.4 else "warm"
    elif rb < -0.18:
        cast = "blue"
    if gm > 0.12:
        cast = "green" if cast == "neutral" else f"{cast}+green"
    noise = noise_level(bgr8)
    night = p50 < 0.16 and p95 < 0.7
    dark_venue = p50 < 0.25 and sky is None
    if night:
        lighting = "night"
    elif cast in ("tungsten", "warm") and sky is None:
        lighting = "tungsten"
    elif "+" in cast:
        lighting = "mixed"
    elif sky is not None and sat_mean < 0.18:
        lighting = "cloudy"
    elif sky is not None:
        lighting = "daylight"
    else:
        lighting = "indoor"
    key = None
    face_lum = []
    for face in faces[:6]:
        x0, y0, x1, y1 = [int(v) for v in face["box"]]
        patch = lum[max(0, y0):max(1, y1), max(0, x0):max(1, x1)]
        if patch.size:
            face_lum.append(float(np.median(patch)))
    if face_lum:
        key = float(np.median(face_lum[:2]))
    bright = float(((lum > 0.85) & (hsv[..., 1] < 40)).mean())
    dark = float(((lum < 0.08) & (hsv[..., 1] < 60)).mean())
    backlit = key is not None and key < 0.3 and p95 > 0.9
    n = len(faces)
    if scene_hint and scene_hint in SCENE_FROM_HINT:
        scene = SCENE_FROM_HINT[scene_hint]
    elif n == 0:
        scene = "details" if (bright + dark) < 0.05 and noise < 0.3 and sky is None else "venue" if sky is not None else "decor"
    elif n == 1:
        scene = "portrait"
    elif n == 2:
        scene = "couple"
    elif n <= 5:
        scene = "family"
    else:
        scene = "group"
    return {
        "scene": scene, "sceneHint": scene_hint, "lighting": lighting, "cast": cast, "night": bool(night), "darkVenue": bool(dark_venue), "backlit": bool(backlit),
        "faces": n, "keyLuminance": round(key, 3) if key is not None else None,
        "median": round(float(p50), 3), "p5": round(float(p5), 3), "p95": round(float(p95), 3), "dynamicRange": round(float(p99 - p1), 3),
        "brightDress": bool(bright > 0.06), "darkSuit": bool(dark > 0.08), "noise": round(noise, 3), "saturation": round(sat_mean, 3), "sky": sky is not None,
        "castRB": round(rb, 3), "castGM": round(gm, 3), "lumStd": round(float(lum.std()), 4),
    }


def auto_exposure(a):
    """The five tone sliders from the analysis: restrained, aimed at the faces when there are any."""
    import numpy as np
    # Skin sits a little above middle grey; the correction is restrained - a face at 0.33 gets
    # about half a stop, never a full lift that flattens the light.
    target = 0.44 if a["keyLuminance"] is None else 0.48
    source = a["median"] if a["keyLuminance"] is None else a["keyLuminance"]
    stops = float(np.clip(np.log2(target / max(source, 0.02)) * 0.8, -0.7, 0.6))
    if a["night"]:
        stops = min(stops, 0.45)
    exposure = stops / 2.0 * 100
    highlights = 0.0
    if a["p95"] > 0.88 or a["brightDress"]:
        highlights = -float(np.clip((a["p95"] - 0.82) * 400 + (25 if a["brightDress"] else 0), 10, 70))
    if a["backlit"]:
        highlights = min(highlights, -35)
    shadows = 0.0
    if a["p5"] < 0.12 or a["darkSuit"] or a["backlit"]:
        # Open the shadows, but a lift that flattens the light is the failure mode: a suit or a
        # backlit face earns more, an ordinary dark corner does not.
        ceiling = 55 if (a["darkSuit"] or a["backlit"]) else 32
        shadows = float(np.clip((0.14 - a["p5"]) * 300 + (18 if a["darkSuit"] else 0) + (22 if a["backlit"] else 0), 8, ceiling))
    if a["night"]:
        shadows = min(shadows, 25)
    whites = float(np.clip((0.96 - a["p95"]) * 250, 0, 30)) if a["p95"] < 0.9 and not a["night"] else 0.0
    blacks = -float(np.clip((a["p5"] - 0.04) * 300, 0, 30)) if a["p5"] > 0.05 and a["dynamicRange"] < 0.9 else 0.0
    return {"exposure": round(exposure), "highlights": round(highlights), "shadows": round(shadows), "whites": round(whites), "blacks": round(blacks)}


def auto_white_balance(a):
    """Temperature and tint that undo the measured cast - the opposite of what the neutrals show."""
    import numpy as np
    temperature = float(np.clip(-a["castRB"] * 120, -60, 60))
    tint = float(np.clip(-a["castGM"] * 160, -50, 50))
    if a["lighting"] == "tungsten":
        temperature *= 0.7
    return {"temperature": round(temperature), "tint": round(tint)}


def auto_color(a):
    """Contrast / vibrance for the auto edit: small, scene-aware, never a saturation push."""
    contrast = 8 if a["dynamicRange"] < 0.75 else 4
    vibrance = 10 if a["saturation"] < 0.2 else 4
    if a["night"]:
        contrast, vibrance = 4, 6
    return {"contrast": contrast, "vibrance": vibrance}


# ------------------------------------------------------------------------------------- operations
def apply_adjustments(rgb, adj, skin):
    import numpy as np
    lin = srgb_to_linear(rgb)
    exposure = (adj.get("exposure") or 0) / 100.0 * 2.0
    if exposure:
        lin = lin * (2.0 ** exposure)
    temperature = (adj.get("temperature") or 0) / 100.0
    tint = (adj.get("tint") or 0) / 100.0
    if temperature or tint:
        gains = np.array([2.0 ** (0.35 * temperature - 0.15 * tint), 2.0 ** (0.3 * tint), 2.0 ** (-0.35 * temperature - 0.15 * tint)], dtype=np.float32)
        lin = lin * gains
    rgb = linear_to_srgb(lin)
    lum = luminance(rgb)
    highlights = (adj.get("highlights") or 0) / 100.0
    shadows = (adj.get("shadows") or 0) / 100.0
    if highlights:
        m = smoothstep(0.5, 0.95, lum) * (1 - 0.5 * skin)
        rgb = rgb + (highlights * -0.35) * m[..., None] * rgb
    if shadows:
        m = 1 - smoothstep(0.05, 0.55, lum)
        rgb = rgb + (shadows * 0.35) * m[..., None] * (1 - rgb)
    whites = (adj.get("whites") or 0) / 100.0
    blacks = (adj.get("blacks") or 0) / 100.0
    if whites or blacks:
        lo = -blacks * 0.08
        hi = 1.0 + whites * 0.08
        rgb = (rgb - lo) / max(1e-3, hi - lo)
    contrast = (adj.get("contrast") or 0) / 100.0
    if contrast:
        rgb = np.clip(rgb, 0, 1)
        k = 1.0 + contrast * 0.9
        rgb = 0.5 + (rgb - 0.5) * k if contrast < 0 else 0.5 + np.sign(rgb - 0.5) * 0.5 * np.power(np.abs(rgb - 0.5) * 2, 1.0 / k)
    rgb = np.clip(rgb, 0, 1)
    vibrance = (adj.get("vibrance") or 0) / 100.0
    saturation = (adj.get("saturation") or 0) / 100.0
    if vibrance or saturation:
        lum = luminance(rgb)[..., None]
        sat = channel_spread(rgb)[..., None]
        amount = saturation * 0.8 + vibrance * 0.9 * (1 - np.clip(sat * 1.6, 0, 1)) * (1 - 0.7 * skin[..., None] * (vibrance > 0))
        rgb = lum + (rgb - lum) * (1 + amount)
    return np.clip(rgb, 0, 1)


def apply_hsl(bgr8, hsl):
    """Per-band hue shift, saturation and luminance, with a soft band mask so nothing posterises."""
    import cv2
    import numpy as np
    if not any(any(v for v in band.values()) for band in hsl.values()):
        return bgr8
    hsv = cv2.cvtColor(bgr8, cv2.COLOR_BGR2HSV).astype(np.float32)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    chroma = np.clip(sat / 255.0 * 1.5, 0, 1)
    new_hue, new_sat, new_val = hue.copy(), sat.copy(), val.copy()
    for band, values in hsl.items():
        dh, ds, dl = values.get("hue", 0) / 100.0, values.get("sat", 0) / 100.0, values.get("lum", 0) / 100.0
        if not (dh or ds or dl):
            continue
        centre = HSL_CENTRES[band]
        distance = np.minimum(np.abs(hue - centre), 180 - np.abs(hue - centre))
        weight = (1 - smoothstep(8, 20, distance)) * chroma
        new_hue = new_hue + dh * 12 * weight
        new_sat = new_sat * (1 + ds * 0.7 * weight)
        new_val = new_val * (1 + dl * 0.35 * weight)
    hsv[..., 0] = np.mod(new_hue, 180)
    hsv[..., 1] = np.clip(new_sat, 0, 255)
    hsv[..., 2] = np.clip(new_val, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def apply_color_balance(rgb, balance):
    """Shadows / midtones / highlights RGB offsets, luminance-masked - split toning, three ways."""
    import numpy as np
    if not any(any(v for v in rng.values()) for rng in balance.values()):
        return rgb
    lum = luminance(rgb)
    masks = {"shadows": 1 - smoothstep(0.15, 0.5, lum), "midtones": smoothstep(0.1, 0.4, lum) * (1 - smoothstep(0.6, 0.9, lum)), "highlights": smoothstep(0.5, 0.85, lum)}
    out = rgb.copy()
    for rng, values in balance.items():
        shift = np.array([values.get("r", 0), values.get("g", 0), values.get("b", 0)], dtype=np.float32) / 100.0 * 0.08
        if not shift.any():
            continue
        out = out + shift[None, None, :] * masks[rng][..., None]
    return np.clip(out, 0, 1)


def apply_detail(bgr8, clarity, texture, skin):
    """Clarity: local contrast at a wide radius; texture: fine detail - both skin-protected."""
    import cv2
    import numpy as np
    if not clarity and not texture:
        return bgr8
    out = bgr8.astype(np.float32)
    protect = (1 - 0.75 * skin)[..., None]
    if clarity:
        wide = cv2.GaussianBlur(bgr8, (0, 0), max(4, min(bgr8.shape[:2]) / 60)).astype(np.float32)
        out = out + (out - wide) * (clarity * 0.5) * protect
    if texture:
        fine = cv2.GaussianBlur(bgr8, (0, 0), 1.0).astype(np.float32)
        out = out + (out - fine) * (texture * 0.6) * protect
    return out.clip(0, 255).astype(np.uint8)


def apply_style(rgb, style_id, rng, skin):
    import numpy as np
    look = STYLE_LOOKS.get(style_id)
    if not look:
        return rgb, {}
    if look.get("exposure"):
        rgb = linear_to_srgb(srgb_to_linear(rgb) * (2.0 ** look["exposure"]))
    if look.get("warmth"):
        lin = srgb_to_linear(rgb) * np.array([2.0 ** (0.35 * look["warmth"]), 1.0, 2.0 ** (-0.35 * look["warmth"])], dtype=np.float32)
        rgb = linear_to_srgb(lin)
    lift, roll, contrast = look["lift"], look["roll"], look["contrast"]
    x = lift + rgb * (1 - lift - roll) + roll * np.power(rgb, 2)
    if contrast:
        x = 0.5 + np.sign(x - 0.5) * 0.5 * np.power(np.abs(x - 0.5) * 2, 1.0 / (1.0 + contrast))
    x = np.clip(x, 0, 1)
    lum = luminance(x)
    sh = (1 - smoothstep(0.2, 0.6, lum))[..., None]
    hi = smoothstep(0.4, 0.85, lum)[..., None]
    x = x * (1 + (np.array(look["shadows"]) - 1) * sh) * (1 + (np.array(look["highlights"]) - 1) * hi)
    if look.get("sat") or look.get("vibrance"):
        l = luminance(x)[..., None]
        sat = channel_spread(x)[..., None]
        amount = look.get("sat", 0) + look.get("vibrance", 0) * (1 - np.clip(sat * 1.6, 0, 1)) * (1 - 0.7 * skin[..., None])
        x = l + (x - l) * (1 + amount)
    x = np.clip(x, 0, 1)
    if look.get("grain"):
        noise = rng.normal(0, look["grain"], size=x.shape[:2]).astype(np.float32)
        x = np.clip(x + (noise * (1 - 0.6 * luminance(x)))[..., None], 0, 1)
    extras = {"hsl": look.get("hsl") or {}, "skin": look.get("skin", 0), "sharpen": look.get("sharpen", 0), "clarity": look.get("clarity", 0)}
    return x, extras


def measure_like(a):
    """This photo measured the way a reference is, so a profile's deltas are relative to it."""
    import numpy as np
    key = a["keyLuminance"] if a["keyLuminance"] is not None else a["median"]
    neutral_key = 0.52 if a["keyLuminance"] is not None else 0.44
    return {
        "exposure": float(np.clip(np.log2(max(key, 0.02) / neutral_key) / 2.0 * 100, -60, 60)),
        "contrast": float(np.clip((a.get("lumStd", 0.22) / 0.22 - 1.0) * 60, -50, 50)),
        "highlights": float(np.clip((0.9 - a["p95"]) * 250, -50, 20)), "shadows": float(np.clip((a["p5"] - 0.06) * 350, -20, 50)),
        "temperature": float(np.clip(a["castRB"] * 110, -60, 60)), "tint": float(np.clip(a["castGM"] * 150, -40, 40)),
        "saturation": float(np.clip((a["saturation"] / 0.26 - 1.0) * 60, -50, 50)),
        "vibrance": float(np.clip((a["saturation"] / 0.26 - 1.0) * 30, -25, 25)),
    }


def measure_profile(bgr8, faces=None):
    """A reference measured into an editing profile: what its light and colour ask for, as slider
    deltas and tone colours. Pixels are never copied from it - a profile is portable to any photo."""
    import cv2
    import numpy as np
    skin = skin_mask(bgr8)
    a = analyze(bgr8, faces or [], None)
    rgb = bgr8[..., ::-1].astype(np.float32) / 255.0
    lum = luminance(rgb)
    lab = cv2.cvtColor(bgr8, cv2.COLOR_BGR2LAB).astype(np.float32)
    like = measure_like(a)
    contrast = like["contrast"]
    saturation = like["saturation"]

    def tone(mask):
        w = mask[..., None]
        total = float(w.sum()) + 1e-6
        mean = (rgb * w).reshape(-1, 3).sum(axis=0) / total
        grey = mean.mean()
        return {"r": round(float(np.clip((mean[0] - grey) * 400, -60, 60))), "g": round(float(np.clip((mean[1] - grey) * 400, -60, 60))), "b": round(float(np.clip((mean[2] - grey) * 400, -60, 60)))}

    shadow_tone = tone((1 - smoothstep(0.1, 0.4, lum)) * (1 - skin))
    highlight_tone = tone(smoothstep(0.55, 0.9, lum) * (1 - skin))
    skin_warmth = 0.0
    if float(skin.sum()) > 500:
        w = skin[..., None]
        mean_lab = (lab * w).reshape(-1, 3).sum(axis=0) / float(w.sum())
        skin_warmth = float(np.clip((mean_lab[2] - 148.0) * 3.0, -40, 40))
    words = []
    if abs(like["exposure"]) >= 8:
        words.append("brighter" if like["exposure"] > 0 else "darker")
    if abs(contrast) >= 8:
        words.append("more contrast" if contrast > 0 else "softer")
    if abs(like["temperature"]) >= 8:
        words.append("warmer" if like["temperature"] > 0 else "cooler")
    if abs(saturation) >= 8:
        words.append("more colour" if saturation > 0 else "more muted")
    if abs(skin_warmth) >= 8:
        words.append("warmer skin" if skin_warmth > 0 else "cooler skin")
    summary = ("Reads " + ", ".join(words) if words else "Reads close to neutral") + f"; {a['lighting']} light."
    return {
        "exposure": round(like["exposure"]), "contrast": round(contrast), "highlights": round(like["highlights"]), "shadows": round(like["shadows"]),
        "temperature": round(like["temperature"]), "tint": round(like["tint"]), "vibrance": round(saturation * 0.5), "saturation": round(saturation),
        "skinWarmth": round(skin_warmth), "shadowTone": shadow_tone, "highlightTone": highlight_tone, "summary": summary,
    }


def apply_profile(adjustments, balance, profile, strength, a):
    """Move the sliders towards the profile by strength - relative to THIS photo's own measured
    light, so a dark reference does not darken a photo that is already dark."""
    own = measure_like(a)
    for key in ("exposure", "contrast", "highlights", "shadows", "temperature", "tint", "vibrance", "saturation"):
        delta = (profile.get(key, 0) - own.get(key, 0)) * strength
        adjustments[key] = int(round((adjustments.get(key) or 0) + delta))
    for rng, tone_key in (("shadows", "shadowTone"), ("highlights", "highlightTone")):
        tone = profile.get(tone_key) or {}
        for channel in ("r", "g", "b"):
            balance[rng][channel] = int(round(balance[rng].get(channel, 0) + tone.get(channel, 0) * strength * 0.5))
    return adjustments, balance


def apply_reference_transfer(bgr8, ref_bgr8, strength, skin):
    """Reinhard transfer in Lab after the profile: the last few percent of a match, skin kept."""
    import cv2
    import numpy as np
    lab = cv2.cvtColor(bgr8, cv2.COLOR_BGR2LAB).astype(np.float32)
    ref = cv2.cvtColor(ref_bgr8, cv2.COLOR_BGR2LAB).astype(np.float32)
    src_mean, src_std = lab.reshape(-1, 3).mean(axis=0), lab.reshape(-1, 3).std(axis=0) + 1e-3
    ref_mean, ref_std = ref.reshape(-1, 3).mean(axis=0), ref.reshape(-1, 3).std(axis=0) + 1e-3
    out = lab.copy()
    for c in range(3):
        scale = np.clip(ref_std[c] / src_std[c], 0.7, 1.4)
        target = (lab[..., c] - src_mean[c]) * scale + ref_mean[c]
        out[..., c] = lab[..., c] + (target - lab[..., c]) * strength * 0.5
    if float(skin.sum()) > 500:
        w = (skin * 0.6)[..., None]
        out[..., 1:] = out[..., 1:] * (1 - w[..., 0:1]) + lab[..., 1:] * w[..., 0:1]
    return cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def color_enhance(bgr8, strength, skin):
    import cv2
    import numpy as np
    lab = cv2.cvtColor(bgr8, cv2.COLOR_BGR2LAB)
    clahe = cv2.createCLAHE(clipLimit=1.2 + 1.2 * strength, tileGridSize=(8, 8))
    l2 = clahe.apply(lab[..., 0])
    blend = (0.5 * strength) * (1 - 0.6 * skin)
    lab[..., 0] = np.clip(lab[..., 0].astype(np.float32) * (1 - blend) + l2.astype(np.float32) * blend, 0, 255).astype(np.uint8)
    a_mean, b_mean = float(lab[..., 1].mean()) - 128, float(lab[..., 2].mean()) - 128
    lab[..., 1] = np.clip(lab[..., 1].astype(np.float32) - a_mean * 0.3 * strength, 0, 255).astype(np.uint8)
    lab[..., 2] = np.clip(lab[..., 2].astype(np.float32) - b_mean * 0.3 * strength, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def denoise(bgr8, strength, keep_detail):
    """Luma and chroma denoised apart (chroma harder, as night noise is mostly colour), then the
    edges and fine texture blended back by "keep detail"."""
    import cv2
    import numpy as np
    h_luma = 2 + 10 * strength
    h_chroma = 4 + 16 * strength
    out = cv2.fastNlMeansDenoisingColored(bgr8, None, h_luma, h_chroma, 7, 21)
    gray = cv2.cvtColor(bgr8, cv2.COLOR_BGR2GRAY)
    edges = cv2.convertScaleAbs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)).astype(np.float32)
    m = feather(smoothstep(10, 36, edges), 2)[..., None] * (0.3 + 0.6 * keep_detail)
    return (out * (1 - m) + bgr8 * m).astype(np.uint8)


def sharpen(bgr8, amount, skin, faces, extra=0.0):
    """Unsharp mask under an edge mask; skin protected; halos limited by clamping the added detail."""
    import cv2
    import numpy as np
    total = min(1.0, amount + extra)
    if total <= 0:
        return bgr8
    blur = cv2.GaussianBlur(bgr8, (0, 0), 1.1)
    gray = cv2.cvtColor(bgr8, cv2.COLOR_BGR2GRAY)
    edges = cv2.convertScaleAbs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)).astype("float32")
    m = feather(smoothstep(6, 30, edges), 1) * (1 - 0.75 * skin)
    k = 0.3 + 1.2 * total
    detail = (bgr8.astype("float32") - blur.astype("float32")) * (k * m)[..., None]
    detail = np.clip(detail, -18, 18)
    return (bgr8.astype("float32") + detail).clip(0, 255).astype("uint8")


def remove_objects(bgr8, masks):
    import cv2
    import numpy as np
    h, w = bgr8.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    for rect in masks:
        x0, y0 = int(rect["x"] * w), int(rect["y"] * h)
        x1, y1 = int((rect["x"] + rect["w"]) * w), int((rect["y"] + rect["h"]) * h)
        mask[max(0, y0):min(h, y1), max(0, x0):min(w, x1)] = 255
    if not mask.any():
        return bgr8
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    return cv2.inpaint(bgr8, mask, 7, cv2.INPAINT_TELEA)


def suggest_distractions(bgr8, faces):
    """Background people: small faces well away from the main subjects, each proposed as a body
    rectangle (fractions). A proposal, never applied by itself."""
    h, w = bgr8.shape[:2]
    if len(faces) < 2:
        return []
    sizes = [(f["box"][2] - f["box"][0]) for f in faces]
    main = max(sizes)
    masks = []
    for face, size in zip(faces, sizes):
        if size > main * 0.45 or size > w * 0.08:
            continue
        x0, y0, x1, y1 = face["box"]
        fw, fh = x1 - x0, y1 - y0
        bx0, by0 = max(0.0, (x0 - fw * 1.0) / w), max(0.0, (y0 - fh * 0.6) / h)
        bx1, by1 = min(1.0, (x1 + fw * 1.0) / w), min(1.0, (y1 + fh * 5.0) / h)
        masks.append({"x": round(bx0, 4), "y": round(by0, 4), "w": round(bx1 - bx0, 4), "h": round(by1 - by0, 4)})
    return masks[:12]


def enhance_sky(bgr8, settings, mask, notes):
    import numpy as np
    if mask is None:
        notes.append("Enhance Sky: no sky was found in this photo.")
        return bgr8
    strength = settings.get("strength", 50) / 100.0
    exposure = settings.get("exposure", 0) / 100.0
    warmth = settings.get("warmth", 0) / 100.0
    rgb = bgr8[..., ::-1].astype(np.float32) / 255.0
    lum = luminance(rgb)
    recovered = rgb - (0.25 * strength) * smoothstep(0.75, 1.0, lum)[..., None] * rgb
    if exposure:
        recovered = linear_to_srgb(srgb_to_linear(recovered) * (2.0 ** (exposure * 1.2)))
    l = luminance(recovered)[..., None]
    graded = l + (recovered - l) * (1 + 0.4 * strength)
    graded = 0.5 + (graded - 0.5) * (1 + 0.18 * strength)
    graded = graded * np.array([1 - 0.04 * strength + 0.12 * warmth, 1.0 + 0.02 * warmth, 1 + 0.05 * strength - 0.12 * warmth], dtype=np.float32)
    out = rgb * (1 - mask[..., None]) + np.clip(graded, 0, 1) * mask[..., None]
    return (out[..., ::-1] * 255).clip(0, 255).astype(np.uint8)


def subject_mask(bgr8, faces, notes):
    import cv2
    import numpy as np
    h, w = bgr8.shape[:2]
    if not faces:
        notes.append("Background: no person was found to separate from the background.")
        return None
    scale = min(1.0, 900.0 / max(h, w))
    small = cv2.resize(bgr8, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    mask = np.full((sh, sw), cv2.GC_PR_BGD, dtype=np.uint8)
    for face in faces:
        x0, y0, x1, y1 = [v * scale for v in face["box"]]
        fw, fh = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        cv2.ellipse(mask, (int(cx), int(cy)), (max(1, int(fw * 1.1)), max(1, int(fh * 1.3))), 0, 0, 360, int(cv2.GC_PR_FGD), -1)
        cv2.ellipse(mask, (int(cx), int(cy + fh * 2.6)), (max(1, int(fw * 1.9)), max(1, int(fh * 2.6))), 0, 0, 360, int(cv2.GC_PR_FGD), -1)
        cv2.ellipse(mask, (int(cx), int(cy)), (max(1, int(fw * 0.4)), max(1, int(fh * 0.5))), 0, 0, 360, int(cv2.GC_FGD), -1)
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)
    try:
        # GrabCut seeds its colour models with k-means from OpenCV's own random generator: pinned,
        # so the same photo and recipe render the same bytes twice.
        cv2.setRNGSeed(7)
        cv2.grabCut(small, mask, None, bg_model, fg_model, 4, cv2.GC_INIT_WITH_MASK)
    except cv2.error as error:
        notes.append(f"Background: the subject could not be separated ({error}).")
        return None
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.float32)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    fg = cv2.resize(fg, (w, h), interpolation=cv2.INTER_LINEAR)
    return feather(fg, max(7, min(h, w) // 80))


def edit_background(bgr8, settings, faces, notes):
    import cv2
    import numpy as np
    brightness = settings.get("brightness", 0) / 100.0
    blur = settings.get("blur", 0) / 100.0
    calm = settings.get("calm", 0) / 100.0
    if not brightness and not blur and not calm:
        return bgr8
    fg = subject_mask(bgr8, faces, notes)
    if fg is None:
        return bgr8
    bg = 1 - fg
    out = bgr8.astype(np.float32)
    if blur:
        blurred = cv2.GaussianBlur(bgr8, (0, 0), 2 + 18 * blur).astype(np.float32)
        out = out * fg[..., None] + blurred * bg[..., None]
    if calm:
        soft = cv2.GaussianBlur(out.clip(0, 255).astype(np.uint8), (0, 0), 1.5).astype(np.float32)
        grey = out.mean(axis=2, keepdims=True)
        calmed = (out * (1 - 0.35 * calm) + grey * (0.35 * calm)) * (1 - 0.4 * calm) + soft * (0.4 * calm)
        out = out * fg[..., None] + calmed * bg[..., None]
    if brightness:
        gain = 2.0 ** (brightness * 1.2)
        out = out * (1 + (gain - 1) * bg[..., None])
    return out.clip(0, 255).astype(np.uint8)


def retouch_faces(bgr8, settings, faces, skin, notes, style_skin=0.0):
    import cv2
    import numpy as np
    if not faces:
        notes.append("Skin Retouch: no face was found in this photo.")
        return bgr8
    out = bgr8.astype(np.float32)
    region = face_region_mask(bgr8.shape, faces)
    skin_in_face = np.clip(skin * region, 0, 1)
    smoothing = min(1.0, settings.get("smoothing", 0) / 100.0 + style_skin)
    blemishes = settings.get("blemishes", 0) / 100.0
    shine = settings.get("shine", 0) / 100.0
    skin_exposure = settings.get("exposure", 0) / 100.0
    if skin_exposure:
        gain = 2.0 ** (skin_exposure * 0.6)
        out = out * (1 + (gain - 1) * skin_in_face[..., None])
    if shine:
        hsv = cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        spec = smoothstep(200, 245, hsv[..., 2]) * (1 - smoothstep(40, 90, hsv[..., 1])) * skin_in_face
        local = cv2.GaussianBlur(out.clip(0, 255).astype(np.uint8), (0, 0), 9).astype(np.float32)
        m = feather(spec, 3)[..., None] * shine * 0.8
        out = out * (1 - m) + local * m
    if smoothing or blemishes:
        base = cv2.bilateralFilter(out.clip(0, 255).astype(np.uint8), 0, 18 + 36 * smoothing, 4 + 6 * smoothing).astype(np.float32)
        detail = out - base
        if blemishes:
            median = cv2.medianBlur(out.clip(0, 255).astype(np.uint8), 5 if blemishes < 0.5 else 7).astype(np.float32)
            spot = np.abs(detail).sum(axis=2)
            specks = feather(smoothstep(18, 50, spot), 2)[..., None] * blemishes
            out = out * (1 - specks * skin_in_face[..., None]) + median * specks * skin_in_face[..., None]
            detail = out - base
        smoothed = base + detail * (1 - 0.55 * smoothing)
        out = out * (1 - skin_in_face[..., None]) + smoothed * skin_in_face[..., None]
    skin_tone = settings.get("skinTone", 0) / 100.0
    if skin_tone and float(skin_in_face.sum()) > 200:
        lab = cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
        w = skin_in_face[..., None]
        mean = (lab * w).reshape(-1, 3).sum(axis=0) / float(w.sum())
        lab[..., 1:] = lab[..., 1:] + (mean[1:] - lab[..., 1:]) * (0.5 * skin_tone) * w
        out = cv2.cvtColor(lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)
    under_eyes = settings.get("underEyes", 0) / 100.0
    teeth = settings.get("teeth", 0) / 100.0
    landmarks_used = False
    for face in faces:
        marks = face.get("landmarks")
        if not marks:
            continue
        landmarks_used = True
        pts = np.array(marks, dtype=np.float32)
        eye_h = float(np.linalg.norm(pts[36] - pts[39])) * 0.45
        if under_eyes:
            for eye in (pts[36:42], pts[42:48]):
                lower = eye[3:6]
                bag = np.array([[p[0], p[1] + eye_h * 0.35] for p in lower] + [[p[0], p[1] + eye_h * 1.4] for p in lower[::-1]])
                m = feather(polygon_mask(bgr8.shape, bag), int(max(2, eye_h * 0.4)))[..., None]
                # Worked on the mask's box only: the lift is per pixel and the mask is 0 outside it.
                box = mask_box(m)
                if box is None:
                    continue
                o, mb = out[box], m[box]
                lifted = o * (1 + 0.16 * under_eyes)
                lifted[..., 0] = lifted[..., 0] * (1 - 0.05 * under_eyes)
                out = out.copy()
                out[box] = o * (1 - mb) + lifted * mb
        if teeth:
            out = whiten_teeth(out, pts, teeth)
    if (under_eyes or teeth) and not landmarks_used:
        notes.append(f"Skin Retouch: under-eye correction and teeth whitening need {LANDMARK_MISSING}; the rest was applied.")
    return out.clip(0, 255).astype(np.uint8)


def enhance_faces(bgr8, settings, faces, notes):
    import cv2
    import numpy as np
    if not faces:
        notes.append("Face Enhancement: no face was found in this photo.")
        return bgr8
    out = bgr8.astype(np.float32)
    brightness = settings.get("brightness", 0) / 100.0
    eyes = settings.get("eyes", 0) / 100.0
    detail = settings.get("detail", 0) / 100.0
    region = face_region_mask(bgr8.shape, faces, grow=0.2)
    if brightness:
        gain = 2.0 ** (0.45 * brightness)
        out = out * (1 + (gain - 1) * region[..., None])
    if detail:
        blur = cv2.GaussianBlur(out.clip(0, 255).astype(np.uint8), (0, 0), 1.5).astype(np.float32)
        out = out + np.clip((out - blur) * (0.7 * detail), -14, 14) * region[..., None]
    landmarks_used = False
    if eyes:
        for face in faces:
            marks = face.get("landmarks")
            if not marks:
                continue
            landmarks_used = True
            pts = np.array(marks, dtype=np.float32)
            for eye in (pts[36:42], pts[42:48]):
                grow = int(max(2, np.linalg.norm(eye[0] - eye[3]) * 0.25))
                m = feather(polygon_mask(bgr8.shape, eye, grow), grow)[..., None]
                # Worked on the eye's box with a margin wider than the blur's reach, so every pixel
                # under the mask sees the same neighbours as on the whole frame; the margin itself
                # is under a 0 mask and passes unchanged.
                box = mask_box(m, EYE_BLUR_MARGIN)
                if box is None:
                    continue
                o, mb = out[box], m[box]
                blur = cv2.GaussianBlur(o.clip(0, 255).astype(np.uint8), (0, 0), 1.0).astype(np.float32)
                sharp = o + np.clip((o - blur) * (1.1 * eyes), -16, 16)
                sharp = 128 + (sharp - 128) * (1 + 0.22 * eyes)
                sharp = sharp * (1 + 0.07 * eyes)
                out = out.copy()
                out[box] = o * (1 - mb) + sharp * mb
        if not landmarks_used:
            notes.append(f"Face Enhancement: eye enhancement needs {LANDMARK_MISSING}; face exposure and detail were applied.")
    return out.clip(0, 255).astype(np.uint8)


def auto_crop(bgr8, aspect_id, faces, notes):
    import cv2
    import numpy as np
    h, w = bgr8.shape[:2]
    ratio = ASPECTS.get(aspect_id)
    if ratio is None:
        return bgr8
    if w / h > ratio:
        ch, cw = h, int(round(h * ratio))
    else:
        cw, ch = w, int(round(w / ratio))
    cw, ch = max(1, min(w, cw)), max(1, min(h, ch))
    if faces:
        xs0 = min(f["box"][0] for f in faces); ys0 = min(f["box"][1] for f in faces)
        xs1 = max(f["box"][2] for f in faces); ys1 = max(f["box"][3] for f in faces)
        fh = ys1 - ys0
        cx = (xs0 + xs1) / 2
        cy = (ys0 + ys1) / 2 + ch * 0.17
        if (xs1 - xs0) > cw * 0.9 or (ys1 - ys0 + fh) > ch * 0.9:
            notes.append("Smart Crop: the faces fill the frame at that aspect, so the crop is centred on them as tightly as it can be.")
    else:
        gray = cv2.cvtColor(bgr8, cv2.COLOR_BGR2GRAY)
        energy = cv2.GaussianBlur(cv2.convertScaleAbs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)).astype(np.float32), (0, 0), max(3, min(w, h) / 40))
        ys, xs = np.indices(energy.shape)
        total = float(energy.sum()) + 1e-6
        cx, cy = float((xs * energy).sum() / total), float((ys * energy).sum() / total)
    x0 = int(round(np.clip(cx - cw / 2, 0, w - cw)))
    y0 = int(round(np.clip(cy - ch / 2, 0, h - ch)))
    return bgr8[y0:y0 + ch, x0:x0 + cw]



def whiten_teeth(out, pts, amount):
    """Restrained whitening of the visible teeth: the bright pixels inside the inner-mouth polygon
    lose saturation and gain a little light; gums, lips and the skin around are outside the mask."""
    import cv2
    import numpy as np
    inner = pts[60:68]
    if cv2.contourArea(inner.astype(np.int32)) <= 4:
        return out
    m = feather(polygon_mask(out.shape, inner), 1)
    hsv = cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
    bright = smoothstep(110, 170, hsv[..., 2]) * m
    hsv[..., 1] = hsv[..., 1] * (1 - 0.6 * amount * bright)
    hsv[..., 2] = np.clip(hsv[..., 2] * (1 + 0.12 * amount * bright), 0, 255)
    whitened = cv2.cvtColor(hsv.clip(0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
    # Blended by the mask, so the 8-bit colour-space round trip touches nothing outside the mouth.
    return blend(out, whitened, m)


# ------------------------------------------------------------------------------ region retouching
RETOUCH_TOOLS = ("facialSkin", "bodySkin", "eyebrows", "eyeSclera", "irisPupil", "lips", "teeth", "hair", "facialHair", "clothes")
# The five that need the 68-point landmarks; the rest work from the face boxes and the masks.
LANDMARK_TOOLS = ("eyebrows", "eyeSclera", "irisPupil", "lips", "teeth")
RETOUCH_LABELS = {"facialSkin": "Facial Skin", "bodySkin": "Body Skin", "eyebrows": "Eyebrows", "eyeSclera": "Eye Sclera", "irisPupil": "Iris and Pupil", "lips": "Lips", "teeth": "Teeth", "hair": "Hair", "facialHair": "Facial Hair", "clothes": "Clothes"}


def amount_of(tools, name):
    """The tool's intensity 0..1, 0 when it is off."""
    if name not in tools:
        return 0.0
    return min(1.0, max(0.0, float((tools.get(name) or {}).get("amount", 0)) / 100.0))


# Face Enhancement's eye pass blurs at sigma 1.0, which reaches 3 px on an 8-bit frame; the box it
# works on is grown by more than that.
EYE_BLUR_MARGIN = 8


def mask_box(mask, pad=0):
    """The rows and columns where `mask` is not zero, grown by `pad` and kept inside the frame, as a
    pair of slices; None when the mask is empty. A masked step worked only inside this box gives the
    same numbers as over the whole frame - outside it the mask is 0 and the pixels pass unchanged."""
    m = mask.any(axis=2) if mask.ndim == 3 else mask
    rows = np.flatnonzero(m.any(axis=1))
    if not rows.size:
        return None
    cols = np.flatnonzero(m.any(axis=0))
    h, w = m.shape[:2]
    return slice(max(0, int(rows[0]) - pad), min(h, int(rows[-1]) + 1 + pad)), slice(max(0, int(cols[0]) - pad), min(w, int(cols[-1]) + 1 + pad))


def blend(out, replacement, mask):
    m = np.clip(mask, 0, 1)[..., None] if hasattr(mask, "ndim") and mask.ndim == 2 else mask
    if not hasattr(m, "ndim") or m.ndim != 3:
        return out * (1 - m) + replacement * m
    # Only the mask's own box is worked: a face-sized mask over a 3000 px frame no longer costs a
    # whole-frame pass, and every pixel outside the box is `out` exactly, as before.
    result = out.astype(np.result_type(out, replacement, m), copy=True)
    box = mask_box(m)
    if box is not None:
        ys, xs = box
        result[ys, xs] = out[ys, xs] * (1 - m[ys, xs]) + replacement[ys, xs] * m[ys, xs]
    return result


def to8(out):
    return out.clip(0, 255).astype("uint8")


def even_skin(out, region, amount):
    """Blemish correction that keeps the pores: specks (sharp, small departures from the local skin)
    are replaced by the median; then the low-frequency tone is evened a little while the fine detail
    is put back untouched. Skin that was clean is left as it was."""
    import cv2
    import numpy as np
    if amount <= 0 or float(region.sum()) < 50:
        return out
    img8 = to8(out)
    low = cv2.GaussianBlur(img8, (0, 0), 5).astype(np.float32)
    high = out - low
    spot = np.abs(high).sum(axis=2)
    specks = feather(smoothstep(22, 60, spot), 2) * amount * region
    median = cv2.medianBlur(img8, 5 if amount < 0.6 else 7).astype(np.float32)
    out = blend(out, median, specks)
    low = cv2.GaussianBlur(to8(out), (0, 0), 5).astype(np.float32)
    high = out - low
    wide = cv2.GaussianBlur(low, (0, 0), 16)
    evened = wide + high
    return blend(out, evened, region * (0.35 * amount))


def speck_cleanup(out, region, amount, threshold=(26, 70)):
    """Lint, dust and small marks: the sharp small departures inside a plain region replaced by the
    median, the region's own texture and pattern left alone (a seam or a print is not a speck)."""
    import cv2
    import numpy as np
    if amount <= 0 or float(region.sum()) < 50:
        return out
    img8 = to8(out)
    low = cv2.GaussianBlur(img8, (0, 0), 4).astype(np.float32)
    spot = np.abs(out - low).sum(axis=2)
    specks = feather(smoothstep(threshold[0], threshold[1], spot), 1) * amount * region
    median = cv2.medianBlur(img8, 5).astype(np.float32)
    return blend(out, median, specks)


def head_mask(shape, faces):
    """The head outline above and around each face box: where the hair is, with the face itself cut out."""
    import cv2
    import numpy as np
    h, w = shape[:2]
    head = np.zeros((h, w), dtype=np.float32)
    for face in faces:
        x0, y0, x1, y1 = face["box"]
        fw, fh = x1 - x0, y1 - y0
        cv2.ellipse(head, (int((x0 + x1) / 2), int((y0 + y1) / 2 - fh * 0.18)), (max(1, int(fw * 0.95)), max(1, int(fh * 1.05))), 0, 0, 360, 1.0, -1)
    return head


def brow_masks(shape, pts, eye_w):
    """Each brow as a band around its five landmarks, as thick as the brow is."""
    import numpy as np
    masks = []
    for brow in (pts[17:22], pts[22:27]):
        half = max(2.0, eye_w * 0.2)
        upper = [[p[0], p[1] - half] for p in brow]
        lower = [[p[0], p[1] + half] for p in brow[::-1]]
        masks.append(feather(polygon_mask(shape, np.array(upper + lower, dtype=np.float32)), int(max(1, eye_w * 0.08))))
    return masks


def iris_disc(gray, shape, eye_poly):
    """The iris and pupil: the dark disc inside the eye polygon - the darkest third of the eye,
    opened, its largest piece filled - and nothing when the eye is closed or too small."""
    import cv2
    import numpy as np
    eye = polygon_mask(shape, eye_poly) > 0
    if eye.sum() < 30:
        return None
    values = gray[eye]
    dark = (gray < np.percentile(values, 35)) & eye
    dark = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(dark)
    if count < 2:
        return None
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[biggest, cv2.CC_STAT_AREA] < 12:
        return None
    piece = (labels == biggest).astype(np.uint8)
    contours, _ = cv2.findContours(piece, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    disc = np.zeros(shape[:2], dtype=np.float32)
    cv2.fillPoly(disc, [cv2.convexHull(contours[0])], 1.0)
    return disc * eye.astype(np.float32)


def retouch_regions(bgr8, tools, faces, skin, notes):
    """The ten region tools, each confined to its own mask; answers the frame and, per tool, how much
    of the frame it touched (`coverage`) so a render can say what it found."""
    import cv2
    import numpy as np
    out = bgr8.astype(np.float32)
    report = {}
    h, w = bgr8.shape[:2]
    frame = float(h * w)
    amounts = {name: amount_of(tools, name) for name in RETOUCH_TOOLS}
    wanted = [name for name in RETOUCH_TOOLS if amounts[name] > 0]
    if not wanted:
        return bgr8, report
    gray = cv2.cvtColor(bgr8, cv2.COLOR_BGR2GRAY)
    if not faces:
        # Body skin can still be found without a face (every skin-coloured area is then body
        # skin); the rest, clothes included - the subject outline is seeded from the faces - cannot.
        for name in wanted:
            if name != "bodySkin":
                notes.append(f"{RETOUCH_LABELS[name]}: no face was found in this photo, so it was left as shot.")
                report[name] = {"coverage": 0.0, "found": False}
    face_region = face_region_mask(bgr8.shape, faces) if faces else np.zeros((h, w), dtype=np.float32)
    head = head_mask(bgr8.shape, faces) if faces else np.zeros((h, w), dtype=np.float32)
    subject = None
    if faces and any(amounts[name] > 0 for name in ("bodySkin", "hair", "clothes")):
        subject = subject_mask(bgr8, faces, [])

    def touched(name, mask):
        coverage = float(np.clip(mask, 0, 1).sum() / frame)
        report[name] = {"coverage": round(coverage, 5), "found": coverage > 0}
        return coverage > 0

    if amounts["facialSkin"] and faces:
        region = np.clip(skin * face_region, 0, 1)
        if touched("facialSkin", region):
            out = even_skin(out, region, amounts["facialSkin"])
        else:
            notes.append("Facial Skin: no skin was found inside the faces.")
    if amounts["bodySkin"]:
        beyond = np.clip(skin * (1 - face_region_mask(bgr8.shape, faces, grow=0.7, extra_top=0.6)), 0, 1) if faces else skin
        if subject is not None:
            beyond = beyond * np.clip(subject, 0, 1)
        if touched("bodySkin", beyond):
            out = even_skin(out, beyond, amounts["bodySkin"] * 0.8)
        else:
            notes.append("Body Skin: no skin beyond the face was found in this photo.")

    landmark_wanted = [name for name in wanted if name in LANDMARK_TOOLS]
    if faces and landmark_wanted:
        marks_used = False
        # Skin Retouch's own teeth slider and the Teeth tool are one step, at the stronger amount.
        teeth_amount = max(amounts["teeth"], (tools.get("retouchFace") or {}).get("teeth", 0) / 100.0)
        masks = {name: np.zeros((h, w), dtype=np.float32) for name in landmark_wanted}
        for face in faces:
            marks = face.get("landmarks")
            if not marks:
                continue
            marks_used = True
            pts = np.array(marks, dtype=np.float32)
            eye_w = float(np.linalg.norm(pts[36] - pts[39]))
            if "eyebrows" in masks:
                for m in brow_masks(bgr8.shape, pts, eye_w):
                    masks["eyebrows"] = np.maximum(masks["eyebrows"], m)
            if "eyeSclera" in masks or "irisPupil" in masks:
                for eye in (pts[36:42], pts[42:48]):
                    disc = iris_disc(gray, bgr8.shape, eye)
                    whole = feather(polygon_mask(bgr8.shape, eye), 1)
                    if disc is not None:
                        if "irisPupil" in masks:
                            masks["irisPupil"] = np.maximum(masks["irisPupil"], feather(disc, 1))
                        if "eyeSclera" in masks:
                            grown = cv2.dilate(disc, np.ones((5, 5), np.uint8))
                            masks["eyeSclera"] = np.maximum(masks["eyeSclera"], np.clip(whole - grown, 0, 1))
            if "lips" in masks:
                outer = polygon_mask(bgr8.shape, pts[48:60])
                inner = cv2.dilate(polygon_mask(bgr8.shape, pts[60:68]), np.ones((3, 3), np.uint8))
                masks["lips"] = np.maximum(masks["lips"], feather(np.clip(outer - inner, 0, 1), 1))
            if "teeth" in masks and teeth_amount:
                out = whiten_teeth(out, pts, teeth_amount)
                masks["teeth"] = np.maximum(masks["teeth"], polygon_mask(bgr8.shape, pts[60:68]))
        if not marks_used:
            for name in landmark_wanted:
                report[name] = {"coverage": 0.0, "found": False}
            notes.append(f"Eyebrows, eye, lip and teeth retouching need {LANDMARK_MISSING}; the rest was applied.")
        else:
            if "eyebrows" in masks and touched("eyebrows", masks["eyebrows"]):
                a = amounts["eyebrows"]
                m = masks["eyebrows"]
                lab = cv2.cvtColor(to8(out), cv2.COLOR_BGR2LAB).astype(np.float32)
                fine = cv2.GaussianBlur(lab[..., 0], (0, 0), 1.0)
                lab[..., 0] = lab[..., 0] * (1 - 0.10 * a * m) + np.clip((lab[..., 0] - fine) * (0.6 * a), -10, 10) * m
                out = blend(out, cv2.cvtColor(lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32), m)
            if "eyeSclera" in masks:
                a = amounts["eyeSclera"]
                hsv = cv2.cvtColor(to8(out), cv2.COLOR_BGR2HSV).astype(np.float32)
                # The whites only: lashes, lid shadow and the iris edge are darker and stay out.
                m = masks["eyeSclera"] * smoothstep(70, 120, hsv[..., 2])
                if touched("eyeSclera", m):
                    hsv[..., 1] = hsv[..., 1] * (1 - 0.5 * a * m)
                    hsv[..., 2] = np.clip(hsv[..., 2] * (1 + 0.10 * a * m), 0, 252)
                    out = blend(out, cv2.cvtColor(hsv.clip(0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32), m)
                else:
                    notes.append("Eye Sclera: the whites of the eyes could not be made out (closed, or too small).")
            if "irisPupil" in masks:
                if touched("irisPupil", masks["irisPupil"]):
                    a = amounts["irisPupil"]
                    m = masks["irisPupil"]
                    lab = cv2.cvtColor(to8(out), cv2.COLOR_BGR2LAB).astype(np.float32)
                    L = lab[..., 0]
                    fine = cv2.GaussianBlur(L, (0, 0), 1.2)
                    mean = float((L * m).sum() / max(1.0, float(m.sum())))
                    deeper = mean + (L - mean) * (1 + 0.18 * a) + np.clip((L - fine) * (0.9 * a), -12, 12)
                    lab[..., 0] = L * (1 - m) + np.clip(deeper, 0, 255) * m
                    out = blend(out, cv2.cvtColor(lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32), m)
                else:
                    notes.append("Iris and Pupil: the iris could not be made out (closed eyes, or too small).")
            if "lips" in masks and touched("lips", masks["lips"]):
                a = amounts["lips"]
                m = masks["lips"]
                img8 = to8(out)
                smooth = cv2.bilateralFilter(img8, 0, 22, 4)
                lab = cv2.cvtColor(img8, cv2.COLOR_BGR2LAB).astype(np.float32)
                lab_s = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB).astype(np.float32)
                # Lightness is smoothed; the colour channels are the lips' own.
                lab[..., 0] = lab[..., 0] * (1 - 0.55 * a * m) + lab_s[..., 0] * (0.55 * a * m)
                out = blend(out, cv2.cvtColor(lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32), m)
            if "teeth" in masks and not touched("teeth", masks["teeth"]):
                notes.append("Teeth: no open mouth was found, so nothing was whitened.")

    if amounts["hair"] and faces:
        a = amounts["hair"]
        hair = np.clip(head * (1 - face_region_mask(bgr8.shape, faces, grow=0.05, extra_top=0.0)) * (1 - skin), 0, 1)
        if subject is not None:
            hair = hair * np.clip(subject, 0, 1)
        hair_bin = (hair > 0.5).astype(np.uint8)
        if touched("hair", hair):
            k = max(5, min(h, w) // 120)
            outer = cv2.dilate(hair_bin, np.ones((2 * k + 1, 2 * k + 1), np.uint8)) - hair_bin
            # Flyaways: thin bright or dark strands against what is behind them.
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
            thin = np.maximum(cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel), cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)).astype(np.float32)
            strands = feather(smoothstep(10, 30, thin) * outer.astype(np.float32), 2)
            median = cv2.medianBlur(to8(out), 7 if a < 0.6 else 9).astype(np.float32)
            out = blend(out, median, strands * (0.9 * a))
        else:
            notes.append("Hair: no hair region was found around the faces.")

    if amounts["facialHair"] and faces:
        a = amounts["facialHair"]
        region = np.zeros((h, w), dtype=np.float32)
        for face in faces:
            marks = face.get("landmarks")
            if not marks:
                continue
            pts = np.array(marks, dtype=np.float32)
            lower = polygon_mask(bgr8.shape, np.concatenate([pts[2:15], pts[35:36], pts[33:34], pts[31:32]]))
            mouth = cv2.dilate(polygon_mask(bgr8.shape, pts[48:60]), np.ones((7, 7), np.uint8))
            region = np.maximum(region, np.clip(lower - mouth, 0, 1))
        if float(region.sum()) == 0 and faces:
            notes.append(f"Facial Hair: needs {LANDMARK_MISSING}.")
            report["facialHair"] = {"coverage": 0.0, "found": False}
        else:
            # Beard and moustache: the lower face that is not skin, or darker and more textured than the skin.
            texture = cv2.GaussianBlur(np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)), (0, 0), 2)
            skin_lum = float(np.median(gray[(skin * face_region) > 0.5])) if ((skin * face_region) > 0.5).sum() > 50 else 128.0
            hairy = np.clip((1 - skin) + smoothstep(8, 24, texture) * (gray < skin_lum * 0.8), 0, 1) * region
            hairy = feather(hairy, 3)
            if float(hairy.sum()) / max(1.0, float(region.sum())) > 0.04 and touched("facialHair", hairy):
                # Denoised on the lower face's own box with a margin, never the whole frame: non-local
                # means over a 3000 px photo would take the render past its timeout.
                ys, xs = np.where(hairy > 0.01)
                y0, y1 = max(0, int(ys.min()) - 12), min(h, int(ys.max()) + 13)
                x0, x1 = max(0, int(xs.min()) - 12), min(w, int(xs.max()) + 13)
                crop = to8(out)[y0:y1, x0:x1]
                cleaned = out.copy()
                cleaned[y0:y1, x0:x1] = cv2.fastNlMeansDenoisingColored(crop, None, 3 + 6 * a, 3 + 6 * a, 7, 21).astype(np.float32)
                out = blend(out, cleaned, hairy * (0.7 * a))
            else:
                report["facialHair"] = {"coverage": 0.0, "found": False}
                notes.append("Facial Hair: no beard or moustache was found.")

    if amounts["clothes"] and faces:
        a = amounts["clothes"]
        if subject is None:
            subject = subject_mask(bgr8, faces, [])
        if subject is None:
            report["clothes"] = {"coverage": 0.0, "found": False}
            notes.append("Clothes: the person could not be separated from the background, so the clothes were left as shot.")
        else:
            not_head = 1 - cv2.dilate(np.maximum(head, face_region), np.ones((9, 9), np.uint8))
            clothes = np.clip(subject * (1 - skin) * not_head, 0, 1)
            texture = cv2.GaussianBlur(np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)), (0, 0), 3)
            plain = clothes * (1 - smoothstep(9, 22, texture))
            if touched("clothes", plain):
                out = speck_cleanup(out, plain, a)
            else:
                notes.append("Clothes: no plain clothing area was found to clean.")
    return to8(out), report


# ------------------------------------------------------------------------------------------ render
def decode(data, max_edge):
    import cv2
    import numpy as np
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as header:
            width, height = header.size
        if width * height > MAX_SOURCE_PIXELS:
            raise ValueError(f"the photo is too large to edit ({width}x{height})")
    except ValueError:
        raise
    except Exception:
        pass
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("the photo could not be decoded")
    h, w = image.shape[:2]
    scale = min(1.0, float(max_edge) / max(h, w))
    if scale < 1:
        image = cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    return image


def render(data, recipe, reference, max_edge, scene_hint=None, progress=None):
    import cv2
    import numpy as np
    rng = np.random.default_rng(7)
    notes = []
    say = progress or (lambda stage: None)
    say("Analyzing image")
    bgr = decode(data, max_edge)
    adjustments = dict(recipe.get("adjustments") or {})
    advanced = recipe.get("advanced") or {}
    hsl = {band: dict((advanced.get("hsl") or {}).get(band) or {}) for band in HSL_BANDS}
    balance = {name: dict((advanced.get("colorBalance") or {}).get(name) or {}) for name in ("shadows", "midtones", "highlights")}
    for name in balance:
        for ch in ("r", "g", "b"):
            balance[name].setdefault(ch, 0)
    detail = advanced.get("detail") or {}
    tools = recipe.get("tools") or {}
    style = recipe.get("style") or "natural"
    applied = {"style": style, "adjustments": {}, "advanced": {"hsl": hsl, "colorBalance": balance, "detail": detail}, "tools": tools, "reference": recipe.get("reference")}

    faces = FACES.detect(bgr)
    if not FACES.ready() and any(tool in tools for tool in ("retouchFace", "faceEnhance", "background", "autoCrop") + RETOUCH_TOOLS):
        notes.append(f"Face tools are unavailable on this server ({FACES.error or 'face engine not ready'}).")
    sky = sky_mask(bgr)
    # The skin mask is measured once and shared with the analysis; it is measured again only when
    # Remove Object or Denoise has changed the frame it was read from.
    analyzed = bgr
    skin = skin_mask(bgr)
    a = analyze(bgr, faces, sky, scene_hint, skin=skin)
    applied["analysis"] = a

    if "removeObject" in tools:
        say("Removing distractions")
        bgr = remove_objects(bgr, tools["removeObject"].get("masks") or [])
    if "denoise" in tools:
        say("Reducing noise")
        bgr = denoise(bgr, tools["denoise"].get("strength", 50) / 100.0, tools["denoise"].get("detail", 60) / 100.0)
    if bgr is not analyzed:
        skin = skin_mask(bgr)

    profile = recipe.get("referenceProfile")
    ref = None
    if recipe.get("reference") and reference is not None:
        say("Reading the reference")
        try:
            ref = decode(reference, 1400)
            profile = measure_profile(ref, FACES.detect(ref))
        except ValueError:
            notes.append("Reference: the reference photo could not be read, so it was not applied.")
    elif recipe.get("reference") and not profile:
        notes.append("Reference: no reference photo is stored on this edit yet.")
    strength = ((recipe.get("reference") or {}).get("strength", 70) / 100.0) if (recipe.get("reference") or profile) else 0.0
    if profile and strength:
        say("Matching the reference")
        adjustments, balance = apply_profile(adjustments, balance, profile, strength, a)
        applied["referenceProfile"] = profile
        applied["referenceAnalysis"] = {k: profile.get(k, 0) for k in ("exposure", "contrast", "temperature", "tint", "saturation")}
    if "colorEnhance" in tools:
        say("Balancing colour")
        bgr = color_enhance(bgr, tools["colorEnhance"].get("strength", 50) / 100.0, skin)

    say("Setting exposure")
    rgb = bgr[..., ::-1].astype(np.float32) / 255.0
    if "autoExposure" in tools or any(adjustments.get(k) is None for k in ("exposure", "highlights", "shadows", "whites", "blacks")):
        auto = auto_exposure(a)
        for key, value in auto.items():
            if "autoExposure" in tools or adjustments.get(key) is None:
                adjustments[key] = value
    if "autoWhiteBalance" in tools or any(adjustments.get(k) is None for k in ("temperature", "tint")):
        auto = auto_white_balance(a)
        for key, value in auto.items():
            if "autoWhiteBalance" in tools or adjustments.get(key) is None:
                adjustments[key] = value
    for key in ("exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "vibrance", "saturation"):
        adjustments[key] = int(adjustments.get(key) or 0)
    # What the sliders read back: the numbers the auto tools chose for the sliders left to them,
    # and the photographer's own numbers for the rest. The Auto Edit's small, scene-aware
    # contrast and vibrance push is applied to the pixels only and reported on its own
    # (`autoColor`), never written onto a slider the photographer set - otherwise every auto render
    # read as "changes not applied".
    applied["adjustments"] = dict(adjustments)
    if "autoExposure" in tools and "autoWhiteBalance" in tools and "colorEnhance" in tools:
        push = {key: value for key, value in auto_color(a).items() if not adjustments.get(key)}
        if push:
            applied["autoColor"] = push
            adjustments.update(push)

    say("Applying the style")
    rgb, extras = apply_style(rgb, style, rng, skin)
    rgb = apply_adjustments(rgb, adjustments, skin)
    rgb = apply_color_balance(rgb, balance)
    bgr = (rgb[..., ::-1] * 255).clip(0, 255).astype(np.uint8)
    merged_hsl = {band: dict(hsl[band]) for band in HSL_BANDS}
    for band, (dh, ds, dl) in (extras.get("hsl") or {}).items():
        merged_hsl[band] = {"hue": merged_hsl[band].get("hue", 0) + dh, "sat": merged_hsl[band].get("sat", 0) + ds, "lum": merged_hsl[band].get("lum", 0) + dl}
    bgr = apply_hsl(bgr, merged_hsl)
    if ref is not None and strength:
        bgr = apply_reference_transfer(bgr, ref, strength, skin)
    bgr = apply_detail(bgr, (detail.get("clarity", 0) / 100.0) + extras.get("clarity", 0), detail.get("texture", 0) / 100.0, skin)

    if "enhanceSky" in tools:
        say("Enhancing the sky")
        bgr = enhance_sky(bgr, tools["enhanceSky"], sky, notes)
    if "background" in tools:
        say("Separating the background")
        bgr = edit_background(bgr, tools["background"], faces, notes)
    if "retouchFace" in tools or extras.get("skin"):
        say("Retouching skin")
        face_settings = dict(tools.get("retouchFace") or {})
        # The Teeth region tool, when it is actually asked for, whitens once at the stronger amount.
        if amount_of(tools, "teeth") > 0:
            face_settings["teeth"] = 0
        bgr = retouch_faces(bgr, face_settings, faces, skin, notes if "retouchFace" in tools else [], style_skin=extras.get("skin", 0))
    if "faceEnhance" in tools:
        say("Enhancing faces")
        bgr = enhance_faces(bgr, tools["faceEnhance"], faces, notes)
    if any(name in tools for name in RETOUCH_TOOLS):
        say("Retouching regions")
        try:
            bgr, applied["retouch"] = retouch_regions(bgr, tools, faces, skin, notes)
        except Exception as error:
            # A degenerate polygon or an OpenCV refusal on one odd photo loses the regions, never the edit.
            log(f"region retouching failed: {type(error).__name__}: {error}")
            notes.append("Retouching: the regions could not be worked on this photo, so they were left as shot; the rest was applied.")
            applied["retouch"] = {}

    if "sharpen" in tools or extras.get("sharpen"):
        say("Sharpening")
        bgr = sharpen(bgr, ((tools.get("sharpen") or {}).get("amount", 0) / 100.0) if "sharpen" in tools else 0.0, skin, faces, extra=extras.get("sharpen", 0))
    if "autoCrop" in tools:
        say("Cropping")
        bgr = auto_crop(bgr, tools["autoCrop"].get("aspect", "original"), faces, notes)

    say("Generating preview")
    ok, encoded = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        raise ValueError("the edited photo could not be encoded")
    h, w = bgr.shape[:2]
    return {"image": base64.b64encode(encoded.tobytes()).decode("ascii"), "width": int(w), "height": int(h), "applied": applied, "notes": notes, "faces": len(faces), "analysis": a, "referenceProfile": profile}


def capabilities():
    faces_ok = FACES.ready()
    face_engine = "insightface-scrfd" if faces_ok else None
    landmarks = bool(FACES.landmarks) if faces_ok else False

    def landmark_tool():
        if not faces_ok:
            return {"available": False, "engine": None, "reason": f"face engine unavailable: {FACES.error or 'not ready'}"}
        if not landmarks:
            return {"available": False, "engine": face_engine, "reason": f"needs {LANDMARK_MISSING}"}
        return {"available": True, "engine": face_engine + "+landmarks"}

    def outline_tool(how):
        if not faces_ok:
            return {"available": False, "engine": None, "reason": f"face engine unavailable: {FACES.error or 'not ready'}"}
        return {"available": True, "engine": "heuristic outline", "partial": True, "reason": f"Approximate on this server: {how}; a face-parsing model would make the region exact. The effect stays restrained."}

    def face_tool(partial_without_landmarks):
        if not faces_ok:
            return {"available": False, "engine": None, "reason": f"face engine unavailable: {FACES.error or 'not ready'}"}
        if partial_without_landmarks and not landmarks:
            return {"available": True, "engine": face_engine, "partial": True, "reason": f"eye, under-eye and teeth steps are skipped: they need {LANDMARK_MISSING}"}
        return {"available": True, "engine": face_engine + ("+landmarks" if landmarks else "")}

    return {
        "engine": ENGINE, "version": VERSION,
        "tools": {
            "autoExposure": {"available": True, "engine": "scene-aware histogram, face key"},
            "autoWhiteBalance": {"available": True, "engine": "neutral mid-tones, skin excluded, cast named"},
            "colorEnhance": {"available": True, "engine": "clahe + balance, skin-weighted"},
            "retouchFace": face_tool(True),
            "faceEnhance": face_tool(True),
            "denoise": {"available": True, "engine": "opencv-nlmeans luma/chroma"},
            "sharpen": {"available": True, "engine": "unsharp-mask, halo-limited"},
            "removeObject": {"available": True, "engine": "opencv-inpaint", "note": "classical inpainting: best for wires, poles and small distractions; Suggest proposes background people", "suggest": faces_ok},
            "enhanceSky": {"available": True, "engine": "heuristic-sky-mask"},
            "background": {"available": faces_ok, "engine": "grabcut" if faces_ok else None, "reason": None if faces_ok else "needs the face engine to find the subject"},
            "autoCrop": {"available": True, "engine": "face-aware" if faces_ok else "energy-weighted"},
            "facialSkin": face_tool(False),
            "bodySkin": {"available": True, "engine": "skin mask" + (" + subject outline" if faces_ok else ""), "note": "Visible skin beyond the face, inside the person's outline; clothes and background are left alone." if faces_ok else "Without the face engine every skin-coloured area counts as body skin."},
            "eyebrows": landmark_tool(),
            "eyeSclera": landmark_tool(),
            "irisPupil": landmark_tool(),
            "lips": landmark_tool(),
            "teeth": landmark_tool(),
            "hair": outline_tool("the hair is the band around the head outline"),
            "facialHair": outline_tool("facial hair is the textured, non-skin part of the lower face") if landmarks else {"available": False, "engine": None, "reason": "needs the 68-point landmark model to find the lower face"},
            "clothes": outline_tool("clothes are the person's outline minus skin and head, plain areas only"),
            "reference": {"available": True, "engine": "measured editing profile + lab transfer"},
            "styles": {"available": True, "engine": "tone curves, grades, hsl, skin, grain"},
            "hsl": {"available": True, "engine": "soft hue bands"},
            "colorBalance": {"available": True, "engine": "three-range split toning"},
            "scene": {"available": True, "engine": "culling CLIP label when present, else faces and light"},
        },
    }


def main():
    try:
        import numpy  # noqa: F401
        import cv2
        threads = int(os.environ.get("AI_EDIT_THREADS") or min(4, os.cpu_count() or 1))
        cv2.setNumThreads(max(1, threads))
    except Exception as error:
        print(json.dumps({"ready": False, "error": f"{type(error).__name__}: {error}"}), flush=True)
        return
    caps = capabilities()
    print(json.dumps({"ready": True, "engine": ENGINE, "version": VERSION, "capabilities": caps, "python": sys.executable}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            op = request.get("op") or "render"
            if op == "capabilities":
                print(json.dumps({"id": request_id, "result": capabilities()}), flush=True)
                continue
            if op == "profile":
                image = decode(base64.b64decode(request["image"]), 1400)
                print(json.dumps({"id": request_id, "result": measure_profile(image, FACES.detect(image))}), flush=True)
                continue
            if op == "suggest":
                image = decode(base64.b64decode(request["image"]), 2000)
                faces = FACES.detect(image)
                print(json.dumps({"id": request_id, "result": {"masks": suggest_distractions(image, faces), "faces": len(faces)}}), flush=True)
                continue
            if op != "render":
                raise ValueError(f"unknown op {op!r}")
            image = base64.b64decode(request["image"])
            reference = base64.b64decode(request["reference"]) if request.get("reference") else None

            def progress(stage, request_id=request_id):
                print(json.dumps({"id": request_id, "stage": stage}), flush=True)

            result = render(image, request.get("recipe") or {}, reference, int(request.get("maxEdge") or MAX_EDGE_DEFAULT), request.get("sceneHint"), progress)
            print(json.dumps({"id": request_id, "result": result}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request_id, "error": f"{type(error).__name__}: {error}"}), flush=True)


if __name__ == "__main__":
    main()
