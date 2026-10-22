# PDF Helper

为原 PDF 添加不可见的 Unicode 文字层，保留页面底图、页面数量、裁剪框、旋转和 Zotero 附件身份。支持通过官方异步 API 识别，或直接合并已有 Markdown 与定位 JSON。还可以读取 PDF 前 40 页中的版权页，经用户确认后补充父文献条目的空字段。

当前 0.1.13 为本地候选，软件名为 PDF Helper，羊驼图标的圆形外侧已修正为透明，并沿用简化后的设置界面。面向 Windows x64 与 macOS（Intel / Apple Silicon）上的 Zotero 10.0.x，沿用 0.1.11 的手动检查更新，以及既有中文空格/标点规则和原生注释保存；所有可选中文字、创建高亮的 PDF 都适用，不要求经过 PaddleOCR。

整理本身不使用 Python、LLM 或 OCR API，不改 PDF、MD/JSON；启用自动保存会实际修改新注释文字，不保留修改前副本，关闭不还原。PDF 生成等原有功能仍需要 64 位 Python 3.10+，本版不是整个插件免 Python 版。

Windows 基础版曾实测合并、自动替换与恢复；0.1.11 已有更新模块回归及 Zotero 10.0.6 只读核验。0.1.12 的调整与验证见 [名称与界面调整说明](docs/BRANDING-REPORT.md)、[更新日志](CHANGELOG.md)，此前功能见 [更新模块报告](docs/UPDATE-REPORT.md)。本候选未自动安装或提交真实 OCR，macOS 安装仍待实测。

## 手动检查更新（0.1.11）

设置 → PDF Helper → 高级与维护 → 检查更新。点击后查询最新稳定版；适用的新版显示更新说明及“前往中文社区下载”，经确认后在系统浏览器打开本插件详情页。下载 .xpi 后，从 Zotero 工具 → 插件 → 齿轮 → Install Plugin From File 覆盖安装，并按提示重启。不需要先卸载。

