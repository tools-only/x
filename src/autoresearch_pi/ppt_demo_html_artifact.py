"""Render the PPT demo scene as a self-contained, browser-playable HTML deck."""
from __future__ import annotations

import argparse
import base64
import html
import json
import math
import mimetypes
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


def _color(value: str, default: str = "172B4D") -> str:
    return "#" + str(value or default).lstrip("#")


def _chart(el: dict) -> str:
    width, height = 900, 480
    cats = el["categories"]
    if not cats or not el["series"] or any(len(series["values"]) != len(cats) for series in el["series"]):
        raise ValueError("charts need categories and matching non-empty series")
    values = [float(v) for series in el["series"] for v in series["values"]]
    low = min([0.0, *values, float(el.get("axis_min", 0))])
    high = max([1.0, *values, float(el.get("axis_max", 0))])
    pad = {"l": 70, "r": 25, "t": 55 if el.get("title") else 25, "b": 80}
    plot_w, plot_h = width-pad["l"]-pad["r"], height-pad["t"]-pad["b"]
    y = lambda value: pad["t"] + (high-value)/(high-low or 1)*plot_h
    marks = []
    if el.get("title"):
        marks.append(f'<text x="{width/2}" y="30" text-anchor="middle" class="chart-title">{html.escape(str(el["title"]))}</text>')
    marks.append(f'<line x1="{pad["l"]}" y1="{pad["t"]}" x2="{pad["l"]}" y2="{pad["t"]+plot_h}" class="axis"/>')
    marks.append(f'<line x1="{pad["l"]}" y1="{y(0)}" x2="{pad["l"]+plot_w}" y2="{y(0)}" class="axis"/>')
    palette = el.get("colors") or ["0E4D64", "C8A45D", "4E8A8A"]
    count, series_n = len(cats), len(el["series"])
    group = plot_w/max(count, 1)
    kind = el.get("type", "column")
    for i, label in enumerate(cats):
        if kind != "bar":
            marks.append(f'<text x="{pad["l"]+(i+.5)*group}" y="{height-42}" text-anchor="middle" class="axis-label">{html.escape(str(label))}</text>')
    if kind == "pie" and el["series"]:
        values = [max(0, float(v)) for v in el["series"][0]["values"]]
        total = sum(values) or 1
        angle, radius, cx, cy = -90.0, min(plot_w, plot_h)*.39, width/2, height/2
        for i, value in enumerate(values):
            end = angle + value/total*360
            x1, y1 = cx+radius*math.cos(math.radians(angle)), cy+radius*math.sin(math.radians(angle))
            x2, y2 = cx+radius*math.cos(math.radians(end)), cy+radius*math.sin(math.radians(end))
            large = 1 if end-angle > 180 else 0
            marks.append(f'<path d="M {cx} {cy} L {x1:.2f} {y1:.2f} A {radius} {radius} 0 {large} 1 {x2:.2f} {y2:.2f} Z" fill="{_color(palette[i%len(palette)])}"/>')
            angle = end
    elif kind == "line":
        for j, series in enumerate(el["series"]):
            pts = []
            for i, value in enumerate(series["values"]):
                px, py = pad["l"]+(i+.5)*group, y(float(value))
                pts.append(f"{px:.1f},{py:.1f}")
                marks.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="7" fill="{_color(palette[j%len(palette)])}"/>')
            marks.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{_color(palette[j%len(palette)])}" stroke-width="5"/>')
    else:
        for i in range(count):
            for j, series in enumerate(el["series"]):
                value = float(series["values"][i])
                bar_w = group*.72/(series_n if kind in ("column", "bar") else 1)
                if kind == "bar":
                    bar_h = group*.72/series_n
                    x0 = pad["l"]+(0-low)/(high-low or 1)*plot_w
                    xv = pad["l"]+(value-low)/(high-low or 1)*plot_w
                    y0 = pad["t"]+i*group+(group-bar_h*series_n)/2+j*bar_h
                    marks.append(f'<text x="{pad["l"]-10}" y="{y0+bar_h*.72:.1f}" text-anchor="end" class="axis-label">{html.escape(str(cats[i]))}</text>')
                    marks.append(f'<rect x="{min(x0,xv):.1f}" y="{y0:.1f}" width="{max(2,abs(xv-x0)):.1f}" height="{bar_h*.8:.1f}" fill="{_color(palette[j%len(palette)])}"/>')
                else:
                    x0 = pad["l"]+i*group+(group-bar_w*series_n)/2+j*bar_w
                    y0 = min(y(value), y(0))
                    fill = el.get("negative_color", palette[j%len(palette)]) if value < 0 else palette[j%len(palette)]
                    marks.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{bar_w:.1f}" height="{max(2,abs(y(value)-y(0))):.1f}" fill="{_color(fill)}"/>')
                if el.get("labels", True) and kind == "column":
                    marks.append(f'<text x="{x0+bar_w/2:.1f}" y="{y0-8:.1f}" text-anchor="middle" class="axis-label">{value:g}</text>')
    return '<svg class="chart" viewBox="0 0 900 480" role="img" aria-label="Chart">'+"".join(marks)+"</svg>"


