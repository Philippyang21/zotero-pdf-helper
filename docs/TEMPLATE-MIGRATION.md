# Zotero Plugin Template 迁移记录

日期：2026-10-23。迁移在现有仓库内完成，候选版本仍为 0.1.13，尚未推送或公开发布本次修改。

## 来源与采用方式

采用 [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 提交 `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf` 的入口、Addon 实例、生命周期钩子和 Scaffold 构建方式。它是社区维护的开发模板；Zotero 的官方接口要求仍以 [开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers) 为准。

新增 package.json、锁文件、TypeScript 配置和 src/，由 Scaffold 实际编译并打包。原 plugin/ 保留为模板的静态资源源目录，原 PDFRepair 与文本/更新模块通过 runtime.ts 适配层加载。使用 Toolkit 的 BasicTool 获取宿主对象；没有创建 Toolkit 调试桥或接入模板演示功能。

## 升级连续性

| 项目 | 迁移后 |
| --- | --- |
| 插件 ID | paddleocr-pdf-repair@local.tools |
| 原有设置前缀 | extensions.paddleocrrepair |
| 凭证域与 realm | chrome://paddleocrrepair；PaddleOCR API |
| 任务、辅助环境与备份目录 | Zotero 配置目录下 paddleocr-pdf-repair |
| 原有运行时接口 | Zotero.PaddleOCRRepair |
| 新增模板实例 | Zotero.PDFHelperAddon |
| 安装范围 | 7.0–10.0.*；Windows x64 已逐版验证，见 COMPATIBILITY.md |
| 项目许可证 | 原 LICENSE 不变，AGPL-3.0 |

新增入口在后台等待 Zotero 初始化完成后启动原模块，bootstrap 本身立即返回；就绪前被禁用时不再启动，初始化中被禁用时等待初始化结束再清理。启动失败时清理部分实例和 chrome 注册；禁用和退出时继续等待原模块关闭，保留待保存工作的清理顺序。

## 验证边界

模板构建和 TypeScript 检查通过。原有 213 项 JS 回归加 8 项模板生命周期测试，共 221 项通过。新增测试涵盖准备完成后启动、窗口分发、关闭等待、启动失败清理、可选模块故障隔离、原有配置路径以及无启动网络请求。

验证器逐项核对原有插件资源、首选项、manifest 元数据、图标、嵌套 helper、文档与新编译入口。后续为启动顺序与阅读器关闭增加4项回归，当前 JavaScript 共225项通过。另在 Windows x64 的 Zotero 7.0.32、8.0.4、9.0.6、10.0.6 使用独立程序、配置与测试文库，完成真实安装、设置、凭证、PDF 合并/搜索/索引/恢复、高亮保存、禁用重启用及完整重启验证。完整范围及尚未覆盖的交互见 [测试记录](TESTING.md)。目标 Mac 的原生验收仍未完成。

原 0.1.13 包保留作迁移前快照；本次资源与入口已变化，必须使用重新生成并核验的包，不能沿用旧哈希。
