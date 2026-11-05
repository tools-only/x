"""Render HTML-first or JSON-fallback presentation sources to PowerPoint."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt


def render(root: Path, manifest: Path, revision: int) -> dict:
    artifacts = root / "workspace" / "artifacts"
    digest = hashlib.sha256()
    for path in sorted(p for p in artifacts.rglob("*") if p.is_file()):
        digest.update(path.relative_to(artifacts).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    source_hash = digest.hexdigest()
    source_bytes = manifest.read_bytes()
    html_source = manifest.suffix.lower() in (".html", ".htm")
    browser_warnings = []
    out = root / "exports" / f"v{revision:03d}"
    out.mkdir(parents=True, exist_ok=False)
    if html_source:
        from playwright.sync_api import sync_playwright
        rendered_slides = out / "html-slides"
        rendered_slides.mkdir()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1,
                                    java_script_enabled=False)
            page.route("https://**/*", lambda route: route.abort())
            page.route("http://**/*", lambda route: route.abort())
            page.goto(manifest.resolve().as_uri(), wait_until="load", timeout=60000)
            elements = page.locator("[data-slide]")
            slide_count = elements.count()
            if not 1 <= slide_count <= 30:
                browser.close()
                raise ValueError("HTML must contain 1..30 elements marked data-slide")
            slides = []
            for index in range(slide_count):
                element = elements.nth(index)
                box = element.bounding_box()
                if not box or box["width"] <= 0 or box["height"] <= 0:
                    browser.close()
                    raise ValueError(f"HTML slide {index + 1} has no visible size")
                ratio = box["width"] / box["height"]
                if abs(ratio - 16 / 9) > 0.02:
                    browser_warnings.append({"page": index + 1, "issue": "slide_aspect_ratio", "actual": ratio, "expected": "16:9"})
                overflow = element.evaluate("el => ({width: el.scrollWidth > el.clientWidth + 1, height: el.scrollHeight > el.clientHeight + 1})")
                if overflow["width"] or overflow["height"]:
                    browser_warnings.append({"page": index + 1, "issue": "content_overflow", **overflow})
                image_path = rendered_slides / f"slide-{index + 1:02d}.png"
                element.screenshot(path=str(image_path), animations="disabled", timeout=30000)
                slides.append({"elements": [{"kind": "rendered_image", "path": str(image_path)}]})
            browser.close()
        spec = {"slides": slides, "width": 13.333333, "height": 7.5, "source_format": "html"}
    else:
        spec = json.loads(source_bytes)
        slides = spec["slides"]
    if not isinstance(slides, list) or not 1 <= len(slides) <= 30:
        raise ValueError("slides must contain 1..30 pages")
    width, height = spec.get("width", 13.333333), spec.get("height", 7.5)
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(width), Inches(height)
    warnings, counts = browser_warnings, {"text": 0, "rect": 0, "line": 0, "shape": 0, "chart": 0, "table": 0, "image": 0, "rendered_image": 0}
    for number, page in enumerate(slides, 1):
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = RGBColor.from_string(page.get("background", "FFFFFF").lstrip("#"))
        for index, el in enumerate(page["elements"]):
            kind = el["kind"]
            if kind == "rendered_image":
                slide.shapes.add_picture(el["path"], 0, 0, prs.slide_width, prs.slide_height)
                counts[kind] += 1
                continue
            if kind not in counts:
                raise ValueError(f"unsupported element kind: {kind}")
            x, y, w, h = [float(el[k]) for k in ("x", "y", "w", "h")]
            if w <= 0 or h <= 0:
                raise ValueError("element width/height must be positive")
            if x < 0 or y < 0 or x+w > width+.02 or y+h > height+.02:
                warnings.append({"page": number, "element": index, "issue": "outside_canvas"})
            box = [Inches(v) for v in (x, y, w, h)]
            if kind == "text":
                shape = slide.shapes.add_textbox(*box)
                tf = shape.text_frame
                tf.word_wrap = True
                tf.margin_left = tf.margin_right = Inches(el.get("margin", .03))
                tf.margin_top = tf.margin_bottom = Inches(el.get("margin", .03))
                tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE, "bottom": MSO_ANCHOR.BOTTOM}[el.get("valign", "top")]
                lines = el.get("paragraphs") or [{"runs": el.get("runs", [{"text": line}])} for line in str(el.get("text", "")).split("\n")]
                for j, line in enumerate(lines):
                    p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
                    for part in line["runs"]:
                        run = p.add_run()
                        run.text = str(part["text"])
                        run.font.name = part.get("font", el.get("font", spec.get("font", "Aptos")))
                        run.font.size = Pt(part.get("size", el.get("size", 20)))
                        run.font.bold = part.get("bold", el.get("bold", False))
                        run.font.italic = part.get("italic", el.get("italic", False))
                        run.font.color.rgb = RGBColor.from_string(part.get("color", el.get("color", "172B4D")).lstrip("#"))
                    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}[el.get("align", "left")]
                    p.space_after = Pt(el.get("space_after", 5))
            elif kind in ("rect", "line", "shape"):
                geometry = {"rect": MSO_SHAPE.RECTANGLE, "line": MSO_SHAPE.RECTANGLE,
                            "ellipse": MSO_SHAPE.OVAL, "rounded_rect": MSO_SHAPE.ROUNDED_RECTANGLE,
                            "chevron": MSO_SHAPE.CHEVRON, "triangle": MSO_SHAPE.ISOSCELES_TRIANGLE}
                form = el.get("shape", "rect") if kind == "shape" else kind
                if form not in geometry:
                    raise ValueError(f"unsupported shape: {form}")
                shape = slide.shapes.add_shape(geometry[form], *box)
                shape.fill.solid()
                shape.fill.fore_color.rgb = RGBColor.from_string(el.get("fill", "DCE6F1").lstrip("#"))
                if el.get("stroke"):
                    shape.line.color.rgb = RGBColor.from_string(el["stroke"].lstrip("#"))
                    shape.line.width = Pt(el.get("stroke_width", 1))
                else:
                    shape.line.fill.background()
            elif kind == "chart":
                data = CategoryChartData()
                data.categories = el["categories"]
                for series in el["series"]:
                    if len(series["values"]) != len(el["categories"]):
                        raise ValueError("chart categories/series lengths differ")
                    data.add_series(series["name"], series["values"])
                chart = slide.shapes.add_chart({"bar": XL_CHART_TYPE.BAR_CLUSTERED, "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
                    "line": XL_CHART_TYPE.LINE, "pie": XL_CHART_TYPE.PIE}[el.get("type", "column")], *box, data).chart
                chart.has_legend = el.get("show_legend", len(el["series"]) > 1)
                if chart.has_legend:
                    chart.legend.position = {"bottom": XL_LEGEND_POSITION.BOTTOM, "right": XL_LEGEND_POSITION.RIGHT,
                                             "top": XL_LEGEND_POSITION.TOP, "left": XL_LEGEND_POSITION.LEFT}[el.get("legend_position", "bottom")]
                chart.has_title = el.get("show_title", bool(el.get("title")))
                if chart.has_title:
                    chart.chart_title.text_frame.text = el.get("title", "")
                if el.get("type") != "pie":
                    chart.value_axis.has_title = bool(el.get("unit"))
                    if chart.value_axis.has_title:
                        chart.value_axis.axis_title.text_frame.text = el["unit"]
                    if "axis_min" in el:
                        chart.value_axis.minimum_scale = el["axis_min"]
                    if "axis_max" in el:
                        chart.value_axis.maximum_scale = el["axis_max"]
                    if "number_format" in el:
                        chart.value_axis.tick_labels.number_format = el["number_format"]
                    chart.category_axis.tick_labels.font.size = Pt(12)
                    chart.value_axis.tick_labels.font.size = Pt(11)
                for j, series in enumerate(chart.series):
                    series.format.fill.solid()
                    series.format.fill.fore_color.rgb = RGBColor.from_string(el.get("colors", ["0E4D64", "C8A45D", "4E8A8A"])[j % len(el.get("colors", [1, 2, 3]))].lstrip("#"))
                    if el.get("negative_color") and el.get("type", "column") in ("column", "bar"):
                        for i, value in enumerate(el["series"][j]["values"]):
                            if value < 0:
                                series.points[i].format.fill.solid()
                                series.points[i].format.fill.fore_color.rgb = RGBColor.from_string(el["negative_color"].lstrip("#"))
                chart.plots[0].has_data_labels = el.get("labels", True)
                if chart.plots[0].has_data_labels:
                    chart.plots[0].data_labels.font.size = Pt(12)
                    if "number_format" in el:
                        chart.plots[0].data_labels.number_format = el["number_format"]
            elif kind == "table":
                rows = el["rows"]
                if not rows or any(len(r) != len(rows[0]) for r in rows):
                    raise ValueError("table rows must have equal length")
                table = slide.shapes.add_table(len(rows), len(rows[0]), *box).table
                for r, row in enumerate(rows):
                    for c, value in enumerate(row):
                        cell = table.cell(r, c)
                        cell.text = str(value)
                        cell.fill.solid()
                        cell.fill.fore_color.rgb = RGBColor.from_string(el.get("header_fill", "0E4D64") if r == 0 else ("EEF3F5" if r % 2 else "FFFFFF"))
                        for p in cell.text_frame.paragraphs:
                            p.font.name = spec.get("font", "Aptos")
                            p.font.size = Pt(el.get("size", 17))
                            p.font.bold = r == 0
                            p.font.color.rgb = RGBColor.from_string("FFFFFF" if r == 0 else "172B4D")
            else:
                image = (root / "workspace" / el["path"]).resolve()
                if not image.is_relative_to((root / "workspace" / "data").resolve()):
                    raise ValueError("images must come from data/")
                slide.shapes.add_picture(str(image), *box)
            counts[kind] += 1
        if page.get("notes"):
            slide.notes_slide.notes_text_frame.text = page["notes"]
    pptx = out / "deck.pptx"
    prs.save(pptx)
    # This is PowerPoint's actual layout/export path, not a substitute HTML rendering.
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("PowerPoint.Application")
    presentation = None
    try:
        presentation = app.Presentations.Open(str(pptx), ReadOnly=True, Untitled=False, WithWindow=False)
        presentation.SaveAs(str(out / "deck.pdf"), 32)
        for n in range(1, presentation.Slides.Count + 1):
            page = presentation.Slides(n)
            page.Export(str(out / f"slide-{n:02d}.png"), "PNG", 1600, 900)
            for k in range(1, page.Shapes.Count + 1):
                shape = page.Shapes(k)
                if shape.HasTextFrame and shape.TextFrame.HasText:
                    if shape.TextFrame2.TextRange.BoundHeight > shape.Height + 3:
                        warnings.append({"page": n, "shape": k, "issue": "text_height_exceeds_box", "text": shape.TextFrame.TextRange.Text[:90]})
    finally:
        if presentation is not None:
            presentation.Close()
        if app.Presentations.Count == 0:
            app.Quit()
        pythoncom.CoUninitialize()
    # Read the fonts PowerPoint actually wrote to PDF; this detects substitutions that geometry checks miss.
    import pymupdf
    document = pymupdf.open(out / "deck.pdf")
    for n, page in enumerate(document, 1):
        actual = set()
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    name = span["font"].split("+")[-1]
                    try:
                        name = name.encode("latin1").decode("utf-8")
                    except UnicodeError:
                        pass
                    actual.add(name.lower())
        requested = {part.get("font", el.get("font", spec.get("font", "Aptos"))) for el in slides[n-1]["elements"]
                     if el["kind"] == "text" for line in (el.get("paragraphs") or [{"runs": el.get("runs", [{}])}])
                     for part in line["runs"]}
        if any(el["kind"] == "table" for el in slides[n-1]["elements"]):
            requested.add(spec.get("font", "Aptos"))
        for font in requested:
            if not any(font.lower().replace(" ", "") in used.replace(" ", "") for used in actual):
                warnings.append({"page": n, "issue": "font_substituted", "requested": font,
                                 "actual_pdf_fonts": sorted(actual)})
    document.close()
    from PIL import Image, ImageOps, ImageDraw
    thumb_w, thumb_h, columns = 480, 270, 3
    canvas = Image.new("RGB", (columns*thumb_w, ((len(slides)+columns-1)//columns)*(thumb_h+24)), "#dfe5e9")
    draw = ImageDraw.Draw(canvas)
    for i in range(len(slides)):
        img = Image.open(out / f"slide-{i+1:02d}.png").convert("RGB")
        canvas.paste(ImageOps.fit(img, (thumb_w, thumb_h)), ((i % columns)*thumb_w, (i//columns)*(thumb_h+24)))
        draw.text(((i % columns)*thumb_w+6, (i//columns)*(thumb_h+24)+thumb_h+4), str(i+1), fill="black")
    canvas.save(out / "contact-sheet.png")
    result = {"revision": revision, "slides": len(slides), "native_objects": counts, "warnings": warnings,
              "renderer": "Microsoft Edge HTML + Microsoft PowerPoint 16 COM" if html_source else "Microsoft PowerPoint 16 COM",
              "source_format": "html" if html_source else "json", "source_sha256": source_hash,
              "output": str(out), "source": spec}
    (out / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return {k: v for k, v in result.items() if k != "source"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("revision", type=int)
    args = parser.parse_args()
    print(json.dumps(render(args.root.resolve(), args.manifest.resolve(), args.revision)))