def _content(root: Path, spec: dict, el: dict) -> str:
    kind = el["kind"]
    if kind == "text":
        lines = el.get("paragraphs") or [{"runs": el.get("runs", [{"text": line}])} for line in str(el.get("text", "")).split("\n")]
        paragraphs = []
        for line in lines:
            runs = []
            for part in line["runs"]:
                style = [f'font-family:{html.escape(str(part.get("font",el.get("font",spec.get("font","Arial")))))}',
                         f'font-size:{float(part.get("size",el.get("size",20)))*4/3:.2f}px', f'color:{_color(part.get("color",el.get("color","172B4D")))}']
                if part.get("bold",el.get("bold",False)): style.append("font-weight:700")
                if part.get("italic",el.get("italic",False)): style.append("font-style:italic")
                runs.append(f'<span style="{";".join(style)}">{html.escape(str(part.get("text","")))}</span>')
            paragraphs.append('<p>'+"".join(runs)+'</p>')
        return "".join(paragraphs)
    if kind in ("rect", "line", "shape"):
        shape = el.get("shape","rect") if kind == "shape" else kind
        radius = "50%" if shape == "ellipse" else "14px" if shape == "rounded_rect" else "0"
        clip = "clip-path:polygon(0 0,100% 50%,0 100%)" if shape == "chevron" else "clip-path:polygon(50% 0,0 100%,100% 100%)" if shape == "triangle" else ""
        border = f'border:{float(el.get("stroke_width",1))}px solid {_color(el["stroke"])};' if el.get("stroke") else ""
        return f'<div class="shape" style="background:{_color(el.get("fill","DCE6F1"))};border-radius:{radius};{border}{clip}" aria-hidden="true"></div>'
    if kind == "chart": return _chart(el)
    if kind == "table":
        rows = []
        if not el["rows"] or any(len(row) != len(el["rows"][0]) for row in el["rows"]):
            raise ValueError("table rows must be non-empty and have equal length")
        for ri, row in enumerate(el["rows"]):
            cells = []
            for value in row:
                bg = el.get("header_fill","0E4D64") if ri == 0 else ("EEF3F5" if ri%2 else "FFFFFF")
                fg = "FFFFFF" if ri == 0 else "172B4D"
                cells.append(f'<td style="background:{_color(bg)};color:{_color(fg)}">{html.escape(str(value))}</td>')
            rows.append("<tr>"+"".join(cells)+"</tr>")
        return '<table class="deck-table"><tbody>'+"".join(rows)+"</tbody></table>"
    if kind == "image":
        workspace = root / "workspace"
        image = (workspace / el["path"]).resolve()
        supplied = image.is_relative_to((workspace / "data").resolve())
        generated = image.is_relative_to((workspace / "artifacts" / "visuals").resolve()) and image.suffix.lower() in {".svg", ".png", ".jpg", ".jpeg", ".webp"}
        if not (supplied or generated):
            raise ValueError("images must come from data/ or be generated SVG/raster assets in artifacts/visuals/")
        if generated and image.suffix.lower() == ".svg":
            svg = image.read_text(encoding="utf-8").lower()
            if "<script" in svg or "href=" in svg or "src=" in svg or "url(" in svg:
                raise ValueError("generated SVGs must not contain scripts or external resources")
        mime = mimetypes.guess_type(image.name)[0] or "application/octet-stream"
        return f'<img class="deck-image" alt="" src="data:{mime};base64,{base64.b64encode(image.read_bytes()).decode("ascii")}">'
    raise ValueError(f"unsupported element kind: {kind}")


