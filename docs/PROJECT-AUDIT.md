# 修改前的项目核查

核查日期：2026-10-22。以工作区交接记录指定的 0.1.10 源码为基线，直接在原目录增量修改，未建立独立插件。

| 项目 | 修改前状态 |
| --- | --- |
| 目录 | plugin/：Zotero 端；helper/repair/：Python 后台；tests/、docs/；build.py、package_release.py |
| 技术栈 | 原生 JavaScript / XHTML / CSS，Python 3.10+，无 npm 构建依赖、无 TypeScript、无现有 lint 配置 |
| 入口 | plugin/bootstrap.js 加载 repair.js 与纯文本模块；PDFRepair.init 注册原生设置面板 |
| 设置 | preferences.xhtml + preferences.css + preferences.js；textPreferences.js 管理文本规则；两级菜单八个子页 |
| 配置 | Zotero.Prefs 的 extensions.paddleocrrepair.*；令牌由登录管理器管理，不复用为更新凭证 |
| 语言 | 既有界面是中文内联文案，无中英国际化机制；新增界面继续中文，不新增另一套国际化系统 |
| 版本 | plugin/manifest.json 的 0.1.10，helper/repair/__init__.py 同值；运行时 bootstrap 提供安装版本 |
| 安装 | manifest_version=2 的 bootstrap XPI；无 install.rdf；ID paddleocr-pdf-repair@local.tools |
| 兼容 | strict_min_version=10.0，strict_max_version=10.0.*；Windows x64、macOS Intel/Apple Silicon 是原项目目标平台 |
| 本机 | 只读确认 Zotero 10.0.6，API / connector 均 200 |
| 更新 | 无手动检查模块；manifest.update_url 是 .invalid 域名占位，原 build.py 仅断言它以 https 开头 |
| 构建 | build.py 先生成 helper-source.zip，再打包 XPI 到项目上一级；package_release.py 生成源码与完整包 |
| Git | 工作区及当前源码均无 .git，无可核查的提交、分支、远程或 GitHub Release 流程 |
| 本地文件 | 保留各版本既有源码和交付。修改前对 plugin/、helper/ 与 LICENSE 建立 SHA-256 基线，存在 work/update-baseline.json，仅用于本机验收 |

无法借助 Git 区分用户未提交修改，因此把现有全部文件当作基线保留，没有 reset、checkout、覆盖旧交付或创建提交。旧源码包仍在工作区作为快照；本次文件差异使用哈希比对。

实施顺序：独立更新模块 → 在原设置菜单新增子页 → 配置及发布检查/分发规则 → 单元、浏览器和 Python 回归 → XPI 与源码包验证。现有 OCR/PDF helper 业务和纯文本模块保持字节一致，helper 仅同步版本常量。

外部配置在修改前均未知：GitHub 仓库及公开状态、可匿名获取的更新清单地址、该插件的真实社区详情页、正式发布时间和版本确认、社区审核。统一记录在 plugin/update-config.json 和发布指南，不使用示例地址冒充真实地址。
