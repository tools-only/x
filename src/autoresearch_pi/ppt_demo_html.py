"""Build a self-contained HTML slide deck and browser previews for the PPT demo."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from html.parser import HTMLParser

HTML = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Presentation</title><style>
*{box-sizing:border-box}body{margin:0;background:#111820;color:#172b4d;font-family:Arial,sans-serif}
#stage{position:relative;width:min(100vw,calc(100vh * RATIO));height:min(100vh,calc(100vw / RATIO));margin:auto;background:white;overflow:hidden}
.slide{position:absolute;inset:0;display:none;overflow:hidden}.slide.active{display:block}.el{position:absolute;overflow:hidden}
.text{white-space:pre-wrap;line-height:1.18}.shape{box-sizing:border-box}.chart{width:100%;height:100%;overflow:visible}
table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit}td{padding:.35em .5em;border-bottom:1px solid #dbe2e8;overflow-wrap:anywhere}
td:first-child{font-weight:600}tr:first-child td{background:#0e4d64;color:white;font-weight:700}
#nav{height:54px;display:flex;align-items:center;justify-content:center;gap:16px;color:white;font:14px Arial}
button{border:0;border-radius:5px;background:#263746;color:white;padding:8px 14px;cursor:pointer}button:disabled{opacity:.4}#counter{min-width:70px;text-align:center}
@media print{body{background:white}#nav{display:none}#stage{width:100vw;height:auto;overflow:visible}.slide{display:block!important;position:relative;width:100vw;height:calc(100vw / RATIO);page-break-after:always}}
</style></head><body><main id="stage"></main><nav id="nav"><button id="prev">Previous</button><span id="counter"></span><button id="next">Next</button><button id="full">Fullscreen</button></nav>
<script>const SPEC=DATA;document.title=SPEC.title||'Presentation';const stage=document.querySelector('#stage');stage.style.aspectRatio=(SPEC.width||13.333333)+' / '+(SPEC.height||7.5);
const escColor=v=>String(v||'172B4D').replace('#','');const make=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n};
function drawText(node,e){node.style.fontSize=(e.size||20)+'pt';node.style.fontFamily=e.font||SPEC.font||'Arial';node.style.color='#'+escColor(e.color);node.style.textAlign=e.align||'left';node.style.display='flex';node.style.flexDirection='column';node.style.justifyContent=({top:'flex-start',middle:'center',bottom:'flex-end'})[e.valign||'top'];node.style.padding=((e.margin??.03)*100/(SPEC.height||7.5))+'cqh '+((e.margin??.03)*100/(SPEC.width||13.333333))+'cqw';
 const paras=e.paragraphs||String(e.text||'').split('\n').map(t=>({runs:e.runs||[{text:t}]}));for(const p of paras){const row=make('div');row.style.marginBottom=(e.space_after||5)+'pt';for(const r of p.runs||[]){const s=make('span');s.textContent=r.text||'';s.style.fontSize=r.size?(r.size/((e.size||20))+'em'):'';s.style.fontFamily=r.font||e.font||SPEC.font||'Arial';s.style.fontWeight=(r.bold??e.bold)?'700':'';s.style.fontStyle=r.italic?'italic':'';s.style.color=r.color?'#'+escColor(r.color):'';row.append(s)}node.append(row)}}
function drawChart(node,e){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'), w=800,h=440, pad=55, vals=e.series.flatMap(s=>s.values.map(Number)), lo=e.axis_min??Math.min(0,...vals), hi=e.axis_max??Math.max(1,...vals);svg.classList.add('chart');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);const add=(tag,a)=>{const x=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(a))x.setAttribute(k,v);svg.append(x);return x};
 if(e.title||e.show_title){const t=add('text',{x:w/2,y:25,'text-anchor':'middle','font-size':18,fill:'#172b4d'});t.textContent=e.title||''}
 if(e.type==='pie'){const series=e.series[0],sum=series.values.reduce((a,b)=>a+Number(b),0)||1;let a=-Math.PI/2;series.values.forEach((v,i)=>{const b=a+2*Math.PI*v/sum,cx=w/2,cy=h/2,r=Math.min(w,h)*.34,pt=(q)=>[cx+r*Math.cos(q),cy+r*Math.sin(q)],p1=pt(a),p2=pt(b);add('path',{d:`M ${cx} ${cy} L ${p1} A ${r} ${r} 0 ${b-a>Math.PI?1:0} 1 ${p2} Z`,fill:'#'+escColor((e.colors||['0E4D64','C8A45D','4E8A8A'])[i%(e.colors||[1]).length])});a=b})}
 else {const zero=pad+(hi/(hi-lo||1))*(h-2*pad),step=(w-2*pad)/e.categories.length;add('line',{x1:pad,y1:zero,x2:w-pad,y2:zero,stroke:'#788796'});e.categories.forEach((cat,i)=>{const t=add('text',{x:pad+step*(i+.5),y:h-12,'text-anchor':'middle','font-size':13,fill:'#34495e'});t.textContent=cat});e.series.forEach((s,j)=>{const pts=[];s.values.forEach((raw,i)=>{const v=Number(raw),x=pad+step*(i+.5),y=pad+(hi-v)/(hi-lo||1)*(h-2*pad);if(e.type==='line'){pts.push(`${x},${y}`);add('circle',{cx:x,cy:y,r:5,fill:'#'+escColor((e.colors||['0E4D64'])[j%(e.colors||[1]).length])})}else{const bw=step*.72/e.series.length,bx=x-step*.36+j*bw,by=Math.min(zero,y),bh=Math.max(1,Math.abs(zero-y));add('rect',{x:bx,y:by,width:bw*.88,height:bh,fill:'#'+escColor(v<0&&e.negative_color?e.negative_color:(e.colors||['0E4D64'])[j%(e.colors||[1]).length])});if(e.labels!==false){const t=add('text',{x:bx+bw*.44,y:by-4,'text-anchor':'middle','font-size':12,fill:'#172b4d'});t.textContent=String(raw)}}});if(e.type==='line')add('polyline',{points:pts.join(' '),fill:'none',stroke:'#'+escColor((e.colors||['0E4D64'])[j%(e.colors||[1]).length]),'stroke-width':4})})}
 node.append(svg)}
for(const [si,page] of SPEC.slides.entries()){const slide=make('section','slide');slide.dataset.index=si+1;slide.style.background='#'+escColor(page.background||'FFFFFF');for(const e of page.elements){const n=make(e.kind==='shape'?'div':'div','el '+e.kind);n.style.left=(e.x/(SPEC.width||13.333333)*100)+'%';n.style.top=(e.y/(SPEC.height||7.5)*100)+'%';n.style.width=(e.w/(SPEC.width||13.333333)*100)+'%';n.style.height=(e.h/(SPEC.height||7.5)*100)+'%';if(e.kind==='text')drawText(n,e);else if(e.kind==='chart')drawChart(n,e);else if(e.kind==='table'){const t=make('table');for(const [ri,row] of e.rows.entries()){const tr=make('tr');for(const value of row){const td=make('td');td.textContent=String(value);td.style.fontSize=(e.size||17)+'pt';tr.append(td)}t.append(tr)}n.append(t)}else if(e.kind==='image'){n.style.backgroundImage=`url("${e.data_uri}")`;n.style.backgroundSize='contain';n.style.backgroundRepeat='no-repeat';n.style.backgroundPosition='center'}else{n.style.background=e.fill?'#'+escColor(e.fill):'transparent';if(e.stroke){n.style.border=`${e.stroke_width||1}px solid #${escColor(e.stroke)}`}const form=e.kind==='shape'?e.shape:'rect';n.style.borderRadius=form==='ellipse'?'50%':form==='rounded_rect'?'12px':'0';if(form==='triangle')n.style.clipPath='polygon(50% 0,100% 100%,0 100%)';if(form==='chevron')n.style.clipPath='polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%)'}slide.append(n)}stage.append(slide)}
let current=Math.max(1,Math.min(SPEC.slides.length,Number(new URL(location.href).searchParams.get('slide')||location.hash.match(/slide=(\d+)/)?.[1]||1)));function show(n){current=Math.max(1,Math.min(SPEC.slides.length,n));document.querySelectorAll('.slide').forEach(x=>x.classList.toggle('active',Number(x.dataset.index)===current));document.querySelector('#counter').textContent=`${current} / ${SPEC.slides.length}`;document.querySelector('#prev').disabled=current===1;document.querySelector('#next').disabled=current===SPEC.slides.length;history.replaceState(null,'',`?slide=${current}`)}document.querySelector('#prev').onclick=()=>show(current-1);document.querySelector('#next').onclick=()=>show(current+1);document.querySelector('#full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();document.addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key))show(current+1);if(['ArrowLeft','PageUp'].includes(e.key))show(current-1)});show(current);
</script></body></html>'''

HTML_NAV = r'''<style id="codex-preview-style">.codex-slide-hidden{display:none!important}#codex-nav{position:fixed;z-index:2147483647;right:16px;bottom:16px;display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;background:#172b4d;color:white;font:14px Arial;box-shadow:0 2px 12px #0005}#codex-nav button{border:0;border-radius:4px;padding:7px 10px;background:#fff;color:#172b4d;cursor:pointer}@media print{#codex-nav{display:none!important}.slide,.codex-slide-hidden{display:block!important;position:relative;break-after:page;min-height:100vh;visibility:visible!important}}</style>
<script id="codex-preview-script">(()=>{const pages=[...document.querySelectorAll('.slide')];let i=Math.max(1,Math.min(pages.length,Number(new URLSearchParams(location.search).get('slide')||1)));const nav=document.createElement('nav');nav.id='codex-nav';nav.innerHTML='<button data-step="-1">Previous</button><span></span><button data-step="1">Next</button><button data-full>Fullscreen</button>';document.body.append(nav);const show=n=>{i=Math.max(1,Math.min(pages.length,n));pages.forEach((p,j)=>{p.classList.toggle('codex-slide-hidden',j!==i-1);p.classList.toggle('active',j===i-1)});nav.querySelector('span').textContent=i+' / '+pages.length;nav.querySelector('[data-step="-1"]').disabled=i===1;nav.querySelector('[data-step="1"]').disabled=i===pages.length;history.replaceState(null,'','?slide='+i)};nav.onclick=e=>{if(e.target.hasAttribute('data-full'))document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();const step=e.target.dataset.step;if(step)show(i+Number(step))};document.addEventListener('keydown',e=>{if(['ArrowRight','PageDown'].includes(e.key))show(i+1);if(['ArrowLeft','PageUp'].includes(e.key))show(i-1)});show(i)})();</script>'''


class Slides(HTMLParser):
    count = 0
    title = "Presentation"
    in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "slide" in attrs.get("class", "").split(): self.count += 1
        if tag == "title": self.in_title = True

    def handle_endtag(self, tag):
        if tag == "title": self.in_title = False

    def handle_data(self, data):
        if self.in_title and data.strip(): self.title = data.strip()


def _with_navigation(source: str) -> str:
    if "id=\"codex-preview-script\"" in source: return source
    if "</body>" in source: return source.replace("</body>", HTML_NAV+"</body>", 1)
    return source+HTML_NAV


def _browser() -> Path:
    candidates = [os.environ.get("PPT_DEMO_BROWSER"),
        str(Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"),
        str(Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe"),
        str(Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe")]
    for candidate in candidates:
        if candidate and Path(candidate).is_file(): return Path(candidate)
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge"):
        candidate = shutil.which(name)
        if candidate:
            return Path(candidate)
    raise RuntimeError("HTML previews require Edge, Chrome, or Chromium; set PPT_DEMO_BROWSER to its executable.")


def _mime_of(path: Path) -> str:
    """Image MIME by content, not by suffix; any type the browser accepts works."""
    head = path.read_bytes()[:16]
    if head.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if head.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"): return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP": return "image/webp"
    if head[:2] == b"BM": return "image/bmp"
    if head[:4] == b"\x00\x00\x01\x00": return "image/x-icon"
    return "image/png"


def render(root: Path, manifest: Path, revision: int) -> dict:
    raw = manifest.read_bytes(); source_path = manifest.resolve().relative_to((root/"workspace").resolve()).as_posix()
    source_hash = hashlib.sha256(raw).hexdigest(); source = raw.decode("utf-8")
    warnings: list = []
    if manifest.suffix.lower() == ".html":
        parser=Slides(); parser.feed(source); count=parser.count
        if count < 1: raise ValueError("HTML source must contain at least one element with class=slide")
        source_info={"format":"html","path":source_path,"slides":[{} for _ in range(count)]}
        title=parser.title; html=_with_navigation(source); counts={"html":1}
    else:
        spec=json.loads(source); slides=spec["slides"]
        if not isinstance(slides,list) or not slides: raise ValueError("slides must contain at least one page")
        count=len(slides); html_spec=json.loads(json.dumps(spec)); width,height=float(spec.get("width",13.333333)),float(spec.get("height",7.5))
        counts={};
        for page_no,page in enumerate(html_spec["slides"],1):
            for index,el in enumerate(page["elements"]):
                kind=el["kind"]
                x,y,w,h=(float(el[k]) for k in ("x","y","w","h"))
                if w<=0 or h<=0: raise ValueError("element width/height must be positive")
                if x<0 or y<0 or x+w>width+.02 or y+h>height+.02: warnings.append({"page":page_no,"element":index,"issue":"outside_canvas"})
                if kind=="image":
                    # Any workspace image, by content; no directory or suffix whitelist.
                    image=(root/"workspace"/el["path"]).resolve()
                    if not image.is_relative_to((root/"workspace").resolve()): raise ValueError("image path leaves the workspace")
                    mime=_mime_of(image)
                    el["data_uri"]=f"data:{mime};base64,"+base64.b64encode(image.read_bytes()).decode("ascii")
                if "html" in el:
                    # Free-form content: any element may carry raw HTML/SVG; unknown kinds render it directly.
                    kind = kind if kind in ("text","rect","line","shape","chart","table","image") else "html"
                counts[kind]=counts.get(kind,0)+1
        html=HTML.replace("RATIO",str(width/height)).replace("DATA",json.dumps(html_spec,ensure_ascii=False).replace("</","<\\/"))
        title=spec.get("title","Presentation"); source_info=spec
    out = root / "exports" / f"v{revision:03d}"; out.mkdir(parents=True, exist_ok=False)
    # Render in place next to the source, so relative assets (images, css, js) resolve; the navigation overlay is a
    # separate file, and the pristine source itself is never rewritten.
    render_root = out / "render"
    src_dir = manifest.parent
    import shutil
    shutil.copytree(src_dir, render_root)
    html_name = "presentation.html" if manifest.suffix.lower() == ".html" else "deck.html"
    html_path = render_root / (manifest.name if manifest.suffix.lower() == ".html" else html_name)
    if manifest.suffix.lower() == ".html":
        html_path.write_text(html, encoding="utf-8")
        shutil.copyfile(html_path, out / "presentation.html")
    else:
        html_path.write_text(html, encoding="utf-8")
        shutil.copyfile(html_path, out / "presentation.html")
    browser=_browser(); profile=out/"browser-profile"; profile.mkdir()
    window=os.environ.get("PPT_DEMO_WINDOW_SIZE","1600,900"); vtb=os.environ.get("PPT_DEMO_VIRTUAL_TIME_MS","10000")
    for n in range(1,count+1):
        shot=out/f"slide-{n:02d}.png"
        subprocess.run([str(browser),"--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
            "--hide-scrollbars",f"--window-size={window}",f"--virtual-time-budget={vtb}",f"--user-data-dir={profile}",
            f"--screenshot={shot}",f"{html_path.as_uri()}?slide={n}"],check=True,capture_output=True,timeout=60)
    from PIL import Image, ImageDraw
    tw,th,cols=480,270,3; sheet=Image.new("RGB",(cols*tw,((count+cols-1)//cols)*(th+24)),"#dfe5e9"); draw=ImageDraw.Draw(sheet)
    for i in range(count):
        image=Image.open(out/f"slide-{i+1:02d}.png").convert("RGB"); image.thumbnail((tw,th)); sheet.paste(image,((i%cols)*tw,(i//cols)*(th+24))); draw.text(((i%cols)*tw+6,(i//cols)*(th+24)+th+4),str(i+1),fill="black")
    sheet.save(out/"contact-sheet.png")
    result={"revision":revision,"slides":count,"native_objects":counts,"warnings":warnings,"renderer":f"{browser.name} headless HTML","output":str(out),"html":"presentation.html","source_path":source_path,"source_sha256":source_hash,"source":source_info,"title":title}
    (out/"receipt.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    return {k:v for k,v in result.items() if k!="source"}


if __name__ == "__main__":
    import argparse
    parser=argparse.ArgumentParser(); parser.add_argument("root",type=Path); parser.add_argument("manifest",type=Path); parser.add_argument("revision",type=int); args=parser.parse_args()
    print(json.dumps(render(args.root.resolve(),args.manifest.resolve(),args.revision),ensure_ascii=False))
