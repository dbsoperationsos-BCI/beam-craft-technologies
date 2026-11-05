"""A synthetic culling dataset in the exporter's exact format, marked `"synthetic": true`.

For proving the pipeline before real runs exist - never for a production model (the registration
script refuses a bundle whose metrics say synthetic). Photographers have hidden tastes; they keep
the best one or two frames of a burst; a share of them accept the AI's call when unsure
(anchoring); some runs are Assisted (the AI decided nothing - the unanchored gold set).

    python -m culling_ml.synth --out <dir> --version synth_v1 --feature-names <file.json>
"""
import argparse
import gzip
import hashlib
import json
import os

import numpy as np

SCENES = ["GETTING_READY", "CEREMONY", "COUPLE", "PORTRAIT", "GROUP", "CANDID", "DANCE", "STAGE", "DECOR", "DETAILS", "FOOD", "VENUE", "KIDS"]


def _formula(f):
    """Today's fixed score, close enough to analysis/scoring.js for a baseline."""
    if f["face_count"] and f["face_quality"] is not None:
        score = f["technical_score"] * 0.45 + f["face_quality"] * 0.2 + f["eyes_open"] * 0.2 + f["expression"] * 0.15
    else:
        score = f["technical_score"]
    score += (f["aesthetic_score"] - 50) * 0.08 + (f["composition_score"] - 50) * 0.08
    if f["code_accidental_frame"]:
        score -= 12
    if f["is_group_best"]:
        score += 8
    elif f["in_duplicate"]:
        score -= 25
    elif f["in_burst"]:
        score -= 10
    return float(np.clip(round(score), 0, 100))


