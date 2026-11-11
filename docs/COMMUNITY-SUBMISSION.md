# Zotero 中文社区收录与版本同步

规则复核日期：2026-11-11（北京时间）。[收录申请 #331](https://github.com/zotero-chinese/zotero-plugins/issues/331) 已于11月5日由社区维护者关闭并标记完成。本插件已进入社区源清单及发布目录，分类为附件管理、阅读器增强、条目元数据。

## 版本同步

[社区官方说明](https://github.com/zotero-chinese/zotero-plugins/blob/main/README-zh.md)规定，采集器检查最新正式版，一般无需为每次版本发布手动更新清单；仓库迁移、分类、下载地址或历史兼容范围变化时才需要补充信息。

本插件在 `src/plugins.ts` 中已配置 `discoverReleases: true` 和 `publishInShadow: true`。即使外部 scraper 尚未收录，社区也会从本插件正式 XPI 读取版本与兼容范围，写入发布数据。网站当前从本社区 gh-pages 分支的 `dist/plugins.json` 获取目录；数据发布后触发网站重新构建。

本次拟发布0.1.20沿用仓库、插件ID、下载文件命名及7.0–10.0.*兼容范围，无需重复申请。发布后应核对社区目录中的版本、目标Zotero版本与GitHub XPI地址；不能将GitHub发布成功等同于网站已刷新。

## 本次更新内容

- 新增本地 PP-StructureV3 部署接入，支持 CPU / CUDA GPU 识别。
- 优化设置菜单，本地与云端分别配置、分别选择识别入口。
- 删除设置页保存按钮，修改后自动保存。
- README 新增本地部署接入教程。

## 公开入口

- 源码：[Philippyang21/zotero-pdf-helper](https://github.com/Philippyang21/zotero-pdf-helper)
- 上一正式发布：[v0.1.18](https://github.com/Philippyang21/zotero-pdf-helper/releases/tag/v0.1.18)
- 社区：[插件商店](https://zotero-chinese.com/plugins/)
- 社区发布目录：[plugins.json](https://raw.githubusercontent.com/zotero-chinese/zotero-plugins/gh-pages/dist/plugins.json)

许可证为AGPL-3.0。版权页提取及Markdown同步在本机进行；云端 OCR 会上传 PDF，本地 PP-StructureV3 在指定环境中处理，是否跨设备同步MD取决于用户的Zotero文件同步设置。插件内检查更新独立使用GitHub对应版本发布页。

0.1.20 已经维护者审核并授权发布，下载请以 GitHub Releases 的正式附件为准。GitHub Release 规范见 [GitHub 官方文档](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
