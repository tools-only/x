# Matt Pocock skills 安装记录

日期：2026-10-06（Asia/Shanghai）。用户要求先安装，再完成 self-harness 修改方案。

## 来源与范围

- 仓库：[mattpocock/skills](https://github.com/mattpocock/skills)。
- 固定提交：`6fd947921b935b7e1e69293a200400f0fdd5c15f`，对应发布包 manifest 版本 `1.3.1`。
- GitHub 查询时 stars：277,712；仓库 `updated_at=2026-10-06T15:25:47Z`。这些元数据不是安全保证。
- 采用 `.claude-plugin/plugin.json` 的 **27 个正式技能**清单。未额外安装上游明确排除的 `in-progress` 与 `misc`；本机已有这些目录的版本未删除或更新。
- 目标：`C:/Users/qi/.agents/skills`，当前 Codex 已发现的共享技能目录；未再向另一个 skill root 复制同名技能。

## 安装与验证

使用内置 [skill-installer](D:/agent/.codex/skills/.system/skill-installer/SKILL.md) 的 `install-skill-from-github.py`，以固定 commit 下载到隔离 staging，再核对其内容与审阅副本相同，合入已有共享目录。

27 个技能、79 个文件逐一核对；14 个技能有文本变化，更新前完整备份；13 个忽略 CRLF/LF 后与上游一致，未改写。更新采用复制覆盖上游同名文件，保留本地额外文件，没有递归删除、运行仓库脚本、启用 hook 或修改项目 AGENTS。

备份目录：[mattpocock-20261006-233054](C:/Users/qi/.agents/skill-backups/mattpocock-20261006-233054)。其中 `installation-report.json` 保存各技能状态；恢复前应先比较安装后的新修改，再恢复需要的单个技能，避免整目录覆盖后续工作。

详细安装/来源/扫描记录：[installation-report.json](../../tmp/mattpocock-skills-install-20261006/installation-report.json)、[source.json](../../tmp/mattpocock-skills-install-20261006/source.json)、[text-review.json](../../tmp/mattpocock-skills-install-20261006/text-review.json)。固定下载包 SHA-256：`1d05c81a44ccb319f4d1c22d1238afb4635ce456b9fdc206c5f2fc8d722555af`。

## 检查范围与执行权限

按 [skill-vetter](C:/Users/qi/.agents/skills/skill-vetter-1.0.0/SKILL.md) 做来源、文件和权限范围检查：79 个文件进行文本扫描，涉及权限/命令的命中内容及附带 shell 模板作了针对性阅读；这不是对上游功能的运行测试。

安装是文件操作，没有执行模板：

- `wizard` 的示例涉及 `.env`、Stripe 测试 key 与 GitHub secret 写入，属于后续实际调用时需按具体任务授权的操作；此次没有读取凭据或运行示例。
- issue-tracker 模板描述 GitHub/GitLab 写操作，此次没有发布 issue/comment。
- HTML 报告模板引用 Tailwind/jsDelivr CDN，此次没有运行该模板或上传项目内容。
- 未发现安装时自动执行的 hook；复制技能不等于启用技能中的所有工作流。

判定：可以安装为静态开发技能；后续运行风险取决于调用的具体技能与任务。文件安装及内容核对已完成，Codex 技能列表预计下一轮刷新，不能把当前会话已看到旧目录等同于新目录已被宿主重新加载。

## 后续使用

本次方案采用 `codebase-design` 的小接口与内部实现收敛原则，并沿用 writing-plans 的可执行任务组织方式。未调用 `to-spec` / `to-tickets` 发布工作流、未配置新的 issue tracker，也未将开发技能注入 Pi gameplay context。

方案：[Self-Harness 简化与可验证迭代](../plans/2026-10-06-self-harness-simplification-and-validation.md)。