def find_edge() -> Path:
    candidates = [Path(os.environ.get("PROGRAMFILES(X86)","C:/Program Files (x86)"))/"Microsoft/Edge/Application/msedge.exe",
                  Path(os.environ.get("PROGRAMFILES","C:/Program Files"))/"Microsoft/Edge/Application/msedge.exe",
                  Path(os.environ.get("PROGRAMFILES","C:/Program Files"))/"Google/Chrome/Application/chrome.exe"]
    return next((p for p in candidates if p.is_file()), Path(shutil.which("msedge") or shutil.which("chrome") or ""))


def render(root: Path, manifest: Path, revision: int) -> dict:
    spec = json.loads(manifest.read_text(encoding="utf-8"))
    slides = spec["slides"]
    if not isinstance(slides,list) or not 1 <= len(slides) <= 30: raise ValueError("slides must contain 1..30 pages")
    width, height = float(spec.get("width",13.333333)), float(spec.get("height",7.5))
    out = root/"exports"/f"v{revision:03d}"
    out.mkdir(parents=True,exist_ok=False)
    counts = {k:0 for k in ("text","rect","line","shape","chart","table","image")}
    warnings, sections = [], []
    for number,page in enumerate(slides,1):
        elements = []
        for index,el in enumerate(page["elements"]):
            kind=el["kind"]
            if kind not in counts: raise ValueError(f"unsupported element kind: {kind}")
            x,y,w,h=(float(el[k]) for k in ("x","y","w","h"))
            if w<=0 or h<=0: raise ValueError("element width/height must be positive")
            if x<0 or y<0 or x+w>width+.02 or y+h>height+.02: warnings.append({"page":number,"element":index,"issue":"outside_canvas"})
            align=el.get("align","left")
            valign={"top":"flex-start","middle":"center","bottom":"flex-end"}.get(el.get("valign","top"),"flex-start")
            margin=float(el.get("margin",.03))*96
            styles=f'left:{x/width*100:.5f}%;top:{y/height*100:.5f}%;width:{w/width*100:.5f}%;height:{h/height*100:.5f}%;'
            styles+=f'text-align:{align};padding:{margin:.2f}px;'
            if kind=="text": styles+=f'display:flex;flex-direction:column;justify-content:{valign};'
            elements.append(f'<div class="element {kind}" style="{styles}">{_content(root,spec,el)}</div>')
            counts[kind]+=1
        background=_color(page.get("background","FFFFFF"))
        sections.append(f'<section class="slide" id="slide-{number}" aria-label="Slide {number}" style="background:{background}">'+"".join(elements)+"</section>")
    deck_html='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Offline HTML slide presentation"><title>Presentation</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#101923;color:#172b4d;font-family:Arial,sans-serif}.viewer{height:100%;display:grid;place-items:center}.slide{position:relative;width:min(100vw,177.7778vh);height:min(100vh,56.25vw);overflow:hidden;display:none;box-shadow:0 20px 70px #0008}.slide.active{display:block}.element{position:absolute;overflow:hidden}.text{line-height:1.15}.text p{margin:0 0 .36em;white-space:pre-wrap}.shape{width:100%;height:100%}.chart{display:block;width:100%;height:100%;overflow:visible}.axis{stroke:#9aa8b6;stroke-width:2}.axis-label{font:22px Arial,sans-serif;fill:#34495e}.chart-title{font:26px Arial,sans-serif;font-weight:700;fill:#172b4d}.deck-table{width:100%;height:100%;border-collapse:collapse;font:18px Arial,sans-serif}.deck-table td{border:1px solid #d1d9df;padding:7px 10px}.deck-image{width:100%;height:100%;object-fit:contain}.controls{position:fixed;right:18px;bottom:18px;display:flex;align-items:center;gap:10px;padding:8px;border-radius:99px;background:#111d;color:#fff;font:14px Arial,sans-serif}.controls button{width:38px;height:38px;border:0;border-radius:50%;background:#fff;color:#123;font-size:24px;cursor:pointer}.controls button:focus-visible{outline:3px solid #47d7c4}.counter{min-width:54px;text-align:center}.help{position:fixed;left:18px;bottom:24px;color:#fff9;font-size:13px}.screenshot .controls,.screenshot .help{display:none}@page{size:13.333333in 7.5in;margin:0}@media print{html,body{height:auto;background:white}.viewer{height:auto;display:block}.slide,.slide.active{display:block;width:13.333333in;height:7.5in;box-shadow:none;page-break-after:always}.slide:last-child{page-break-after:auto}.controls,.help{display:none}}body[data-overview="1"]{height:auto;overflow:auto;background:#dce2e8}.overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:20px}.overview .slide{display:block;width:100%;height:auto;aspect-ratio:16/9;box-shadow:0 3px 12px #0004}.overview .element{font-size:clamp(4px,1vw,15px)!important}.overview .text p{margin:0}.overview .controls,.overview .help{display:none}
