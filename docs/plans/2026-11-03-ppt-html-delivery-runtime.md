# Meta-harness 变更记录：PPT demo 输出自包含 HTML 幻灯片

日期：2026-11-03（Asia/Shanghai）。状态：**已实现；模型采用和质量收益未验证**。

## 问题与命题

- 真实机会：JPMorgan case brief 改为要求 HTML presentation 后，宿主仍把 JSON 交给 PowerPoint COM，并向 agent 描述 PowerPoint 对象。该路径无法交付 brief 要求的产物。
- 窄命题：Agent 可直接 author `artifacts/presentation.html`，也可用 `artifacts/deck.json` 场景输入；浏览器渲染后生成自包含、可导航的 HTML 幻灯片与逐页预览，原有候选、咨询、验收和交付路径可继续工作。
- 减少的负担：无需人工把 PowerPoint 输出转换成 HTML，也无需另外维护预览工具。
- 推翻条件：真实宿主不能经 `office(render)` 生成 PNG/HTML，方向键无法换页，或验收后的 `office(deliver)` 没有交付自包含 `presentation.html`。
- 范围：PPT demo 的场景渲染、环境说明和两个演示案例的 HTML brief。非目标：真实模型审美/采用效果、PresentBench 分数、外部托管。

## 设计与成本

- 复用现有 `office(render/look/deliver)`、workspace receipt、候选 revision、acceptance program 和 delivery 目录；直接 HTML 与 scene JSON 两种输入都可用；不增加 runtime worker 或外部 JS/CSS 依赖。
- 直接 HTML 用 `.slide` 容器计页，runtime 注入浏览控制并输出逐页预览；scene JSON 会转成内嵌 HTML/CSS/JS、SVG 图表和 HTML 表格。Edge 或 Chrome headless 生成每页 PNG，继续供 `look` 与 `consult` 使用。
- 交付入口为 `delivery/presentation.html`；浏览器支持上一页/下一页、方向键、全屏和打印。
- Browser rendering 是必要环境能力；由 `PPT_DEMO_BROWSER` 覆盖默认 Edge/Chrome 路径。Pillow 用于 contact sheet。
- 两个 case brief 使用同一 HTML 产物约定，留出案例仍作为未公开的 transfer case。

## 实现与验证

- 改动入口：`src/autoresearch_pi/ppt_demo_html.py`、`src/autoresearch_pi/ppt_demo.py`、`demo/ppt_demo_extension.ts`、PPT 系统提示和两个 case README/brief。交付页数现在精确校验为 15。
- 真实浏览器渲染：Edge headless 处理 15 页含文字、SVG 柱图和 HTML 表格的 scene，生成 PNG 与 HTML；Playwright 打开实际文件无 JS 异常，验证 15 张 slide、首屏可见和 ArrowRight 切换。
- 真实宿主路径：调用 `office(render)` → first-render checkpoint → 绑定验收程序 → `office(deliver)`；JSON scene 产物 `C:\Users\qi\AppData\Local\Temp\ppt-html-path-w3RIGt\delivery\presentation.html`（9324 bytes），直接 HTML 产物 `C:\Users\qi\AppData\Local\Temp\ppt-html-direct-iy9yNX\delivery\presentation.html`（3279 bytes）。两种路径均生成 contact sheet 与逐页预览。
- 未运行测试套件；未运行真实 provider。上述 deterministic smoke 只确认功能及宿主可达性。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过（窄路径） | 本机 Microsoft Edge headless，真实 browser rendering | scene JSON 的文字/柱图/表格和直接 HTML 15 页均生成预览；Playwright 确认方向键切页。未覆盖所有 HTML/SVG 样式 |
| 全链路可达 | 未验证；extension/NativeRuntime 工具 smoke 通过 | 实际 extension 与 NativeRuntime 工具，Pi API 为 stub；无 provider 请求 | JSON scene 与直接 HTML 均从 `office(render)` 到验收及 `delivery/presentation.html`；尚未经 Pi parent loop，不代表模型自主采用 |
| 自主采用 | 未验证 | — | 无真实 provider 运行 |
| 净收益 | 未验证 | — | 无质量与成本对照 |

## 交付决定

- runtime 现在提供直接 HTML authoring 与 JSON scene 两种路径，输出文件是单文件 HTML；brief、系统提示、案例说明和可选依赖已同步。
- 下一可证伪检查：在普通 GPT-6 Luna 运行中观察是否能用该路径完成 deck、review 页面并交付；模型质量与收益另按预注册对照判断。
