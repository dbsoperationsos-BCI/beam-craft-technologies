"""Loads one exported culling dataset (backend/src/modules/image-selection/ai-culling/learning/exporter.js).

A dataset folder holds manifest.json, examples.jsonl.gz, groups.jsonl.gz and pairs.jsonl.gz. Files
are checked against the manifest's SHA-256 before anything is read, so a model is never trained on
a dataset that changed after it was built.
"""
import gzip
import hashlib
import json
import os

import numpy as np


class DatasetError(Exception):
    pass


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _jsonl(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


class Dataset:
    """Examples as arrays, plus groups and the manifest. Missing features are NaN."""

    def __init__(self, directory):
        manifest_path = os.path.join(directory, "manifest.json")
        if not os.path.exists(manifest_path):
            raise DatasetError(f"No manifest.json in {directory}")
        with open(manifest_path, encoding="utf-8") as handle:
            self.manifest = json.load(handle)
        for name, info in self.manifest["files"].items():
            path = os.path.join(directory, info["file"])
            if _sha256(path) != info["sha256"]:
                raise DatasetError(f"{info['file']} does not match the manifest checksum")
        self.directory = directory
        self.version = self.manifest["datasetVersion"]
        self.feature_names = list(self.manifest["featureNames"])
        self.examples = _jsonl(os.path.join(directory, "examples.jsonl.gz"))
        self.groups = _jsonl(os.path.join(directory, "groups.jsonl.gz"))
        self.index = {example["id"]: position for position, example in enumerate(self.examples)}
        width = len(self.feature_names)
        self.X = np.array([[np.nan if value is None else float(value) for value in example["features"]] for example in self.examples], dtype=np.float64).reshape(len(self.examples), width)
        self.split = np.array([example["split"] for example in self.examples])
        self.project = np.array([example["project"] for example in self.examples])

    def column(self, name):
        return self.X[:, self.feature_names.index(name)]

    def field(self, name, default=None):
        return [example.get(name, default) for example in self.examples]
