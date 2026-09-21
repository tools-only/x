#!/usr/bin/env python3
"""Render ARC bridge action frames into a compact trajectory video/GIF.

The renderer intentionally reads bridge-events.jsonl instead of the much larger
pi-events/task-checkpoint logs. Each action event is expected to carry the ARC
frame grid after that action.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont


ARC_COLORS: dict[int, tuple[int, int, int]] = {
    0: (18, 18, 18),
    1: (0, 116, 217),
    2: (255, 65, 54),
    3: (46, 204, 64),
    4: (255, 220, 0),
    5: (170, 170, 170),
    6: (240, 18, 190),
    7: (255, 133, 27),
    8: (127, 219, 255),
    9: (135, 12, 37),
    10: (255, 255, 255),
    11: (76, 70, 50),
    12: (177, 63, 191),
}


@dataclass
class Step:
    index: int
    action: str
    grid: list[list[int]]
    state: str | None
    levels_completed: int | None
    budget: dict[str, Any] | None
    changed_cells: int | None
    bbox: dict[str, int] | None


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/consola.ttf"),
        Path("C:/Windows/Fonts/consolab.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
        Path("/Library/Fonts/Menlo.ttc"),
    ]
    for candidate in candidates:
        try:
            if candidate.exists():
                return ImageFont.truetype(str(candidate), size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def iter_action_steps(events_path: Path) -> Iterable[Step]:
    with events_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get("event") != "action":
                continue

            frame = event.get("frame") or {}
            frames = frame.get("frames") or []
            if not frames:
                continue

            delta = event.get("observation_delta") or frame.get("observation_delta") or {}
            budget = event.get("action_budget") or frame.get("action_budget")
            yield Step(
                index=int(event.get("index") or 0),
                action=str(event.get("action") or ""),
                grid=frames[-1],
                state=frame.get("state") or event.get("state_after") or event.get("state_before"),
                levels_completed=frame.get("levels_completed") or event.get("level_after") or event.get("level_before"),
                budget=budget,
                changed_cells=delta.get("changed_cells"),
                bbox=delta.get("bbox"),
            )


def fit_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def grid_image(
    step: Step,
    *,
    frame_no: int,
    cell: int,
    panel_width: int,
    font: ImageFont.ImageFont,
    small_font: ImageFont.ImageFont,
    total_steps: int,
    run_name: str,
) -> Image.Image:
    rows = len(step.grid)
    cols = len(step.grid[0]) if rows else 0
    grid_w = cols * cell
    grid_h = rows * cell
    margin = 24
    top = 24
    bottom = 28
    width = grid_w + panel_width + margin * 3
    height = max(grid_h + top + bottom, 520)

    image = Image.new("RGB", (width, height), (28, 30, 34))
    draw = ImageDraw.Draw(image)

    gx = margin
    gy = top
    draw.rounded_rectangle(
        [gx - 4, gy - 4, gx + grid_w + 4, gy + grid_h + 4],
        radius=8,
        fill=(8, 9, 10),
        outline=(72, 76, 84),
        width=2,
    )

    for r, row in enumerate(step.grid):
        for c, value in enumerate(row):
            x0 = gx + c * cell
            y0 = gy + r * cell
            color = ARC_COLORS.get(int(value), ((37 * int(value)) % 256, (83 * int(value)) % 256, (131 * int(value)) % 256))
            draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=color)

    if step.bbox:
        left = step.bbox.get("left", 0)
        top_row = step.bbox.get("top", 0)
        right = step.bbox.get("right", left)
        bottom_row = step.bbox.get("bottom", top_row)
        draw.rectangle(
            [
                gx + left * cell,
                gy + top_row * cell,
                gx + (right + 1) * cell - 1,
                gy + (bottom_row + 1) * cell - 1,
            ],
            outline=(255, 255, 255),
            width=max(1, cell // 3),
        )

    px = gx + grid_w + margin
    py = top
    draw.text((px, py), "ARC Agent Trajectory", fill=(245, 245, 245), font=font)
    py += 36
    draw.text((px, py), run_name, fill=(170, 178, 190), font=small_font)
    py += 34

    budget_text = "budget: n/a"
    if step.budget:
        used = step.budget.get("used")
        maximum = step.budget.get("maximum")
        total_used = step.budget.get("total_used")
        total_maximum = step.budget.get("total_maximum")
        if used is not None and maximum is not None:
            budget_text = f"level budget: {used}/{maximum}"
        if total_used is not None and total_maximum is not None:
            budget_text += f"   total: {total_used}/{total_maximum}"

    info_lines = [
        f"frame: {frame_no}/{total_steps}",
        f"log action index: {step.index}",
        f"action: {step.action}",
        f"state: {step.state or 'unknown'}",
        f"levels completed: {step.levels_completed}",
        budget_text,
        f"changed cells: {step.changed_cells if step.changed_cells is not None else 'n/a'}",
    ]
    for line in info_lines:
        for fitted in fit_lines(draw, line, small_font, panel_width):
            draw.text((px, py), fitted, fill=(225, 230, 236), font=small_font)
            py += 24
        py += 4

    py += 14
    draw.text((px, py), "color legend", fill=(245, 245, 245), font=font)
    py += 32
    legend_items = sorted({cell for row in step.grid for cell in row})
    swatch = 20
    for i, value in enumerate(legend_items):
        lx = px + (i % 4) * 78
        ly = py + (i // 4) * 32
        draw.rectangle([lx, ly, lx + swatch, ly + swatch], fill=ARC_COLORS.get(value, (120, 120, 120)))
        draw.text((lx + 28, ly - 1), str(value), fill=(220, 224, 230), font=small_font)

    progress_x = margin
    progress_y = height - 18
    progress_w = width - 2 * margin
    progress = frame_no / max(total_steps, 1)
    draw.rounded_rectangle([progress_x, progress_y, progress_x + progress_w, progress_y + 6], radius=3, fill=(70, 74, 82))
    draw.rounded_rectangle(
        [progress_x, progress_y, progress_x + math.floor(progress_w * progress), progress_y + 6],
        radius=3,
        fill=(127, 219, 255),
    )
    return image


def save_gif(frames: list[Image.Image], output_path: Path, duration_ms: int) -> None:
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
    )


def try_save_webp(frames: list[Image.Image], output_path: Path, duration_ms: int) -> str | None:
    try:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=duration_ms,
            loop=0,
            quality=82,
            method=0,
        )
        return None
    except Exception as exc:  # pragma: no cover - best-effort optional output
        return f"{type(exc).__name__}: {exc}"


def try_save_mp4(frames: list[Image.Image], output_path: Path, fps: int) -> str | None:
    if importlib.util.find_spec("imageio_ffmpeg") is None:
        return "imageio-ffmpeg is not installed and ffmpeg is not on PATH"
    try:
        import imageio.v2 as imageio
        import numpy as np

        with imageio.get_writer(str(output_path), format="FFMPEG", fps=fps, codec="libx264", quality=8, macro_block_size=1) as writer:
            for frame in frames:
                writer.append_data(np.asarray(frame))
        return None
    except Exception as exc:  # pragma: no cover - best-effort optional output
        return f"{type(exc).__name__}: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--cell", type=int, default=8)
    parser.add_argument("--duration-ms", type=int, default=120)
    parser.add_argument("--fps", type=int, default=8)
    args = parser.parse_args()

    run_dir = args.run_dir.resolve()
    events_path = run_dir / "bridge-events.jsonl"
    if not events_path.exists():
        raise SystemExit(f"missing bridge-events.jsonl: {events_path}")

    out_dir = (args.out_dir or run_dir / "trajectory-video").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    steps = list(iter_action_steps(events_path))
    if not steps:
        raise SystemExit(f"no action frames found in {events_path}")

    font = load_font(22)
    small_font = load_font(16)
    frames = []
    for frame_no, step in enumerate(steps, start=1):
        frames.append(
            grid_image(
                step,
                frame_no=frame_no,
                cell=args.cell,
                panel_width=360,
                font=font,
                small_font=small_font,
                total_steps=len(steps),
                run_name=run_dir.name,
            )
        )

    gif_path = out_dir / "arc-agent-trajectory.gif"
    save_gif(frames, gif_path, args.duration_ms)

    webp_path = out_dir / "arc-agent-trajectory.webp"
    webp_error = try_save_webp(frames, webp_path, args.duration_ms)
    if webp_error and webp_path.exists():
        webp_path.unlink()

    mp4_path = out_dir / "arc-agent-trajectory.mp4"
    mp4_error = try_save_mp4(frames, mp4_path, args.fps)
    if mp4_error and mp4_path.exists():
        mp4_path.unlink()

    frames[0].save(out_dir / "first-frame.png")
    frames[-1].save(out_dir / "last-frame.png")

    summary_path = run_dir / "summary.json"
    run_summary: dict[str, Any] = {}
    if summary_path.exists():
        with summary_path.open("r", encoding="utf-8") as fh:
            summary = json.load(fh)
        run_summary = {
            "completion_status": (summary.get("runtime") or {}).get("completion_status"),
            "run_complete": (summary.get("runtime") or {}).get("run_complete"),
            "pi_returncode": (summary.get("runtime") or {}).get("pi_returncode"),
            "benchmark_terminal_state": (summary.get("benchmark_evaluation") or {}).get("terminal_state"),
            "benchmark_levels_completed": (summary.get("benchmark_evaluation") or {}).get("levels_completed"),
            "benchmark_passed": (summary.get("benchmark_evaluation") or {}).get("passed"),
        }

    metadata = {
        "run_dir": str(run_dir),
        "source": str(events_path),
        "action_frames": len(steps),
        "first_step": steps[0].index,
        "last_step": steps[-1].index,
        "gif": str(gif_path),
        "webp": str(webp_path) if webp_path.exists() else None,
        "webp_error": webp_error,
        "mp4": str(mp4_path) if mp4_path.exists() else None,
        "mp4_error": mp4_error,
        "first_frame": str(out_dir / "first-frame.png"),
        "last_frame": str(out_dir / "last-frame.png"),
        "duration_ms_per_frame": args.duration_ms,
        "fps": args.fps,
        "run_summary": run_summary,
    }
    metadata_path = out_dir / "trajectory-metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(metadata, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
