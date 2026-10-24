# 0.1.11 检查更新开发与测试报告

> 本文保留0.1.11历史记录。当前0.1.16使用GitHub官方latest入口HEAD、同标签manifest及XPI HEAD，避免REST API匿名配额依赖，并保留jar读取修复。当前步骤以 [发布指南](RELEASING.md) 和 [0.1.16说明](CHANGELOG-0.1.16.md) 为准。

日期：2026-10-22。基于现有 0.1.10 原目录增量修改。0.1.11 仅为本地候选，没有 GitHub 仓库或正式公开发布。

## 实现

设置 → 高级与维护 → 检查更新增加独立子页，复用原两级导航、卡片样式和 aria-live 状态。原中文内联文案风格保留，没有新增国际化依赖。版本来自 bootstrap 提供的实际安装版本，缺失时失败。

updates.js 将 SemVer、清单与配置校验、网络传输、结果判定及确认跳转分开；updatePreferences.js 只负责此页交互。bootstrap 单独捕获更新模块加载异常，关闭插件时取消在途查询；与 OCR/PDF helper 无调用关系。repair.js 只增加设置脚本注册和更新模块关闭。

点击才读取 XPI 内集中配置并调用 Zotero.HTTP.request。请求为匿名 GET，仅 Accept 头，无用户数据或凭证；10 秒超时，禁用重定向、自动重试和缓存。响应头及 progress 监测超限即中止，解析前按 UTF-8 再限 64 KiB。拒绝非 200、来源变化、错误 JSON、身份/版本/范围/详情 URL 缺失或不可信。说明按 textContent 展示。

稳定通道拒绝预发布；安装中的 SemVer 预发布可升级到其正式版，构建元数据不影响先后。Zotero 兼容性由 Services.vc.compare 按 manifest 的 10.0.* 判断。适用的新版本才有下载按钮，经原生确认后使用项目已有 Zotero.launchURL；取消不跳转。不兼容版本展示版本与范围，不推荐安装；失败清除旧下载结果，允许用户重试。没有自动下载、覆盖安装目录、执行外部安装程序或后台轮询。

Zotero 10.0.6 原生解析确认：update_url 缺失会使安装包损坏，data: 内嵌空清单虽能解析，却因非 HTTPS 使 appDisabled=true。因此按最低风险方案保留原 .invalid HTTPS update_url，构建器和发布检查固定此占位，不部署任何原生自动更新清单。手动检查仅使用独立 HTTPS 配置。宿主原生检查仍可能尝试该预留域名，这是沿用的 Zotero 行为；不能承诺整个宿主绝无背景网络尝试。本次不更改用户的全局更新设置。

当前三个真实发布 URL 均为 null，候选清单 published=false，点击会明确提示尚未配置；不声称在线已可用。

## 修改文件

| 类型 | 文件 |
| --- | --- |
| 新增更新模块/配置 | plugin/content/updates.js、updatePreferences.js、plugin/update-config.json |
| 原界面接入 | plugin/bootstrap.js、plugin/repair.js、plugin/content/preferences.xhtml、preferences.css |
| 候选版本 | plugin/manifest.json、helper/repair/__init__.py、release/update-manifest.json |
| 构建/发布 | build.py、package_release.py、scripts/__init__.py、distribution.py、check-release.cjs、set_version.py、.gitignore、.gitattributes |
| 测试 | tests/test_updates.cjs、test_release.py、render_text_preview.cjs、verify_text_browser.cjs、check_text_browser.ps1 |
| 文档 | README.md、CHANGELOG.md、docs/CHANGELOG-0.1.11.md、PROJECT-AUDIT.md、RELEASING.md、COMMUNITY-SUBMISSION.md、UPDATE-REPORT.md、TESTING.md、USAGE.md |
| 隐私整理 | docs/TEXT-CLEANER-REPORT.md 移除真实文献标题；保留旧报告技术结论 |

helper 的所有业务 .py、原 plugin/content/text/、textUI.js、textPreferences.js、prefs.js 和图标均与修改前 SHA-256 基线核对；helper 仅改版本常量。LICENSE 原始字节保持一致。没有安装 PaddleOCR/PaddlePaddle 或下载模型，没有新增 npm/运行依赖。原 1.82 MB 图标保留，helper-source.zip 是构建生成的本项目 Python 源码，属于必要分发内容。