def generate(out_dir, version, feature_names, projects=120, photographers=8, seed=11, feature_set_version="features_v2"):
    rng = np.random.default_rng(seed)
    tastes = [{"candid": rng.normal(0, 0.8), "soft": rng.normal(0, 0.8), "keeps_two": bool(rng.random() < 0.4), "lazy": float(rng.uniform(0.1, 0.5))} for _ in range(photographers)]
    target = os.path.join(out_dir, version)
    os.makedirs(target, exist_ok=False)
    examples, groups, pairs = [], [], []
    for p in range(projects):
        project = f"project:{hashlib.sha256(f'p{p}'.encode()).hexdigest()[:20]}"
        bucket = int(hashlib.sha256(project.encode()).hexdigest()[:8], 16) % 100
        split = "train" if bucket < 70 else "validation" if bucket < 85 else "test"
        who = p % photographers
        taste = tastes[who]
        photographer = f"photographer:{hashlib.sha256(f'u{who}'.encode()).hexdigest()[:20]}"
        mode = "ASSISTED" if rng.random() < 0.15 else "STRICT" if rng.random() < 0.1 else "BALANCED"
        run = f"run:{hashlib.sha256(f'r{p}'.encode()).hexdigest()[:20]}"
        photos = []
        gid = 0
        while len(photos) < int(rng.integers(80, 160)):
            size = int(rng.integers(2, 6)) if rng.random() < 0.4 else 1
            base_tech = float(np.clip(rng.normal(68, 16), 5, 100))
            faces = int(rng.choice([0, 1, 2, 3, 6], p=[0.25, 0.3, 0.2, 0.15, 0.1]))
            scene = SCENES[int(rng.integers(0, len(SCENES)))]
            group = f"g{p}-{gid}" if size > 1 else None
            gid += 1
            for _ in range(size):
                tech = float(np.clip(base_tech + rng.normal(0, 6), 0, 100))
                eyes = float(np.clip(rng.normal(80, 25), 0, 100)) if faces else None
                f = {name: 0 for name in feature_names}
                f.update({
                    "technical_score": tech, "blur_score": float(np.clip(tech + rng.normal(0, 5), 0, 100)), "exposure_score": float(np.clip(rng.normal(80, 12), 0, 100)),
                    "face_count": faces, "face_quality": float(np.clip(rng.normal(70, 15), 0, 100)) if faces else None, "eyes_open": eyes,
                    "expression": float(np.clip(rng.normal(60, 20), 0, 100)) if faces else None, "subject_score": float(np.clip(rng.normal(55, 20), 0, 100)) if faces else None,
                    "people_count": faces, "aesthetic_score": float(np.clip(rng.normal(55, 18), 0, 100)), "composition_score": float(np.clip(rng.normal(60, 15), 0, 100)),
                    "scene_confidence": float(rng.uniform(0.3, 0.95)), "in_duplicate": 0, "in_burst": 1 if group else 0, "group_size": size if group else 0,
                    "code_soft_focus": int(tech < 45), "code_severe_blur": int(tech < 20), "code_primary_subject_blink": int(bool(faces) and eyes is not None and eyes < 30),
                    "code_good_expression": int(bool(faces) and rng.random() < 0.3), "code_key_people_present": int(bool(faces) and rng.random() < 0.4),
                })
                f[f"scene_{scene.lower()}"] = 1
                photos.append({"f": f, "group": group, "scene": scene})
        by_group = {}
        for photo in photos:
            if photo["group"]:
                by_group.setdefault(photo["group"], []).append(photo)
        for members in by_group.values():
            order = sorted(members, key=lambda m: -(m["f"]["technical_score"] + (m["f"]["eyes_open"] or 50) * 0.5))
            for rank, m in enumerate(order, start=1):
                m["f"]["group_rank_frac"] = (rank - 1) / (len(order) - 1)
                m["f"]["is_group_best"] = int(rank == 1)
                med = float(np.median([x["f"]["technical_score"] for x in order]))
                m["f"]["d_technical"] = m["f"]["technical_score"] - med
        for photo in photos:
            f = photo["f"]
            # Photographers value expression and composition far more than the fixed formula does,
            # and sharpness a little less: the gap a learned ranker should find.
            u = 0.035 * (f["technical_score"] - 60) + (0.05 * ((f["eyes_open"] or 60) - 60) + 0.06 * ((f["expression"] or 50) - 50) if f["face_count"] else 0) + 0.04 * (f["aesthetic_score"] - 50) + 0.06 * (f["composition_score"] - 58)
            u += -2.0 * f["code_primary_subject_blink"] - 2.5 * f["code_severe_blur"] + (taste["candid"] if photo["scene"] == "CANDID" else 0) + (taste["soft"] if f["code_soft_focus"] else 0)
            u += 0.9 if photo["scene"] in ("COUPLE", "CEREMONY") else 0
            photo["u"] = u + rng.normal(0, 0.5)
            photo["ai_score"] = _formula(f)
            lines = (50, 70) if mode == "STRICT" else (40, 62)
            photo["ai"] = None if mode == "ASSISTED" else ("KEEP" if photo["ai_score"] >= lines[1] else "REJECT" if photo["ai_score"] < lines[0] else "MAYBE")
        kept_in_group = {}
        for members in by_group.values():
            order = sorted(members, key=lambda m: -m["u"])
            keep_n = 2 if taste["keeps_two"] else 1
            for rank, m in enumerate(order):
                m["group_choice"] = "KEEP" if rank < keep_n and m["u"] > -0.5 else "REJECT"
                m["chosen_best"] = rank == 0 and m["u"] > -0.5
            kept_in_group[id(members[0]["group"])] = True
        for i, photo in enumerate(photos):
            truth = photo.get("group_choice") or ("KEEP" if photo["u"] > 0.4 else "REJECT" if photo["u"] < -0.6 else "MAYBE")
            lazy = photo["ai"] is not None and abs(photo["u"]) < 1.0 and rng.random() < taste["lazy"]
            final = photo["ai"] if lazy else truth
            explicit = not lazy and final != photo["ai"]
            weight = (1.0 if rng.random() < 0.4 else 0.8) if explicit else 0.2
            label = {"KEEP": 1, "REJECT": 0}.get(final)
            group = photo["group"]
            relative = bool(group and final == "REJECT" and any(m is not photo and (m.get("group_choice") == "KEEP") for m in by_group[group]))
            example_id = f"photo:{hashlib.sha256(f'{p}-{i}'.encode()).hexdigest()[:20]}"
            photo["id"] = example_id
            photo["final"] = final
            examples.append({
                "id": example_id, "run": run, "project": project, "photographer": photographer, "studio": "studio:synthetic", "split": split, "eventType": "WED", "mode": mode, "gold": mode == "ASSISTED",
                "scene": photo["scene"], "features": [photo["f"].get(name) for name in feature_names],
                "aiDecision": photo["ai"], "aiScore": photo["ai_score"], "aiConfidence": 0.7, "finalDecision": final, "label": label,
                "changeType": "NO_AI_CALL" if photo["ai"] is None else "AGREE" if photo["ai"] == final else f"AI_{photo['ai']}_TO_{final}",
                "weight": weight, "explicit": explicit, "source": "KEY" if explicit else None, "relativeReject": relative, "clientPicked": bool(final == "KEEP" and rng.random() < 0.3),
                # A third of the shoots analyzed and reviewed in the desktop app, the rest on the web.
                "inferenceLocation": "DESKTOP" if p % 3 == 0 else "SERVER", "reviewPlatform": "DESKTOP" if p % 3 == 0 else "WEB",
                "group": f"group:{group}" if group else None, "groupType": "BURST" if group else None, "finalizedOn": "2026-09",
            })
        for group, members in by_group.items():
            entry = {"group": f"group:{group}", "run": run, "project": project, "photographer": photographer, "split": split, "type": "BURST", "members": [{"example": m["id"], "relevance": 3 if m.get("chosen_best") else {"KEEP": 2, "MAYBE": 1}.get(m["final"], 0)} for m in members]}
            groups.append(entry)
            for a in entry["members"]:
                for b in entry["members"]:
                    if a["relevance"] > b["relevance"]:
                        pairs.append({"winner": a["example"], "loser": b["example"], "source": "GROUP_DECISION", "split": split, "weight": 0.8})
    files = {}
    for name, records in (("examples", examples), ("groups", groups), ("pairs", pairs)):
        path = os.path.join(target, f"{name}.jsonl.gz")
        with gzip.open(path, "wt", encoding="utf-8", newline="\n") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
        files[name] = {"file": f"{name}.jsonl.gz", "records": len(records), "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()}
    labels = {"KEEP": 0, "MAYBE": 0, "REJECT": 0}
    for example in examples:
        labels[example["finalDecision"]] += 1
    manifest = {"datasetVersion": version, "exportVersion": "synthetic_v1", "synthetic": True, "featureSetVersion": feature_set_version, "featureNames": feature_names, "counts": {"runs": projects, "projects": projects, "photographers": photographers, "examples": len(examples), "groups": len(groups), "pairs": len(pairs)}, "labels": labels, "files": files}
    with open(os.path.join(target, "manifest.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2)
    return target


def main():
    parser = argparse.ArgumentParser(description="Write a synthetic culling dataset (for proving the pipeline only).")
    parser.add_argument("--out", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--feature-names", required=True, help="JSON file with the feature-set's names, in order")
    parser.add_argument("--feature-set-version", default="features_v2", help="the version those names belong to")
    parser.add_argument("--projects", type=int, default=120)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    with open(args.feature_names, encoding="utf-8") as handle:
        names = json.load(handle)
    print(generate(args.out, args.version, names, projects=args.projects, seed=args.seed, feature_set_version=args.feature_set_version))


if __name__ == "__main__":
    main()
