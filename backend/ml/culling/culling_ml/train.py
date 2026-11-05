"""Trains a culling-ranker bundle from one exported dataset and evaluates it against today's formula.

    python -m culling_ml.train --dataset <dir> --out <dir> --name culling-ranker --version 1.0.0

Writes <out>/<name>/<version>/: bundle.json (what the server loads - LightGBM's own JSON dumps,
evaluated in JS by learning/treeModel.js), metrics.json (the evaluation report and the promotion
verdict) and predictions_sample.json (for the JS/Python parity test). Deterministic for a given
dataset, seed and code.

What it learns (the architecture doc's "ranking model" and "personalization"):
- global: P(keep) per photo, LightGBM binary with monotone constraints on the signals whose
  direction is not in doubt. Relative rejects (lost to a kept twin) are not negatives here.
- burst: LambdaRank over duplicate and burst groups, graded by the photographer's choice.
- personalization: per photographer a bias (20+ explicit corrections) and trait weights (100+),
  fitted on the global model's residual and shrunk toward global at serving time.
- thresholds: per mode, the Reject and Keep lines on the learned scale that agree best with the
  photographers' evidence-weighted decisions on the validation split (so anchored, untouched calls
  count little); Strict keeps the formula's offset above Balanced unless it has 200+ runs' worth of
  its own examples. The keep share each mode then produces is reported beside the formula's.
"""
import argparse
import datetime
import json
import os

import lightgbm as lgb
import numpy as np

from .dataset import Dataset
from . import metrics as M

FIXED_LINES = {"BALANCED": (40.0, 62.0), "STRICT": (50.0, 70.0)}
MONOTONE = {"technical_score": 1, "eyes_open": 1, "face_quality": 1, "code_severe_blur": -1, "code_soft_focus": -1, "code_primary_subject_blink": -1, "code_important_subject_blink": -1, "code_accidental_frame": -1}
TRAIT_PREFIXES = ("code_", "scene_")
MIN_LABELED = 20
MIN_GROUPS = 30
PERSONAL_LIGHT = 20
PERSONAL_FULL = 100
SHRINK_K = 50
MAX_ADJUST = 8.0
HARD_NEGATIVE_FACTOR = 1.5
CLIENT_PICK_BONUS = 0.5
PROMOTION = {"agreement_gain": 0.02, "burst_top1_gain": 0.03, "slice_min_photos": 2000, "slice_max_drop": 0.02}


class TrainingError(Exception):
    pass


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def _global_params(n_train, seed, feature_names):
    return {
        "objective": "binary", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": max(2, min(20, n_train // 50)),
        "min_sum_hessian_in_leaf": 1e-3, "lambda_l2": 1.0, "feature_fraction": 0.9, "feature_fraction_seed": seed,
        "monotone_constraints": [MONOTONE.get(name, 0) for name in feature_names], "monotone_constraints_method": "basic",
        "deterministic": True, "force_row_wise": True, "num_threads": 1, "seed": seed, "verbose": -1,
    }


def _global_rows(ds, split):
    """Examples the global model learns from in `split`: kept (1) or absolutely rejected (0)."""
    rows, labels, weights = [], [], []
    for position, example in enumerate(ds.examples):
        if example["split"] != split or example.get("label") is None:
            continue
        if example["label"] == 0 and example.get("relativeReject"):
            continue
        weight = float(example.get("weight") or 0.0)
        if example.get("changeType") in ("AI_KEEP_TO_REJECT", "AI_REJECT_TO_KEEP"):
            weight *= HARD_NEGATIVE_FACTOR
        if example["label"] == 1 and example.get("clientPicked"):
            weight += CLIENT_PICK_BONUS
        rows.append(position)
        labels.append(example["label"])
        weights.append(max(weight, 1e-3))
    return np.array(rows, dtype=int), np.array(labels, dtype=float), np.array(weights, dtype=float)


