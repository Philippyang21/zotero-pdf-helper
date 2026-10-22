# Zotero 中文社区收录材料（待人工确认与提交）

核实日期：2026-10-23。以下资料仅保存在本地，未发出 Issue、PR 或正式申请。

## 核实到的实际流程

[商店“请求收录插件”](https://zotero-chinese.com/plugins/) 当前链接到 [zotero-chinese/zotero-plugins](https://github.com/zotero-chinese/zotero-plugins)。该仓库当前 README 正文已恢复接收 Issue/PR，尽管仓库简介仍显示暂缓更新。新投稿需要仓库、用途和发布/下载链接；PR 在 src/plugins.ts 按仓库名排序添加 repo、tags、releases、discoverReleases:true，releases:[] 可发现最新稳定版。审核合并后能否展示还取决于构建与网站数据源，不能把 PR 合并等同于网站收录完成。

[网站取数脚本](https://github.com/zotero-chinese/website/blob/main/.github/scripts/fetch-data.mjs) 当前仍从 syt2/zotero-addons-scraper 的 Release JSON 获取插件目录。[该采集仓库](https://github.com/syt2/zotero-addons-scraper) 允许在 addons/ 下新增 `所有者@仓库` 文件，可填写最多两个 tags，本插件可考虑 attachment 和 reader。采集器自动解析仓库与发布信息。因为网页入口与实际数据源处于过渡阶段，投稿时应请维护者确认是否还需同步上游采集源；若当前 PR 权限受限，使用正式入口仓库的 Issue，不绕过限制。

已发现公开机器可读的目录 JSON；它是共享采集产物，并非已核实具稳定协议的“单个插件版本查询 + 社区详情页”官方接口。目前也没有本插件的已收录条目。基于这些证据，本版采用维护者自己仓库的独立小清单，不抓取网页 HTML、不猜测社区 API。以后如有可靠官方接口，可在保持下载入口不变的前提下更换适配器。

详情页地址不能由 repo 名自行推导。应在收录后从商店实际条目打开详情，复制维护者认可的永久链接；若商店只有弹窗而无独立永久详情 URL，向维护者请求可稳定访问的插件说明/详情页，在解决前保留 communityUrl=null。不能用社区首页、任意自己拼出的路径或 GitHub Release 充当详情页。

社区提供插件目录和下载镜像，不是本地 .xpi 的上传安装接口。本任务不会把 GitHub 原生 Release 地址作为用户的更新按钮目标。详情页应让用户找到同版本 .xpi；下载后按 [社区安装说明](https://zotero-chinese.com/user-guide/plugins/about-plugin) 在工具 → 插件拖入 .xpi，或齿轮 → Install Plugin From File 覆盖安装，必要时重启，无需先卸载。

当前查阅材料未列出对所有插件统一强制的特定许可证、签名或额外认证规则；不能据此保证审核一定通过。项目已有 AGPL-3.0，必须保留其 LICENSE 和第三方说明。发布前再次核对维护者最新要求及图标/依赖分发权限。

## 可提交的介绍正文

**插件名称**：PDF Helper

**简介**：为扫描 PDF 添加可搜索文字层，保留原页面图像；支持合并已有 Markdown/定位 JSON，并在本机整理 PDF 高亮与复制文字。

**功能与场景**：

- 使用已接入的 PaddleOCR 官方云端异步服务识别扫描件；识别模型取决于原项目提供的设置和服务支持。
- 也可不重复 OCR，直接将已有 MD/JSON 合并为不可见文字层。支持大文件按体积切分、分段并行、进度、原任务恢复。
- 保留附件身份；原有流程在检查通过后按设置替换 PDF，并提供原文件备份和哈希校验恢复。
- 识别资料可存入独立存档集合、本机目录或原文献附件；同步范围遵循 Zotero 自身规则。
- 从 PDF 前 40 页尝试提取版权页信息，经确认后只补充父条目的空字段。
- 整理换行、中文与标点旁空格、保守英文断词和全半角。可自动整理新高亮摘录或手动保存选中的旧高亮，也可只复制整理结果。适用于普通可选中文字 PDF，不要求先跑 OCR。
- 0.1.11 候选新增手动检查更新。部署后仅在用户点击时请求公开版本信息，适用新版经确认后跳转本插件的社区详情页，由用户下载与安装 .xpi。

**适用环境**：manifest 声明 Zotero 10.0.x；目标 Windows x64 与 macOS Intel/Apple Silicon。PDF 处理需已安装 64 位 Python 3.10+，原流程建立独立依赖环境；仅文本整理和检查更新不需 Python。不能宣传为整个插件免 Python、离线 OCR、支持所有 Zotero 版本或已在 macOS 实测。

**安装**：从该插件真实社区详情页下载正式 .xpi，在 Zotero 工具 → 插件中从文件安装。首次运行 PDF 处理按 [USAGE](USAGE.md) 配置 Python；新云端识别需用户自己的 AI Studio Token。云端识别涉及上传 PDF，纯文本整理和更新检查不上传文献。Token 不放入源码和安装包。

**升级**：完成当前任务并保留恢复备份；从相同详情页下载适合 Zotero 10.0.x 的新版 .xpi，覆盖安装并按提示重启。检查更新不会自动下载、覆盖插件目录或执行安装。

**版本日志**：候选 0.1.13 及 [CHANGELOG](../CHANGELOG.md)；正式版本与发布时间待确认。

**GitHub 源码**：[https://github.com/Philippyang21/zotero-pdf-helper](https://github.com/Philippyang21/zotero-pdf-helper)。

**.xpi 下载**：目前只有本地 0.1.13 候选包。正式 GitHub Release、社区镜像及详情页尚未建立，不能提供虚构链接。

**许可证**：既有 AGPL-3.0，保持不变；依赖见 [THIRD_PARTY](THIRD_PARTY.md)。

## 人工提交清单

1. 确认正式插件名称、作者信息、版本、10.0.x 范围、源码仓库和公开下载地址；提供同版本 XPI、源码和 SHA-256。
2. 复核使用说明、截图、数据处理说明、已有许可证及依赖/图标授权。可使用本地设置截图作为示例，截图中的虚构测试版本需标明“离线示例”。
3. 经用户批准后，按商店入口的当前说明创建 Issue 或 PR，附上本页介绍、分类与下载链接；必要时由维护者指引同步采集源。
4. 等待人工审核、采集和网站构建；查看商店中真实展示的版本及兼容范围，打开详情下载并核验 XPI 校验和。
5. 取得真正的详情永久链接，完成集中更新配置、重新构建和部署。提交、合并、详情页、镜像同步及最终安装均是独立验收点，当前尚未完成。
