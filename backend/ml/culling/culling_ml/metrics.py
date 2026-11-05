"""Evaluation for the culling ranker: the architecture's metric set, computed the same way for the
candidate and for today's formula so the two are always compared like for like.

Decisions are KEEP / MAYBE / REJECT strings. Agreement is the headline: the share of photos where
the AI's call equals the photographer's final decision.
"""
import math

import numpy as np

CLASSES = ("KEEP", "MAYBE", "REJECT")


def decide(scores, reject_line, keep_line):
    scores = np.asarray(scores, dtype=float)
    return np.where(scores >= keep_line, "KEEP", np.where(scores < reject_line, "REJECT", "MAYBE"))


def classification(predicted, final):
    predicted = np.asarray(predicted)
    final = np.asarray(final)
    n = len(final)
    out = {"n": int(n), "agreement": float(np.mean(predicted == final)) if n else None}
    out["confusion"] = {f: {p: int(np.sum((final == f) & (predicted == p))) for p in CLASSES} for f in CLASSES}
    for cls in ("KEEP", "REJECT"):
        tp = int(np.sum((predicted == cls) & (final == cls)))
        pp = int(np.sum(predicted == cls))
        ap = int(np.sum(final == cls))
        precision = tp / pp if pp else None
        recall = tp / ap if ap else None
        f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
        out[cls.lower()] = {"precision": precision, "recall": recall, "f1": f1}
    keeps = int(np.sum(final == "KEEP"))
    rejects = int(np.sum(final == "REJECT"))
    # The costliest error: a photo the photographer kept that the AI rejected.
    out["false_reject_rate"] = float(np.sum((predicted == "REJECT") & (final == "KEEP")) / keeps) if keeps else None
    out["false_keep_rate"] = float(np.sum((predicted == "KEEP") & (final == "REJECT")) / rejects) if rejects else None
    return out


def calibration_error(probabilities, labels, bins=10):
    """Expected calibration error of P(keep) against kept (1) / rejected (0) labels."""
    probabilities = np.asarray(probabilities, dtype=float)
    labels = np.asarray(labels, dtype=float)
    if not len(labels):
        return None
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (probabilities >= low) & ((probabilities < high) if high < 1 else (probabilities <= high))
        if mask.any():
            total += mask.sum() / len(labels) * abs(probabilities[mask].mean() - labels[mask].mean())
    return float(total)


def _dcg(relevances):
    return sum((2 ** rel - 1) / math.log2(position + 2) for position, rel in enumerate(relevances))


def burst_metrics(groups, score_of):
    """Top-1 and top-2 best-frame accuracy and NDCG@3 over groups with a clear best.

    `groups`: [{"members": [{"example": id, "relevance": r}, ...]}]; `score_of(id)` -> ranking score.
    """
    top1 = top2 = ndcg = 0.0
    counted = 0
    for group in groups:
        members = group["members"]
        best = max(member["relevance"] for member in members)
        winners = [member["example"] for member in members if member["relevance"] == best]
        if best == 0 or len(winners) != 1:
            continue
        ranked = sorted(members, key=lambda member: -score_of(member["example"]))
        counted += 1
        top1 += ranked[0]["example"] == winners[0]
        top2 += winners[0] in [member["example"] for member in ranked[:2]]
        ideal = _dcg(sorted((member["relevance"] for member in members), reverse=True)[:3])
        ndcg += _dcg([member["relevance"] for member in ranked[:3]]) / ideal if ideal else 0
    if not counted:
        return {"groups": 0, "top1": None, "top2": None, "ndcg3": None}
    return {"groups": counted, "top1": top1 / counted, "top2": top2 / counted, "ndcg3": ndcg / counted}


def target_overlap(runs, final_keep, score):
    """Mean Jaccard overlap, per run, between the top-k photos by `score` and the photographer's k Keeps."""
    values = []
    for run in np.unique(runs):
        mask = runs == run
        keeps = set(np.flatnonzero(mask & final_keep))
        k = len(keeps)
        if not k:
            continue
        indices = np.flatnonzero(mask)
        chosen = set(indices[np.argsort(-score[indices], kind="stable")[:k]])
        values.append(len(chosen & keeps) / len(chosen | keeps))
    return float(np.mean(values)) if values else None


def bootstrap_difference(projects, candidate_correct, baseline_correct, draws=1000, seed=7):
    """95% interval of (candidate agreement - baseline agreement), resampling whole projects."""
    rng = np.random.default_rng(seed)
    unique = np.unique(projects)
    if len(unique) < 2:
        return None
    by_project = {project: np.flatnonzero(projects == project) for project in unique}
    diffs = []
    for _ in range(draws):
        sample = rng.choice(unique, size=len(unique), replace=True)
        rows = np.concatenate([by_project[project] for project in sample])
        diffs.append(candidate_correct[rows].mean() - baseline_correct[rows].mean())
    low, high = np.percentile(diffs, [2.5, 97.5])
    return {"low": float(low), "high": float(high), "mean": float(np.mean(diffs))}
