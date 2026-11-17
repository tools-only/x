"""Generic tabular baseline: fold-safe preprocessing, LightGBM, OOF and submission.

This is a starting point, not a prescribed solution. Args (argv[1] JSON):
  data_dir, out_dir, folds, seed, metric, id_column, target_column
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, LGBMRegressor, early_stopping, log_evaluation
from sklearn.metrics import accuracy_score, log_loss, mean_squared_error, roc_auc_score
from sklearn.model_selection import KFold, StratifiedKFold


def metric_value(metric: str, y_true, prediction, probability=None) -> float:
    name = metric.lower().replace(" ", "_")
    if "auc" in name:
        return float(roc_auc_score(y_true, probability))
    if "logloss" in name or "log_loss" in name or "entropy" in name:
        return float(log_loss(y_true, probability))
    if "rmse" in name or "root_mean_squared" in name:
        return float(math.sqrt(mean_squared_error(y_true, prediction)))
    if "mae" in name or "mean_absolute" in name:
        return float(np.mean(np.abs(np.asarray(y_true) - np.asarray(prediction))))
    if "accuracy" in name:
        return float(accuracy_score(y_true, prediction))
    raise ValueError(f"Unsupported metric: {metric}")


def infer_columns(train: pd.DataFrame, test: pd.DataFrame, sample: pd.DataFrame, args: dict):
    id_column = args.get("id_column") or sample.columns[0]
    target_column = args.get("target_column")
    if not target_column:
        candidates = [column for column in train.columns if column not in test.columns and column != id_column]
        target_column = candidates[-1] if candidates else None
    if target_column is None or target_column not in train.columns:
        raise ValueError("Could not infer the target column. Pass target_column in args.")
    prediction_columns = [column for column in sample.columns if column != id_column]
    return id_column, target_column, prediction_columns


def main() -> None:
    started = time.time()
    args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    data_dir = Path(args.get("data_dir") or os.environ["KAGGLE_DATA_DIR"])
    out_dir = Path(args.get("out_dir") or (Path(os.environ["KAGGLE_WORK_DIR"]) / "baseline"))
    out_dir.mkdir(parents=True, exist_ok=True)
    train = pd.read_csv(data_dir / "train.csv")
    test = pd.read_csv(data_dir / "test.csv")
    sample = pd.read_csv(data_dir / "sample_submission.csv")
    id_column, target_column, prediction_columns = infer_columns(train, test, sample, args)
    metric = args.get("metric") or "ROC AUC"
    folds = int(args.get("folds") or 5)
    seed = int(args.get("seed") or 42)
    y = train[target_column].to_numpy()
    features = [column for column in train.columns if column not in {id_column, target_column}]
    train_x = train[features].copy()
    test_x = test[features].copy()
    for frame in (train_x, test_x):
        for column in frame.columns:
            if frame[column].dtype == "object" or str(frame[column].dtype).startswith("category"):
                frame[column] = frame[column].astype("category")
            else:
                frame[column] = pd.to_numeric(frame[column], errors="coerce").astype("float32")
    is_classification = "auc" in metric.lower() or "logloss" in metric.lower() or "accuracy" in metric.lower()
    if not is_classification:
        classifier = None
    else:
        classifier = LGBMClassifier(
            objective="binary" if len(np.unique(y)) == 2 else "multiclass",
            n_estimators=3000, learning_rate=0.04, num_leaves=63, min_child_samples=40,
            subsample=0.85, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
            random_state=seed, n_jobs=int(os.environ.get("OMP_NUM_THREADS", "8")), verbosity=-1,
        )
    splitter = (StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
                if is_classification else KFold(n_splits=folds, shuffle=True, random_state=seed))
    oof = np.zeros(len(train))
    test_prediction = np.zeros(len(test))
    scores = []
    for fold, (train_index, valid_index) in enumerate(splitter.split(train_x, y if is_classification else None)):
        model = classifier if classifier is not None else LGBMRegressor(n_estimators=3000, learning_rate=0.04,
            num_leaves=63, min_child_samples=40, subsample=0.85, subsample_freq=1, colsample_bytree=0.8,
            reg_lambda=1.0, random_state=seed, n_jobs=int(os.environ.get("OMP_NUM_THREADS", "8")), verbosity=-1)
        model.fit(train_x.iloc[train_index], y[train_index], eval_set=[(train_x.iloc[valid_index], y[valid_index])],
                  eval_metric="auc" if "auc" in metric.lower() else "rmse",
                  callbacks=[early_stopping(100, verbose=False), log_evaluation(0)])
        if is_classification:
            probability = model.predict_proba(train_x.iloc[valid_index])[:, 1]
            oof[valid_index] = probability
            test_prediction += model.predict_proba(test_x)[:, 1] / folds
            score = metric_value(metric, y[valid_index], (probability >= 0.5).astype(int), probability)
        else:
            prediction = model.predict(train_x.iloc[valid_index])
            oof[valid_index] = prediction
            test_prediction += model.predict(test_x) / folds
            score = metric_value(metric, y[valid_index], prediction)
        scores.append(score)
        print(json.dumps({"fold": fold + 1, "score": score, "best_iteration": model.best_iteration_}))
    submission = sample.copy()
    submission[prediction_columns[0]] = test_prediction
    submission_path = out_dir / "submission.csv"
    submission.to_csv(submission_path, index=False)
    np.save(out_dir / "oof.npy", oof)
    np.save(out_dir / "test_prediction.npy", test_prediction)
    pd.DataFrame({id_column: train[id_column], "oof": oof}).to_csv(out_dir / "oof.csv", index=False)
    print(json.dumps({
        "ok": True, "metric": metric, "cv_mean": float(np.mean(scores)), "cv_std": float(np.std(scores)),
        "folds": scores, "rows": len(train), "features": len(features), "submission": str(submission_path),
        "duration_s": round(time.time() - started, 1),
    }))


if __name__ == "__main__":
    main()