def train_global(ds, seed, rounds=400, rows_subset=None):
    rows, labels, weights = _global_rows(ds, "train")
    if rows_subset is not None:
        keep = np.isin(rows, rows_subset)
        rows, labels, weights = rows[keep], labels[keep], weights[keep]
    if len(rows) < MIN_LABELED or len(np.unique(labels)) < 2:
        raise TrainingError(f"Not enough labeled training examples ({len(rows)}, classes {sorted(set(labels.tolist()))}).")
    params = _global_params(len(rows), seed, ds.feature_names)
    train = lgb.Dataset(ds.X[rows], label=labels, weight=weights, feature_name=ds.feature_names, free_raw_data=False)
    vrows, vlabels, vweights = _global_rows(ds, "validation")
    callbacks, valid_sets = [], []
    if len(vrows) >= 20 and len(np.unique(vlabels)) == 2:
        valid_sets = [lgb.Dataset(ds.X[vrows], label=vlabels, weight=vweights, reference=train)]
        callbacks = [lgb.early_stopping(50, verbose=False)]
    booster = lgb.train(params, train, num_boost_round=rounds, valid_sets=valid_sets, callbacks=callbacks)
    return booster, params


def train_burst(ds, seed):
    """LambdaRank over the training split's groups; None (with the reason) when there are too few."""
    features, labels, sizes = [], [], []
    for group in ds.groups:
        if group["split"] != "train":
            continue
        members = [member for member in group["members"] if member["example"] in ds.index]
        if len(members) < 2 or len({member["relevance"] for member in members}) < 2:
            continue
        for member in members:
            features.append(ds.X[ds.index[member["example"]]])
            labels.append(member["relevance"])
        sizes.append(len(members))
    if len(sizes) < MIN_GROUPS:
        return None, None, f"{len(sizes)} usable training groups; {MIN_GROUPS} needed"
    params = {"objective": "lambdarank", "learning_rate": 0.05, "num_leaves": 7, "min_data_in_leaf": max(1, min(10, len(labels) // 50)), "lambdarank_truncation_level": 3, "label_gain": [0, 1, 3, 7], "deterministic": True, "force_row_wise": True, "num_threads": 1, "seed": seed, "verbose": -1}
    data = lgb.Dataset(np.array(features), label=np.array(labels), group=sizes, feature_name=ds.feature_names, free_raw_data=False)
    return lgb.train(params, data, num_boost_round=200), params, None


def _trait_indices(feature_names):
    return [index for index, name in enumerate(feature_names) if name.startswith(TRAIT_PREFIXES)]


def fit_personal(ds, booster, seed):
    """Per-photographer bias (and trait weights at 100+ explicit corrections) on the global residual."""
    raw = booster.predict(ds.X, raw_score=True)
    traits = _trait_indices(ds.feature_names)
    photographers = {}
    by_photographer = {}
    for position, example in enumerate(ds.examples):
        if example["split"] != "train" or example.get("label") is None or not example.get("photographer"):
            continue
        if example["label"] == 0 and example.get("relativeReject"):
            continue
        by_photographer.setdefault(example["photographer"], []).append(position)
    for key, rows in sorted(by_photographer.items()):
        rows = np.array(rows)
        n = int(sum(1 for position in rows if ds.examples[position].get("explicit")))
        if n < PERSONAL_LIGHT:
            continue
        y = np.array([ds.examples[position]["label"] for position in rows], dtype=float)
        w = np.array([max(float(ds.examples[position].get("weight") or 0), 1e-3) for position in rows])
        z0 = raw[rows]
        use_traits = n >= PERSONAL_FULL
        X = np.nan_to_num(ds.X[np.ix_(rows, traits)]) if use_traits else np.zeros((len(rows), 0))
        theta = np.zeros(1 + X.shape[1])
        design = np.hstack([np.ones((len(rows), 1)), X])
        for _ in range(500):
            p = _sigmoid(z0 + design @ theta)
            gradient = design.T @ (w * (p - y)) / w.sum() + 1.0 * theta / len(rows)
            theta -= 0.5 * gradient
        entry = {"n": n, "bias": round(float(theta[0]), 6)}
        if use_traits:
            weights = {ds.feature_names[traits[j]]: round(float(value), 6) for j, value in enumerate(theta[1:]) if abs(value) > 0.05}
            if weights:
                entry["traits"] = weights
        photographers[key] = entry
    return {"shrinkK": SHRINK_K, "maxAdjust": MAX_ADJUST, "studio": {"n": 0}, "photographers": photographers}


def serve_scores(ds, rows, booster, personalization):
    """Learned 0-100 scores as the server computes them (learning/scorer.js), personal layer included."""
    p = booster.predict(ds.X[rows])
    base = 100 * p
    z = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    names = ds.feature_names
    for i, position in enumerate(rows):
        layer = personalization["photographers"].get(ds.examples[position].get("photographer") or "")
        if not layer:
            continue
        shrink = layer["n"] / (layer["n"] + personalization["shrinkK"])
        offset = layer.get("bias", 0.0)
        for name, weight in layer.get("traits", {}).items():
            value = ds.X[position, names.index(name)]
            if not np.isnan(value):
                offset += weight * value
        z[i] += shrink * offset
    adjusted = 100 * _sigmoid(z)
    return np.clip(base + np.clip(adjusted - base, -personalization["maxAdjust"], personalization["maxAdjust"]), 0, 100), p


def _best_lines(scores, final, weights, max_false_reject=None):
    """The (reject, keep) pair on a 1-point grid with the highest weighted 3-class agreement,
    among pairs that reject no larger share of the photographer's Keeps than `max_false_reject`
    (the formula's own rate): missing a good photo is the costliest error, so it is a constraint,
    not a trade."""
    keeps = final == "KEEP"
    best = None
    for reject in range(2, 80):
        for keep in range(reject + 4, 99):
            decided = np.where(scores >= keep, "KEEP", np.where(scores < reject, "REJECT", "MAYBE"))
            if max_false_reject is not None and keeps.any() and np.mean(decided[keeps] == "REJECT") > max_false_reject + 1e-12:
                continue
            score = float(np.sum(weights * (decided == final)))
            if best is None or score > best[2]:
                best = (float(reject), float(keep), score)
    if best is None:
        return 2.0, 62.0
    return best[0], best[1]


def fit_thresholds(ds, booster, personalization):
    """Per-mode lines on the learned scale, fitted to the photographers' weighted decisions."""
    def rows_for(modes, splits):
        return np.array([i for i, e in enumerate(ds.examples) if e["split"] in splits and e["finalDecision"] in M.CLASSES and e.get("mode") in modes], dtype=int)
    rows = rows_for(("BALANCED", "TARGET_COUNT", "ASSISTED", "STRICT"), ("validation",))
    if len(rows) < 50:
        rows = rows_for(("BALANCED", "TARGET_COUNT", "ASSISTED", "STRICT"), ("validation", "train"))
    if not len(rows):
        raise TrainingError("No decided examples to fit the thresholds on.")
    learned, _ = serve_scores(ds, rows, booster, personalization)
    final = np.array([ds.examples[i]["finalDecision"] for i in rows])
    weights = np.array([max(float(ds.examples[i].get("weight") or 0), 1e-3) for i in rows])
    formula = _decisions(ds, rows, np.array([ds.examples[i].get("aiScore") or 0 for i in rows], dtype=float), None, False)
    keeps = final == "KEEP"
    formula_false_reject = float(np.mean(formula[keeps] == "REJECT")) if keeps.any() else None
    reject, keep = _best_lines(learned, final, weights, formula_false_reject)
    out = {"BALANCED": {"reject": reject, "keep": keep}}
    strict_rows = rows_for(("STRICT",), ("validation", "train"))
    if len(strict_rows) >= 2000:
        s_scores, _ = serve_scores(ds, strict_rows, booster, personalization)
        s_final = np.array([ds.examples[i]["finalDecision"] for i in strict_rows])
        s_weights = np.array([max(float(ds.examples[i].get("weight") or 0), 1e-3) for i in strict_rows])
        s_formula = _decisions(ds, strict_rows, np.array([ds.examples[i].get("aiScore") or 0 for i in strict_rows], dtype=float), None, False)
        s_keeps = s_final == "KEEP"
        s_reject, s_keep = _best_lines(s_scores, s_final, s_weights, float(np.mean(s_formula[s_keeps] == "REJECT")) if s_keeps.any() else None)
    else:
        shift_reject = FIXED_LINES["STRICT"][0] - FIXED_LINES["BALANCED"][0]
        shift_keep = FIXED_LINES["STRICT"][1] - FIXED_LINES["BALANCED"][1]
        s_reject, s_keep = min(reject + shift_reject, 95.0), min(keep + shift_keep, 99.0)
    out["STRICT"] = {"reject": s_reject, "keep": max(s_keep, s_reject + 1)}
    base = np.array([ds.examples[i].get("aiScore") or 0 for i in rows], dtype=float)
    out["_keepShare"] = {"learned": float(np.mean(learned >= keep)), "formula": float(np.mean(base >= FIXED_LINES["BALANCED"][1]))}
    return out


def _decisions(ds, rows, scores, thresholds, learned):
    """Candidate (learned) or baseline (formula) calls for evaluation, with the duplicate rule applied to both."""
    out = []
    in_dup = ds.column("in_duplicate")
    best = ds.column("is_group_best")
    for score, position in zip(scores, rows):
        example = ds.examples[position]
        if not learned and example.get("aiDecision"):
            out.append(example["aiDecision"])
            continue
        if in_dup[position] == 1 and best[position] == 0:
            out.append("REJECT")
            continue
        mode = example.get("mode") if example.get("mode") in FIXED_LINES else "BALANCED"
        reject, keep = (thresholds[mode]["reject"], thresholds[mode]["keep"]) if learned else FIXED_LINES[mode]
        out.append("KEEP" if score >= keep else "REJECT" if score < reject else "MAYBE")
    return np.array(out)


def evaluate(ds, split, booster, burst, personalization, thresholds, seed):
    rows = np.array([i for i, e in enumerate(ds.examples) if e["split"] == split and e["finalDecision"] in M.CLASSES], dtype=int)
    if not len(rows):
        return {"n": 0}
    final = np.array([ds.examples[i]["finalDecision"] for i in rows])
    learned, p = serve_scores(ds, rows, booster, personalization)
    baseline_scores = np.array([ds.examples[i].get("aiScore") or 0 for i in rows], dtype=float)
    candidate = _decisions(ds, rows, learned, thresholds, True)
    baseline = _decisions(ds, rows, baseline_scores, thresholds, False)
    report = {"candidate": M.classification(candidate, final), "baseline": M.classification(baseline, final)}
    projects = ds.project[rows]
    report["agreement_difference_ci"] = M.bootstrap_difference(projects, (candidate == final).astype(float), (baseline == final).astype(float), seed=seed)
    labeled = np.array([ds.examples[i].get("label") is not None and not (ds.examples[i]["label"] == 0 and ds.examples[i].get("relativeReject")) for i in rows])
    report["calibration_error"] = M.calibration_error(p[labeled], [ds.examples[i]["label"] for i in rows[labeled]])
    gold = np.array([bool(ds.examples[i].get("gold")) for i in rows])
    report["gold"] = {"n": int(gold.sum()), "candidate_agreement": float(np.mean(candidate[gold] == final[gold])) if gold.any() else None, "baseline_agreement": float(np.mean(baseline[gold] == final[gold])) if gold.any() else None}
    people = ds.column("people_count")[rows]
    crowd = np.nan_to_num(people) >= 5
    report["group_photos"] = {"n": int(crowd.sum()), "candidate_agreement": float(np.mean(candidate[crowd] == final[crowd])) if crowd.any() else None, "baseline_agreement": float(np.mean(baseline[crowd] == final[crowd])) if crowd.any() else None}
    runs = np.array([ds.examples[i]["run"] for i in rows])
    report["target_overlap"] = {"candidate": M.target_overlap(runs, final == "KEEP", learned), "baseline": M.target_overlap(runs, final == "KEEP", baseline_scores)}
    groups = [group for group in ds.groups if group["split"] == split]
    raw_burst = burst.predict(ds.X) if burst is not None else None
    score_all, _ = serve_scores(ds, np.arange(len(ds.examples)), booster, personalization)
    learned_rank = (lambda example: raw_burst[ds.index[example]]) if raw_burst is not None else (lambda example: score_all[ds.index[example]])
    ai_rank = lambda example: ds.X[ds.index[example], ds.feature_names.index("is_group_best")] * 10 - np.nan_to_num(ds.X[ds.index[example], ds.feature_names.index("group_rank_frac")])
    report["burst"] = {"candidate": M.burst_metrics(groups, learned_rank), "baseline": M.burst_metrics(groups, ai_rank)}
    slices = {}
    # inferenceLocation / reviewPlatform: the web (server analysis) and the desktop app (local
    # analysis) are one intelligence, so a candidate must not trade one environment for the other.
    for field in ("scene", "mode", "eventType", "photographer", "inferenceLocation", "reviewPlatform"):
        values = np.array([str(ds.examples[i].get(field)) if ds.examples[i].get(field) is not None else "UNSEEN" for i in rows])
        slices[field] = {value: {"n": int((values == value).sum()), "candidate": float(np.mean(candidate[values == value] == final[values == value])), "baseline": float(np.mean(baseline[values == value] == final[values == value]))} for value in np.unique(values)}
    report["slices"] = slices
    return report


def verdict(test):
    """The architecture's promotion rules, applied to the test split. Shadow results decide promotion; this decides candidacy."""
    reasons = []
    if not test.get("candidate"):
        return {"candidate_ready": False, "reasons": ["no test examples"]}
    gain = (test["candidate"]["agreement"] or 0) - (test["baseline"]["agreement"] or 0)
    ci = test.get("agreement_difference_ci")
    if gain < PROMOTION["agreement_gain"]:
        reasons.append(f"agreement gain {gain:.3f} < {PROMOTION['agreement_gain']}")
    if not ci or ci["low"] <= 0:
        reasons.append("agreement gain's 95% interval is not above 0")
    fr_c, fr_b = test["candidate"]["false_reject_rate"], test["baseline"]["false_reject_rate"]
    if fr_c is not None and fr_b is not None and fr_c > fr_b:
        reasons.append(f"false reject rate rose ({fr_b:.3f} -> {fr_c:.3f})")
    b = test["burst"]
    if b["candidate"]["top1"] is not None and b["baseline"]["top1"] is not None and b["candidate"]["top1"] - b["baseline"]["top1"] < PROMOTION["burst_top1_gain"]:
        reasons.append(f"burst top-1 gain {b['candidate']['top1'] - b['baseline']['top1']:.3f} < {PROMOTION['burst_top1_gain']}")
    gp = test["group_photos"]
    if gp["n"] and gp["candidate_agreement"] < gp["baseline_agreement"]:
        reasons.append("group-photo agreement fell")
    for field, values in test["slices"].items():
        for value, entry in values.items():
            if entry["n"] >= PROMOTION["slice_min_photos"] and entry["baseline"] - entry["candidate"] > PROMOTION["slice_max_drop"]:
                reasons.append(f"slice {field}={value} dropped {entry['baseline'] - entry['candidate']:.3f}")
    return {"candidate_ready": not reasons, "agreement_gain": gain, "reasons": reasons}


def learning_curve(ds, seed, rounds):
    projects = sorted({e["project"] for e in ds.examples if e["split"] == "train"})
    rng = np.random.default_rng(seed)
    order = list(rng.permutation(projects))
    test_rows = np.array([i for i, e in enumerate(ds.examples) if e["split"] == "test" and e["finalDecision"] in M.CLASSES], dtype=int)
    if not len(test_rows):
        return []
    final = np.array([ds.examples[i]["finalDecision"] for i in test_rows])
    curve = []
    for share in (0.25, 0.5, 1.0):
        chosen = set(order[: max(1, int(round(len(order) * share)))])
        subset = np.array([i for i, e in enumerate(ds.examples) if e["project"] in chosen])
        try:
            booster, _ = train_global(ds, seed, rounds=rounds, rows_subset=subset)
        except TrainingError:
            curve.append({"share": share, "projects": len(chosen), "agreement": None})
            continue
        empty = {"shrinkK": SHRINK_K, "maxAdjust": MAX_ADJUST, "photographers": {}}
        thresholds = fit_thresholds(ds, booster, empty)
        thresholds.pop("_keepShare", None)
        scores, _ = serve_scores(ds, test_rows, booster, empty)
        decided = _decisions(ds, test_rows, scores, thresholds, True)
        curve.append({"share": share, "projects": len(chosen), "agreement": float(np.mean(decided == final))})
    return curve


def train_bundle(dataset_dir, out_dir, name="culling-ranker", version="1.0.0", seed=7):
    ds = Dataset(dataset_dir)
    booster, global_params = train_global(ds, seed)
    burst, burst_params, burst_note = train_burst(ds, seed)
    personalization = fit_personal(ds, booster, seed)
    fitted = fit_thresholds(ds, booster, personalization)
    keep_share = fitted.pop("_keepShare")
    thresholds = fitted
    reports = {split: evaluate(ds, split, booster, burst, personalization, thresholds, seed) for split in ("validation", "test")}
    test = reports["test"]
    decision = verdict(test)
    curve = learning_curve(ds, seed, rounds=max(1, booster.best_iteration or booster.current_iteration()))
    created = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    hyper = {"global": global_params, "burst": burst_params, "burst_note": burst_note, "personal": {"light": PERSONAL_LIGHT, "full": PERSONAL_FULL, "shrinkK": SHRINK_K, "maxAdjust": MAX_ADJUST}, "seed": seed, "best_iteration": booster.best_iteration or booster.current_iteration()}
    headline = None
    if test.get("candidate"):
        headline = {
            "agreement": test["candidate"]["agreement"], "baseline_agreement": test["baseline"]["agreement"],
            "false_reject_rate": test["candidate"]["false_reject_rate"], "baseline_false_reject_rate": test["baseline"]["false_reject_rate"],
            "burst_top1": test["burst"]["candidate"]["top1"], "baseline_burst_top1": test["burst"]["baseline"]["top1"],
            "candidate_ready": decision["candidate_ready"],
        }
    bundle = {
        "name": name, "version": version, "featureSetVersion": ds.manifest["featureSetVersion"], "datasetVersion": ds.version,
        "featureNames": ds.feature_names, "createdAt": created, "seed": seed,
        "global": booster.dump_model(), "burst": burst.dump_model() if burst is not None else None,
        "thresholds": thresholds, "personalization": personalization, "hyperparameters": hyper,
    }
    report = {"keepShare": keep_share, "name": name, "version": version, "datasetVersion": ds.version, "featureSetVersion": ds.manifest["featureSetVersion"], "synthetic": bool(ds.manifest.get("synthetic")), "createdAt": created, "counts": ds.manifest["counts"], "headline": headline, "verdict": decision, "learningCurve": curve, "validation": reports["validation"], "test": test, "hyperparameters": hyper}
    target = os.path.join(out_dir, name, version)
    os.makedirs(target, exist_ok=True)
    with open(os.path.join(target, "bundle.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(bundle, handle, allow_nan=False, separators=(",", ":"))
    with open(os.path.join(target, "metrics.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, indent=2, allow_nan=False, default=float)
    sample = list(range(min(200, len(ds.examples))))
    raw = booster.predict(ds.X[sample], raw_score=True)
    prob = booster.predict(ds.X[sample])
    burst_raw = burst.predict(ds.X[sample]) if burst is not None else [None] * len(sample)
    with open(os.path.join(target, "predictions_sample.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump([{"features": [None if np.isnan(v) else float(v) for v in ds.X[i]], "raw": float(r), "p": float(q), "burst": None if b is None else float(b)} for i, r, q, b in zip(sample, raw, prob, burst_raw)], handle, allow_nan=False)
    return target, report


def main():
    parser = argparse.ArgumentParser(description="Train a culling-ranker bundle from an exported dataset.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--name", default="culling-ranker")
    parser.add_argument("--version", required=True)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    target, report = train_bundle(args.dataset, args.out, args.name, args.version, args.seed)
    print(json.dumps({"bundle": os.path.join(target, "bundle.json"), "headline": report["headline"], "verdict": report["verdict"]}, indent=2, default=float))


if __name__ == "__main__":
    main()
