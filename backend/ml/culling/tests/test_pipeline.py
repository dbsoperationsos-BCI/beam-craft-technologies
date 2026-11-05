"""The culling ranker's training pipeline, end to end on synthetic data, plus its metric maths.

    cd backend/ml/culling && ../../.venv-ml/Scripts/python -m unittest discover -s tests
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import numpy as np

from culling_ml import metrics as M
from culling_ml.dataset import Dataset, DatasetError
from culling_ml.synth import generate
from culling_ml.train import _best_lines, train_bundle

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def feature_set():
    out = subprocess.run(["node", "-e", "const f = require('./src/modules/image-selection/ai-culling/learning/featureSet'); console.log(JSON.stringify({ version: f.FEATURE_SET_VERSION, names: f.FEATURE_NAMES }))"], cwd=BACKEND, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def feature_names():
    return feature_set()["names"]


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="culling-ml-")
        contract = feature_set()
        cls.names = contract["names"]
        cls.version = contract["version"]
        cls.dataset = generate(os.path.join(cls.tmp, "data"), "synth_test", cls.names, projects=120, seed=11, feature_set_version=cls.version)
        cls.target, cls.report = train_bundle(cls.dataset, os.path.join(cls.tmp, "models"), version="0.0.1", seed=7)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_bundle_shape(self):
        with open(os.path.join(self.target, "bundle.json"), encoding="utf-8") as handle:
            bundle = json.load(handle)
        self.assertEqual(bundle["featureNames"], self.names)
        self.assertEqual(bundle["featureSetVersion"], self.version)
        self.assertEqual(self.version, "features_v2")
        self.assertEqual(bundle["global"]["objective"].split()[0], "binary")
        self.assertIsNotNone(bundle["burst"], "120 synthetic projects carry enough groups for the burst ranker")
        for mode in ("BALANCED", "STRICT"):
            self.assertLess(bundle["thresholds"][mode]["reject"], bundle["thresholds"][mode]["keep"])
        self.assertTrue(bundle["personalization"]["photographers"], "photographers with 20+ corrections get a layer")
        for layer in bundle["personalization"]["photographers"].values():
            self.assertGreaterEqual(layer["n"], 20)
            if layer["n"] < 100:
                self.assertNotIn("traits", layer, "traits only from 100 corrections")

    def test_the_learned_ranker_beats_the_formula_where_the_tastes_differ(self):
        headline = self.report["headline"]
        self.assertGreater(headline["agreement"], headline["baseline_agreement"])
        self.assertLessEqual(headline["false_reject_rate"], headline["baseline_false_reject_rate"] + 1e-9)
        self.assertGreater(headline["burst_top1"], headline["baseline_burst_top1"])
        self.assertTrue(self.report["synthetic"], "a synthetic dataset's report says so")
        self.assertEqual([point["share"] for point in self.report["learningCurve"]], [0.25, 0.5, 1.0])

    def test_web_and_desktop_are_read_apart_and_a_drop_on_either_refuses_the_candidate(self):
        # One intelligence for both apps: the evaluation is sliced by where the signals were
        # computed and where the review happened, and the slice rule applies to each.
        slices = self.report["test"]["slices"]
        self.assertEqual(sorted(slices["inferenceLocation"]), ["DESKTOP", "SERVER"])
        self.assertEqual(sorted(slices["reviewPlatform"]), ["DESKTOP", "WEB"])
        from culling_ml.train import verdict
        test = json.loads(json.dumps(self.report["test"]))
        test["slices"] = {"inferenceLocation": {"DESKTOP": {"n": 5000, "candidate": 0.50, "baseline": 0.60}, "SERVER": {"n": 5000, "candidate": 0.70, "baseline": 0.60}}}
        self.assertIn("slice inferenceLocation=DESKTOP dropped 0.100", verdict(test)["reasons"])

    def test_training_is_reproducible(self):
        again, _ = train_bundle(self.dataset, os.path.join(self.tmp, "models2"), version="0.0.1", seed=7)
        def load(path):
            with open(os.path.join(path, "bundle.json"), encoding="utf-8") as handle:
                return json.load(handle)
        first, second = load(self.target), load(again)
        first.pop("createdAt"); second.pop("createdAt")
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))

    def test_a_changed_dataset_is_refused(self):
        copy = os.path.join(self.tmp, "tampered")
        shutil.copytree(self.dataset, copy)
        with open(os.path.join(copy, "groups.jsonl.gz"), "ab") as handle:
            handle.write(b"\0")
        with self.assertRaises(DatasetError):
            Dataset(copy)


class MetricsTest(unittest.TestCase):
    def test_classification(self):
        report = M.classification(np.array(["KEEP", "REJECT", "KEEP", "MAYBE"]), np.array(["KEEP", "KEEP", "REJECT", "MAYBE"]))
        self.assertAlmostEqual(report["agreement"], 0.5)
        self.assertAlmostEqual(report["false_reject_rate"], 0.5)
        self.assertAlmostEqual(report["false_keep_rate"], 1.0)
        self.assertEqual(report["confusion"]["KEEP"]["REJECT"], 1)

    def test_burst_and_overlap(self):
        groups = [{"members": [{"example": "a", "relevance": 3}, {"example": "b", "relevance": 0}]}, {"members": [{"example": "c", "relevance": 0}, {"example": "d", "relevance": 0}]}]
        scores = {"a": 1.0, "b": 2.0, "c": 0, "d": 0}
        result = M.burst_metrics(groups, scores.get)
        self.assertEqual(result["groups"], 1, "a group with no clear best is not scored")
        self.assertEqual(result["top1"], 0.0)
        self.assertEqual(result["top2"], 1.0)
        runs = np.array(["r", "r", "r"])
        self.assertAlmostEqual(M.target_overlap(runs, np.array([True, False, True]), np.array([3.0, 2.0, 1.0])), 1 / 3)

    def test_threshold_fit_never_rejects_more_keeps_than_allowed(self):
        rng = np.random.default_rng(1)
        scores = rng.uniform(0, 100, 500)
        final = np.where(scores > 55, "KEEP", np.where(scores < 30, "REJECT", "MAYBE"))
        final[:20] = "KEEP"
        reject, keep = _best_lines(scores, final, np.ones(500), max_false_reject=0.0)
        decided = np.where(scores >= keep, "KEEP", np.where(scores < reject, "REJECT", "MAYBE"))
        self.assertEqual(int(np.sum((final == "KEEP") & (decided == "REJECT"))), 0)


if __name__ == "__main__":
    unittest.main()