**发布尚未完成**：源码仓库已确定为 [Philippyang21/zotero-pdf-helper](https://github.com/Philippyang21/zotero-pdf-helper)，版本清单计划由该仓库公开托管；真实社区详情页尚未取得。为避免半配置状态，集中配置中的三项 URL 仍统一留空，当前候选会明确提示检查更新尚未配置。获取到社区实际详情 URL 后需要一次性写入三项地址、重新构建并部署，见 [发布指南](docs/RELEASING.md) 和 [社区材料](docs/COMMUNITY-SUBMISSION.md)。

检查更新不启动 Python、不触发 OCR、不发送文献或访问令牌，也不在启动时请求服务器。网络失败会提示重试；损坏信息不会显示成最新版本；不兼容版本不显示推荐下载按钮。未配置与检查失败均不影响其他功能。本版不提供静默下载或自动安装。

## 高亮文字自动与手动整理（0.1.10）

安装后，在设置 → PDF Helper → 阅读与引用 → 高亮与复制，勾选“新建高亮时自动整理并保存文字”，选择“论文引用（推荐）”并保存。Zotero 保存新高亮后，插件整理其摘录并通过原生注释更新显示；复制注释、编辑或拖入笔记时使用实际保存的内容。更改规则只影响后续新高亮，不扫描旧注释，也不会覆盖之后的手工编辑。

已有高亮：在阅读器侧边栏选中一条或多条高亮/下划线，右键 → “整理并保存选中高亮文字…”，确认后只处理选中项。可以关闭新高亮自动整理、只用手动动作；总开关仍需开启。实际修改摘录，不保留旧副本，不动评论、位置和其他高亮。

PDF 选择弹框仍提供“复制为论文引用文本”和“复制原始文字”；侧边栏右键保留两项复制。“复制当前注释文字”复制的是当前保存值，不是修改前副本。也可从工具菜单粘贴并复制。直接从 PDF 选择的原文仍来自未改动的 PDF；不自动附带出处、页码或参考文献格式。

## 安装

1. 先安装 64 位 Python 3.10 或更高版本；推荐使用已经实测的 Python 3.12。
2. Zotero → 工具 → 插件 → 齿轮 → 从文件安装插件，选择随附的 `.xpi`。
3. 在设置 → PDF Helper → 高级与维护 → Python 环境，将“Python 程序位置”留空；自动查找失败时再填写完整路径。
4. 第一次处理 PDF 时，插件会建立自己的 Python 环境并安装 PyMuPDF 与 HTTPX。你不需要手工启动 Python，也不会下载本地 OCR 模型。

Windows x64 和 macOS 的 Python 安装、检查命令、插件配置及常见问题都写在 [普通用户安装与使用说明](docs/USAGE.md) 中。

安装包不包含 Python，也不包含 PyInstaller 可执行程序。网络受限时，可在独立环境中预装 [requirements.txt](requirements.txt)。

本地开发版未发布在线更新服务。清单保留 Zotero 强制要求的 HTTPS 更新地址，使用保留域 `.invalid`，不会下载更新；更新请手工安装新的 XPI。不要为此关闭 Zotero 的安全检查。

### macOS 自动检测

- XPI 不捆绑未签名的可执行程序；插件以已安装的 Python 运行随包 Python 源码，并在 Zotero 配置目录建立隔离环境。
- 从 Finder 启动 Zotero 时通常拿不到终端中的完整 `PATH`。插件会额外检测 Homebrew、python.org、MacPorts、Miniforge/Conda、pyenv、asdf 和 `~/.local/bin` 的常见位置。
- python.org 的 universal2 安装包同时支持 Apple Silicon 和 Intel Mac。使用 Homebrew 时，Apple Silicon 推荐原生 arm64 Python，Intel Mac 使用 x86_64 Python。
- 设置中的 Python 路径支持 `~/...`。如自动检测失败，可在终端运行 `which python3`，把返回的完整路径填入插件设置。

## 使用已有识别结果：不需要密钥

1. 准备 PDF、对应的 `.md` 和 `.json`。识别资料可放在同一个文献条目下、独立存档中，或通过文件选择器选择库外文件。
2. 推荐使用相同文件名，如 `paper.pdf`、`paper.md`、`paper.json`，或 `paper.ocr.md`、`paper.ocr.json`。
3. 右键 PDF → **合并已有 MD/JSON，生成可检索 PDF**。
4. 插件在后台生成并检查 PDF，保存备份，然后自动替换原附件文件。原附件 ID、父条目和 Zotero 批注关系保持不变。

如果有多组候选结果，插件会要求选择 MD 和 JSON。也可以通过文件选择器选用库外文件。JSON 必须包含文字和坐标，并提供页面尺寸或可核实的 PDF 渲染倍率；只有 Markdown 或不含定位信息的 JSON 不能生成有效文字层。支持的格式见 [JSON 说明](docs/JSON.md)。

0.1.3 增加“旧版 JSON 的 PDF 坐标倍率”。默认 `0`，仍要求 JSON 提供尺寸。对已确认使用 2 倍 PDF 渲染的旧版 PaddleOCR 结果，可在设置中填 `2` 并保存，然后重新执行本地合并。插件按原 PDF 每页尺寸映射，不从文字框或缩略图猜尺寸，不修改源 JSON，也不再次识别。不同来源的 JSON 应先核实倍率，或恢复 `0`。

此路径没有远程 OCR 调用，不要求 API 密钥。MD 只做文本长度的提示性检查，不进行校对或语义审核。

## 自动 OCR

1. 按 [API 配置说明](docs/API.md) 在设置中保存 AI Studio Access Token，默认模型为 **PP-StructureV3**。
2. 右键 PDF → **PaddleOCR 识别并替换为可检索 PDF**。
3. 插件显示预计页数、登记任务、提交文档解析，复用同一任务的 MD 和定位 JSON。
4. 本地生成文字层，检查通过后备份并原位替换；MD/JSON 按所选收纳方式保留。

已有完整结果时优先复用。不会为生成 PDF、修正错字或检查输出再次调用 OCR。HTTP 提交不会自动重试；响应不确定时保留批次标识，通过原任务或原批次恢复。

## 从版权页补全文献条目（0.1.6）

选中一个 PDF 附件，右键选择“识别版权页并补全文献条目”。插件读取 PDF 前 40 页的文字层；如果同一附件已有 OCR JSON，也会一起使用。它不会因为这项操作自动提交云端 OCR。

识别结果先显示在确认框中，包括标题、作者、卷次、总卷数、版次、出版年、出版社和地点。确认后只填写父文献条目中的空字段，已有内容保持不变。一次只能处理一个 PDF；如果找不到可信的版权页，或者 PDF 没有文字层和可复用 JSON，插件会停止并给出提示。

## MD/JSON 收纳与跨设备同步（0.1.4）

设置提供四种保存方式：

| 方式 | 在 Zotero 中的位置 | 文件同步 |
| --- | --- | --- |
| 独立存档条目（推荐） | “PDF Repair 识别存档”集合，每份 PDF 对应一个资料条目；关联原文献 | 按 Zotero 存储附件规则同步 |
| 插件本地隐藏目录 | 配置目录的任务文件夹，不新增 MD/JSON 附件 | 不随 Zotero 同步 |
| 原文献下的独立附件 | 与 PDF 同级 | 按 Zotero 存储附件规则同步 |
| 原文献下的链接附件 | 与 PDF 同级 | 文件不随 Zotero 同步 |

独立存档仍是普通 Zotero 条目，会出现在专门集合和“我的文库”中；它让 MD/JSON 离开原文献的附件列表。文件能否在另一设备下载，取决于你自己的 Zotero 文件同步设置和存储空间。

新安装默认独立存档，升级保留已有设置。升级用户请改选保存方式并保存。对已完成的任务，选中任务后点“按当前设置收纳 MD/JSON”：只移动内容哈希匹配的识别附件，保留附件 ID、文件和原 PDF；不重新 OCR 或转换。也可以改回原文献下的附件方式后再次收纳。已有链接附件须先在 Zotero 中转为存储附件，才能采用存档同步方式。

本地隐藏方式不主动移除已有附件，只控制后续结果保存。缓存清理保留任务中的 MD/JSON。任务窗口提供“打开 MD/JSON 目录”和“查看存档条目”。新设备可通过同步后的存档标记重新匹配结果；若附件尚未下载会提示下载，不改为重新 OCR。任务历史和 PDF 恢复备份仍保存在本机，不随资料存档同步。

## 任务、恢复和备份

- 右键 PDF → **查看 PDF Helper 任务状态**，或工具菜单 → **PDF Helper：任务与设置**。
- 启动合并、识别或恢复时自动打开进度窗口。云端返回页数时显示已解析页数和百分比，并区分“已解析”与“结果已下载”；未返回页数时显示等待状态。写入与校验显示各自的实际页数。
- 完成后显示绿色勾选和 100%，并保留完成状态；“已生成，未替换”“已恢复原始 PDF”“全文索引待重建”分别标明。
- 任务窗口显示每段页码、上传/排队/解析/下载状态、最近查询时间、分阶段累计耗时、本地生成时间、原任务 ID、输出和备份位置。
- **恢复 / 重试**复用现有任务及本地结果；不确定的提交不会重交。必要时可填写已经存在的官方任务 ID。
- **取消**停止本地后续操作。已经发往服务端的请求不能退回额度；其 ID 和结果仍保留。
- 右键 PDF → **恢复原始 PDF**。恢复前校验备份；如果文件已被其他程序修改，拒绝自动覆盖。
- 备份按 SHA-256 去重保存。默认位于 Zotero 配置目录的 `paddleocr-pdf-repair/backups/`，也可自定义。
- 缓存清理只移除派生的 OCR 缓存，不删除任务记录、原始响应、识别结果或备份。

默认自动替换，无须逐次确认。关闭自动替换后，生成结果保留在任务目录，可从任务窗口打开。

## 设置与安全边界

Token 使用 Zotero/Firefox 登录管理器保存，不写进源码、普通设置项、任务 JSON 或日志。后台进程仅在内存中持有令牌；结果下载不向对象存储转发 API Authorization。

本地服务只监听 `127.0.0.1` 的随机端口，需要随机 Bearer 凭证，拒绝浏览器 Origin 和错误 Host。连接描述文件位于用户配置目录；其安全边界是当前操作系统账户和该目录的访问权限。不要将该目录共享给其他用户。

每日 20,000 页是可配置的本地提醒阈值。界面统计本插件已接受和待确认的页数，并按模型显示；它不是账户剩余额度，也不包括其他客户端的使用。

截至 2026-10-20，在官方公开 API 文档及 SDK 中尚未找到可核验的账户已用/剩余额度查询接口。本版明确显示账户额度未知，提供官方页面和配额规则入口；不会通过“每日上限减本地记录”伪造余额。详见 [API 说明](docs/API.md)。

## 开发与复现

Windows PowerShell：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test tests/test_plugin.cjs tests/test_text.cjs tests/test_text_ui.cjs tests/test_text_annotations.cjs tests/test_updates.cjs
python build.py
```

macOS 终端：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
node --test tests/test_plugin.cjs tests/test_text.cjs tests/test_text_ui.cjs tests/test_text_annotations.cjs tests/test_updates.cjs
.venv/bin/python build.py
```

`build.py` 使用标准库生成 `plugin/helper-source.zip`，再将插件打包成位于项目上一级目录的 XPI。版本号在 `plugin/manifest.json` 和 `helper/repair/__init__.py` 中保持一致；发布候选清单也需同步。运行 `node scripts/check-release.cjs` 检查本地一致性，`--ready` 严格模式会拦截未配置的发布。完整源码/交付包用 `python package_release.py --out ./artifacts` 生成；详见发布指南。

本地命令行转换也可单独使用，不涉及 OCR：

```text
Windows: .\.venv\Scripts\python.exe helper/run.py convert --pdf input.pdf --md input.md --json input.json --out searchable.pdf
macOS:   .venv/bin/python helper/run.py convert --pdf input.pdf --md input.md --json input.json --out searchable.pdf
```

命令行输出必须使用新路径；它不会自动覆盖输入。Zotero 的自动替换由带备份和哈希检查的任务流程完成。

旧版 PaddleOCR JSON 缺尺寸且已核实 PDF 渲染倍率时，可增加 `--legacy-pdf-scale 2`。该参数不是通用修复值；存在真实尺寸时优先使用真实尺寸。

源代码以 AGPL-3.0 发布，依赖沿用各自许可证，见 [LICENSE](LICENSE) 和 [依赖说明](docs/THIRD_PARTY.md)。