</style></head><body><main class="viewer" id="viewer">'''+"".join(sections)+'''</main><div class="controls" role="navigation" aria-label="Slide navigation"><button id="prev" aria-label="Previous slide">‹</button><span class="counter" id="counter" aria-live="polite"></span><button id="next" aria-label="Next slide">›</button></div><div class="help">Use ← → or click the arrows</div><script>
(()=>{const slides=[...document.querySelectorAll('.slide')],q=new URLSearchParams(location.search);let n=Math.max(1,Math.min(slides.length,Number(q.get('slide'))||Number(location.hash.slice(1))||1));const overview=q.get('overview')==='1';if(overview){document.body.dataset.overview='1';document.getElementById('viewer').classList.add('overview')}function show(i){n=((i-1+slides.length)%slides.length)+1;slides.forEach((s,k)=>s.classList.toggle('active',k===n-1));document.getElementById('counter').textContent=n+' / '+slides.length;history.replaceState(null,'','#'+n)}document.getElementById('prev').onclick=()=>show(n-1);document.getElementById('next').onclick=()=>show(n+1);document.addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(n+1)}else if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(n-1)}else if(e.key==='Home')show(1);else if(e.key==='End')show(slides.length)});show(n);if(q.has('screenshot'))document.body.classList.add('screenshot')})();
</script></body></html>'''
    page_path=out/"deck.html"
    page_path.write_text(deck_html,encoding="utf-8")
    browser=find_edge()
    if not browser.is_file(): raise RuntimeError("Microsoft Edge or Chrome is required to render the HTML deck")
    user_data=root/".harness"/f"edge-render-v{revision}"
    base=[str(browser),"--headless=new","--disable-gpu","--no-first-run","--disable-extensions","--hide-scrollbars","--allow-file-access-from-files",f"--user-data-dir={user_data}","--window-size=1600,900"]
    for number in range(1,len(slides)+1):
        target=out/f"slide-{number:02d}.png"
        subprocess.run([*base,f"--screenshot={target}",page_path.as_uri()+f"?slide={number}&screenshot=1"],capture_output=True,encoding="utf-8",errors="replace",timeout=30,check=True)
    thumb_w,thumb_h,columns=480,270,3
    contact_image=Image.new("RGB",(columns*thumb_w,((len(slides)+columns-1)//columns)*(thumb_h+24)),"#dfe5e9")
    draw=ImageDraw.Draw(contact_image)
    for i in range(len(slides)):
        image=Image.open(out/f"slide-{i+1:02d}.png").convert("RGB")
        contact_image.paste(ImageOps.fit(image,(thumb_w,thumb_h)),((i%columns)*thumb_w,(i//columns)*(thumb_h+24)))
        draw.text(((i%columns)*thumb_w+6,(i//columns)*(thumb_h+24)+thumb_h+4),str(i+1),fill="black")
    contact_image.save(out/"contact-sheet.png")
    result={"revision":revision,"slides":len(slides),"elements":counts,"warnings":warnings,"renderer":"Microsoft Edge Chromium headless","format":"self-contained HTML slides","output":str(out),"source":spec,"html":"deck.html"}
    (out/"receipt.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    return {k:v for k,v in result.items() if k!="source"}


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("root",type=Path);parser.add_argument("manifest",type=Path);parser.add_argument("revision",type=int)
    args=parser.parse_args()
    print(json.dumps(render(args.root.resolve(),args.manifest.resolve(),args.revision)))