## 验证结果与边界

- 原 JavaScript 129 项通过；新增更新单元 84 项通过（合计 213）。涵盖相同/较新/较旧版本、1.9.0→1.10.0、完整预发布顺序、无当前版本、网络中断/超时/500、错误 JSON/字段、无详情页/外站/伪造域/不同插件页、兼容范围、取消确认、并发点击/显式重试、旧结果失效、关闭取消、响应大小、纯宿主 HTTP 选项、模块失败隔离及缺少 DOM 全局构造器的 bootstrap 作用域。
- Python 全量 36/36 通过（18.927 秒）：原 Python 33 项离线 OCR/PDF 回归，另有 3 项分发/版本脚本测试，检查缓存、环境、PDF、模型和未知文件排除以及版本同步/拒绝错误版本/阻止改写已发布清单。
- 实际 XHTML/CSS/JS 的离线浏览器检查每轮 29/29：1250px 浅色、深色和 640px 浅色；验证九个子页无水平溢出、原设置/Token 保存不受影响、更新状态/纯文本说明、确认与取消、不兼容/缺配置、异常隔离。使用独立隐藏 Edge 进程和假宿主，截图中的 0.1.12 是测试数据。首次沙箱浏览器超时后重新在受允许的测试进程中完成，不把失败轮算通过。
- Zotero 10.0.6 内只读加载更新模块，使用真实 Services.vc.compare 检查 10.0.*；9.0/10.1/11.0 模拟版本拦截、10.0.6 可用，取消不跳转。原生默认适配器能读取本地配置并返回 not-configured。另验证没有 DOM 全局变量的子脚本通过宿主构造器解析可信 HTTPS URL 和 UTF-8 模拟响应。测试子脚本禁用源码缓存以确保加载修改后字节。
- 发布前普通模式检查候选版本、helper、清单、兼容范围与日志一致；--ready 预期拒绝目前缺配置的候选。
- Zotero 原生 AddonManager 对最终 XPI 解析：error=0、版本 0.1.11、isCompatible=true、appDisabled=false、providesUpdatesSecurely=true。只取得安装对象后取消，没有调用 install，也没有覆盖当前插件。
- 27 个 JS/CJS 文件语法、21 个 Python AST、3 个 XHTML XML 和分发 JSON 解析通过。待分发源码白名单 81 个文件，秘密标记和已知个人路径/文献标识扫描未匹配；这是针对本次源码的扫描结果，不代替维护者公开前审核。基线只变化 bootstrap、repair 注册/关闭、设置 XHTML/CSS、manifest 和 helper 版本常量六处，LICENSE 未变化。

自动测试中的网络故障和新版响应为模拟数据，浏览器启动的是离线示例。未将示例源或详情 URL 写入生产配置；没有请求不存在的线上服务，没有真实浏览器外跳到测试地址。

本次未在用户个人配置中安装候选、重启 Zotero、修改文献/真实批注、读取 Token 或提交云端 OCR。完整的新版安装、原生设置页交互、真实系统浏览器确认跳转、社区下载与覆盖更新，以及 macOS 安装仍待实际验收。宿主只读模块测试不能代替这些安装测试。

XPI、源码 ZIP 与完整包由 package_release.py 在工作区 outputs/ 中生成，包含 ZIP CRC、资源一致性、嵌套 helper、版本及校验和检查；最终产物路径与 SHA-256 见输出中的 SHA256.json。源码排除 work、浏览器资料、PDF、数据库、环境与秘密文件，实际待分发文件清单另在本机 work/distribution-inventory.json。

从已生成源码 ZIP 解压至独立工作区，直接运行其发布检查和 build.py，重建 XPI 的所有资源与交付版本逐字节一致；嵌套 helper ZIP 按条目字节核对一致，ZIP 容器时间戳不要求一致。完整包逐文件 SHA-256 核验通过。

## 仍需维护者完成

确认正式版本与已有授权归属；确定 GitHub 仓库及公开状态；人工批准后的推送、Release 和社区投稿；等待网站展示并获得真实详情 URL；部署真实稳定版清单，配置并重建可查询版本；完成实际覆盖安装与目标 Mac 验收。操作细节见 RELEASING.md 和 COMMUNITY-SUBMISSION.md。
