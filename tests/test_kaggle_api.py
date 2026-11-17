"""Offline checks for submission validation and bounded receipts."""
import csv

from autoresearch_pi import kaggle_api


def _write(path, header, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(header)
        writer.writerows(rows)


def test_submission_validation_accepts_matching_ids_and_scores(tmp_path):
    sample = tmp_path / "sample_submission.csv"
    _write(sample, ["id", "target"], [["a", 0], ["b", 0], ["c", 0]])
    submission = tmp_path / "submission.csv"
    _write(submission, ["id", "target"], [["a", 0.1], ["b", 0.7], ["c", 0.4]])

    result = kaggle_api.validate_submission(submission, tmp_path)

    assert result["ok"] is True
    assert result["rows"] == 3
    assert result["id_set_matches_sample"] is True
    assert result["prediction_min"] == 0.1
    assert result["prediction_max"] == 0.7


def test_submission_validation_rejects_wrong_ids_and_nulls(tmp_path):
    sample = tmp_path / "sample_submission.csv"
    _write(sample, ["id", "target"], [["a", 0], ["b", 0]])
    wrong_ids = tmp_path / "wrong.csv"
    _write(wrong_ids, ["id", "target"], [["a", 0.1], ["c", 0.2]])
    nulls = tmp_path / "nulls.csv"
    _write(nulls, ["id", "target"], [["a", ""], ["b", 0.2]])

    assert kaggle_api.validate_submission(wrong_ids, tmp_path)["id_set_matches_sample"] is False
    result = kaggle_api.validate_submission(nulls, tmp_path)
    assert result["ok"] is False
    assert "empty prediction" in result["error"]


def test_submission_validation_rejects_column_and_row_count_mismatch(tmp_path):
    sample = tmp_path / "sample_submission.csv"
    _write(sample, ["id", "target"], [["a", 0], ["b", 0]])
    columns = tmp_path / "columns.csv"
    _write(columns, ["id", "prediction"], [["a", 0.1], ["b", 0.2]])
    rows = tmp_path / "rows.csv"
    _write(rows, ["id", "target"], [["a", 0.1]])

    assert kaggle_api.validate_submission(columns, tmp_path)["ok"] is False
    assert "rows" in kaggle_api.validate_submission(rows, tmp_path)["error"]


def test_number_rejects_nan_and_infinity():
    assert kaggle_api._number("0.5") == 0.5
    assert kaggle_api._number("nan") is None
    assert kaggle_api._number("inf") is None
    assert kaggle_api._number(None) is None
