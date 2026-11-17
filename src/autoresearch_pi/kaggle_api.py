"""Kaggle competition bridge for the task host.

The agent never receives credentials. This module owns authentication and
returns only bounded, factual receipts: submission status, scores, rank and
file metadata.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any


def _emit(payload: dict[str, Any], code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False, default=str))
    raise SystemExit(code)


def _credentials_present() -> bool:
    if os.getenv("KAGGLE_API_TOKEN"):
        return True
    if os.getenv("KAGGLE_USERNAME") and os.getenv("KAGGLE_KEY"):
        return True
    home = Path.home() / ".kaggle"
    return any((home / name).exists() for name in ("credentials.json", "access_token", "kaggle.json"))


def _api():
    if not _credentials_present():
        _emit({
            "ok": False,
            "error": "Kaggle credentials are not configured.",
            "hint": "Set KAGGLE_API_TOKEN from https://www.kaggle.com/settings/api, "
                    "or place kaggle.json under ~/.kaggle/, then accept the competition rules in a browser.",
        }, 2)
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    try:
        api.authenticate()
    except BaseException as error:  # Kaggle's CLI helper can exit rather than raise.
        _emit({"ok": False, "error": f"Kaggle authentication failed: {error}"}, 2)
    return api


def _snake_key(key: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()


def _normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {_snake_key(str(key)): _normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    return value


def _dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    for name in ("to_dict", "to_json"):
        method = getattr(value, name, None)
        if callable(method):
            try:
                result = method()
                return _normalize(json.loads(result) if isinstance(result, str) else dict(result))
            except Exception:
                pass
    try:
        return _normalize({key: getattr(value, key) for key in dir(value) if not key.startswith("_") and not callable(getattr(value, key))})
    except Exception:
        return {"value": str(value)}


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _score_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        item = {key: row.get(key) for key in ("ref", "file_name", "date", "description", "status",
                                              "public_score", "private_score", "error_description", "team_name")}
        item["public_score"] = _number(item.get("public_score"))
        item["private_score"] = _number(item.get("private_score"))
        result.append(item)
    return result


def _submissions(api, slug: str, page_size: int = 50) -> list[dict[str, Any]]:
    try:
        rows = api.competition_submissions(slug, page_size=page_size) or []
    except TypeError:
        rows = api.competition_submissions(slug) or []
    return [_dict(row) for row in rows if row is not None]


def _limits(api, slug: str) -> dict[str, Any]:
    return {"num_today": 0, "num_total": 0, "num_allowed_now": 0, "limited_by_total": False,
            **_dict(api.competition_get_submission_limits(slug))}


def _sample_submission(data_dir: Path) -> Path | None:
    direct = data_dir / "sample_submission.csv"
    if direct.exists():
        return direct
    for path in sorted(data_dir.rglob("*sample*submission*.csv")):
        return path
    for path in sorted(data_dir.rglob("*.csv")):
        if "sample" in path.name.lower():
            return path
    return None


def validate_submission(file: Path, data_dir: Path) -> dict[str, Any]:
    if not file.exists():
        return {"ok": False, "error": f"Submission file does not exist: {file}"}
    sample = _sample_submission(data_dir)
    if sample is None:
        return {"ok": True, "skipped": "sample_submission.csv is not available; format checks were skipped.",
                "rows": None, "columns": None}
    with sample.open("r", encoding="utf-8-sig", newline="") as stream:
        sample_reader = csv.reader(stream)
        sample_header = next(sample_reader, [])
        sample_rows = sum(1 for _ in sample_reader)
    with file.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader, [])
        rows: list[list[str]] = []
        for index, row in enumerate(reader):
            if len(row) != len(header):
                return {"ok": False, "error": f"Row {index + 2} has {len(row)} fields; header has {len(header)}."}
            rows.append(row)
    if [column.strip() for column in header] != [column.strip() for column in sample_header]:
        return {"ok": False, "error": "Submission columns do not match sample_submission.csv.",
                "submission_columns": header, "sample_columns": sample_header}
    if len(rows) != sample_rows:
        return {"ok": False, "error": f"Submission has {len(rows)} data rows; sample has {sample_rows}."}
    id_index = 0
    prediction_indexes = [index for index in range(len(header)) if index != id_index]
    nulls = 0
    minimum = math.inf
    maximum = -math.inf
    ids: set[str] = set()
    duplicate_ids = 0
    for row in rows:
        key = row[id_index].strip()
        if key in ids:
            duplicate_ids += 1
        ids.add(key)
        for index in prediction_indexes:
            value = row[index].strip()
            if not value:
                nulls += 1
                continue
            number = _number(value)
            if number is None:
                return {"ok": False, "error": f"Non-numeric prediction in column {header[index]!r}."}
            minimum = min(minimum, number)
            maximum = max(maximum, number)
    if nulls:
        return {"ok": False, "error": f"{nulls} empty prediction values."}
    if duplicate_ids:
        return {"ok": False, "error": f"{duplicate_ids} duplicate id values."}
    with sample.open("r", encoding="utf-8-sig", newline="") as stream:
        sample_reader = csv.reader(stream)
        next(sample_reader, [])
        sample_ids = {row[0].strip() for row in sample_reader if row}
    id_match = ids == sample_ids
    return {
        "ok": True, "rows": len(rows), "columns": header, "id_column": header[id_index],
        "prediction_columns": [header[index] for index in prediction_indexes],
        "id_set_matches_sample": id_match, "sample_id_count": len(sample_ids),
        "prediction_min": None if minimum is math.inf else minimum,
        "prediction_max": None if maximum is -math.inf else maximum,
    }


def command_validate(args) -> None:
    _emit(validate_submission(Path(args.file).resolve(), Path(args.data_dir).resolve()))


def command_limits(args) -> None:
    api = _api()
    limits = _limits(api, args.competition)
    _emit({"ok": True, **limits})


def command_download(args) -> None:
    api = _api()
    destination = Path(args.dest).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    try:
        files = _dict(api.competition_list_files(args.competition)).get("files") or []
        api.competition_download_files(args.competition, path=str(destination), force=True, quiet=True, unzip=True)
    except BaseException as error:
        _emit({"ok": False, "error": f"Competition download failed: {error}",
               "hint": "Open the competition page, accept its rules with the same Kaggle account, then retry."}, 1)
    downloaded = []
    for path in sorted(destination.rglob("*")):
        if path.is_file():
            downloaded.append({"path": str(path.relative_to(destination)), "bytes": path.stat().st_size})
    _emit({"ok": True, "destination": str(destination), "files": downloaded,
           "listed_files": [_dict(row) for row in files]})


def command_submit(args) -> None:
    api = _api()
    file = Path(args.file).resolve()
    validation = validate_submission(file, Path(args.data_dir).resolve())
    if not validation.get("ok"):
        _emit({"ok": False, "stage": "validation", "validation": validation}, 1)
    limits = _limits(api, args.competition)
    if int(limits.get("num_allowed_now", 0) or 0) <= 0:
        _emit({"ok": False, "stage": "limits", "error": "No submission allowance remains now.", "limits": limits}, 1)
    before = {row.get("ref") for row in _submissions(api, args.competition, page_size=50)}
    try:
        response = api.competition_submit(str(file), args.message, args.competition, quiet=True)
    except BaseException as error:
        _emit({"ok": False, "stage": "upload", "error": f"Kaggle submission failed: {error}", "limits": limits}, 1)
    response_dict = _dict(response)
    ref = response_dict.get("ref")
    deadline = time.time() + max(10, int(args.wait))
    latest: dict[str, Any] = {}
    while True:
        rows = _submissions(api, args.competition, page_size=50)
        selected = next((row for row in rows if ref and row.get("ref") == ref), None)
        if selected is None and not ref:
            fresh = [row for row in rows if row.get("ref") not in before]
            selected = max(fresh, key=lambda row: str(row.get("date") or ""), default=None)
        if selected:
            latest = _dict(selected)
            ref = latest.get("ref", ref)
            status = str(latest.get("status") or "").lower()
            if status and status not in {"pending", "submitted"}:
                break
        if time.time() >= deadline:
            break
        time.sleep(5)
    status = str(latest.get("status") or response_dict.get("message") or "submitted").lower()
    public = _number(latest.get("public_score"))
    private = _number(latest.get("private_score"))
    ok = status not in {"error", "invalid", "failed"} and "error" not in str(latest.get("error_description") or "").lower()
    _emit({
        "ok": ok, "stage": "submitted", "ref": ref, "status": latest.get("status"),
        "public_score": public, "private_score": private,
        "error_description": latest.get("error_description"),
        "message": response_dict.get("message"), "limits": _limits(api, args.competition),
        "validation": validation,
    }, 0 if ok else 1)


def _leaderboard(api, slug: str, top: int) -> list[dict[str, Any]]:
    rows = api.competition_leaderboard_view(slug, page_size=max(1, top)) or []
    result = []
    for rank, row in enumerate(rows, 1):
        item = _dict(row)
        result.append({"rank": rank, "team_name": item.get("team_name"), "score": _number(item.get("score")),
                       "submission_date": item.get("submission_date")})
    return result


def _full_leaderboard(api, slug: str) -> list[dict[str, Any]]:
    with tempfile.TemporaryDirectory() as directory:
        api.competition_leaderboard_download(slug, directory, quiet=True)
        archives = sorted(Path(directory).glob("*.zip"))
        if not archives:
            return []
        with zipfile.ZipFile(archives[0]) as archive:
            names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
            if not names:
                return []
            text = archive.read(names[0]).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    score_key = next((key for key in (reader.fieldnames or []) if key.lower() in {"score", "publicscore"}), None)
    team_key = next((key for key in (reader.fieldnames or []) if key.lower() in {"teamname", "team"}), None)
    rows = []
    for row in reader:
        rows.append({"team_name": row.get(team_key) if team_key else None, "score": _number(row.get(score_key)) if score_key else None})
    rows.sort(key=lambda row: (-(row["score"] if row["score"] is not None else -math.inf), str(row["team_name"])))
    for index, row in enumerate(rows, 1):
        row["rank"] = index
    return rows


def command_status(args) -> None:
    api = _api()
    limits = _limits(api, args.competition)
    recent = _score_rows(_submissions(api, args.competition, page_size=50))
    public_scores = [row["public_score"] for row in recent if row.get("public_score") is not None]
    best_score = max(public_scores) if public_scores else None
    team = next((row.get("team_name") for row in recent if row.get("team_name")), None)
    top = _leaderboard(api, args.competition, args.top)
    full_rows: list[dict[str, Any]] = []
    rank = None
    total = None
    percentile = None
    gap = None
    if args.full:
        try:
            full_rows = _full_leaderboard(api, args.competition)
        except BaseException as error:
            full_rows = []
            note = f"Full leaderboard unavailable: {error}"
        else:
            note = None
        if full_rows and best_score is not None:
            rank = 1 + sum(1 for row in full_rows if row["score"] is not None and row["score"] > best_score)
            total = len(full_rows)
            percentile = round(100.0 * (1.0 - (rank - 1) / max(1, total)), 2)
        if full_rows:
            cutoff = full_rows[min(9, len(full_rows) - 1)]["score"]
            if best_score is not None and cutoff is not None:
                gap = round(cutoff - best_score, 8)
            top = [{"rank": row["rank"], "team_name": row["team_name"], "score": row["score"]}
                   for row in full_rows[: max(1, args.top)]]
    else:
        note = None
    _emit({
        "ok": True, "competition": args.competition, "limits": limits, "team_name": team,
        "best": {"public_score": best_score, "rank": rank, "total_teams": total, "percentile": percentile,
                 "gap_to_top10": gap},
        "recent_submissions": recent, "top": top, "full_leaderboard_rows": len(full_rows), "note": note,
    })


def command_info(args) -> None:
    api = _api()
    try:
        competitions = _dict(api.competitions_list(search=args.competition)).get("competitions") or []
    except BaseException:
        competitions = []
    match = None
    for competition in competitions:
        item = competition if isinstance(competition, dict) else _dict(competition)
        if str(item.get("ref") or item.get("id") or "").endswith(args.competition):
            match = item
            break
    files = []
    try:
        files = [_dict(row) for row in (_dict(api.competition_list_files(args.competition)).get("files") or [])]
    except BaseException as error:
        files = [{"error": str(error)}]
    _emit({"ok": True, "competition": match, "files": files})


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("validate")
    prepare.add_argument("--competition", required=True)
    prepare.add_argument("--file", required=True)
    prepare.add_argument("--data-dir", required=True)
    prepare.set_defaults(func=command_validate)
    limits = sub.add_parser("limits")
    limits.add_argument("--competition", required=True)
    limits.set_defaults(func=command_limits)
    download = sub.add_parser("download")
    download.add_argument("--competition", required=True)
    download.add_argument("--dest", required=True)
    download.set_defaults(func=command_download)
    submit = sub.add_parser("submit")
    submit.add_argument("--competition", required=True)
    submit.add_argument("--file", required=True)
    submit.add_argument("--message", default="agent iteration")
    submit.add_argument("--data-dir", required=True)
    submit.add_argument("--wait", type=int, default=120)
    submit.set_defaults(func=command_submit)
    status = sub.add_parser("status")
    status.add_argument("--competition", required=True)
    status.add_argument("--top", type=int, default=10)
    status.add_argument("--full", action="store_true")
    status.set_defaults(func=command_status)
    info = sub.add_parser("info")
    info.add_argument("--competition", required=True)
    info.set_defaults(func=command_info)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
