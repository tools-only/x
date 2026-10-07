# stage90 可恢复基线

本目录的191项源码逐字节匹配 `tmp/arc-stage90-source-manifest-20261005.json`，恢复来源和SHA256结果见 `tmp/arc-stage90-recovery-audit.json`。当前开发工作区没有回滚；本目录不得在实验中修改。

历史真实样本使用官方 ARC SDK/bridge/Pi、yibu/gpt-6.1-sol、普通ls20。第17动作通过level0，当时8次父响应/78066 reported tokens；完整样本23动作/1关/158577 reported后预算结束，没有完成60动作。没有研究/作者组件/装配/组件语义使用证据，单次成功不证明稳定性或组件收益。

`baseline-runtime-config.json`保存实际模型和runner配置，不含凭据。旧基线与stage112的初始64×64网格SHA256相同；历史SDK依赖、provider路由和随机推理无法仅凭源码保证完全一致。

独立接线检查发现旧清单漏掉了6个 `demo/prompts/research_profiles/*.md`：原glob仅覆盖prompts顶层。已补齐，并从原stage90实际子进程的 `auto-research-prompt-loads.jsonl` 找到全部6项相同SHA256的历史证据；来源保存在 `supplemental-assets-manifest.json`。`complete-source-manifest.json`现固定197项文件。原缺资产矩阵失败保留；补齐后的定向检查与完整重跑单独记录。

`tmp/arc-stage90-recovered-matrix.py`只用确定性provider检查真实SDK/Pi接线，不能证明真实模型复现通关。恢复和本次接线检查的真实付费模型预算为0；不将历史成功路线、具体目标或解法注入任何新游戏Agent。

补齐后的 `all-direct` 完整矩阵17场景/425检查通过，197项源码零漂移。2026-10-05 stage113真实复现仅完成1动作，随后provider连续超时退出；已报告6342 tokens，4次失败请求用量未知。初始网格、PNG、工具schema与历史一致；该失败没有通关重复性或净收益结论，不修改本基线来迎合失败结果。

后续性能复现必须使用此源码和已声明预算的新独立生命。后续优化从已复现基线出发，一次一个主要因素，同时比较关卡进展、父子总tokens和延迟；失败变体不得仅凭接线测试和局部字符缩减升级成有效默认优化。
