# 开发与构建

项目采用 windingwind/Zotero Plugin Template 的 TypeScript 入口、生命周期和 Zotero Plugin Scaffold 工具链，基于上游提交 `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf` 适配。上游链接与组件许可证见 [迁移记录](TEMPLATE-MIGRATION.md) 和 [依赖说明](THIRD_PARTY.md)。

## 环境

- Node.js 22.8+、pnpm 11.25.0；仓库包含 pnpm-lock.yaml。
- Python 3.10+。构建辅助资源只用标准库；业务回归另需 requirements.txt 中的依赖。
- 普通插件用户不需要 Node.js、pnpm 或 TypeScript。

在包含 package.json 的项目根目录执行：

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm check:release
python -m unittest discover -s tests -v
python package_release.py --out ./artifacts
```

macOS 使用 python3 或虚拟环境解释器。需要指定程序位置时，通过 PDF_HELPER_NODE / PDF_HELPER_PYTHON 提供解释器完整路径。测试临时目录可指向 work/test-temp；本机 HTTP 测试使用隔离的回环服务。

构建先准备原有 helper 源码资源，再执行 Scaffold 编译、TypeScript 检查和包内资源核验。输出在 .scaffold/build 中；验证后的 XPI 同时复制到项目上一级目录，供原有完整包脚本使用。build.py 继续作为 Python 调用入口，但现在也需要 Node 和已安装的模板构建依赖。

## 目录

| 路径 | 用途 |
| --- | --- |
| src/index.ts、src/addon.ts、src/hooks.ts | 模板入口、实例与生命周期 |
| src/modules/runtime.ts | 加载原有功能模块，保留对外接口与持久化路径 |
| plugin/ | 模板静态资源目录，沿用原目录名；等同于上游模板的 addon/ |
| helper/ | 原有 Python PDF/OCR 程序 |
| zotero-plugin.config.ts | Scaffold 配置、Firefox 115 编译目标和原有安装范围 |
| scripts/ | 辅助资源准备、验证、版本与完整包工具 |
| docs/images/ | 功能示意与离线界面示例 |

保留 CommonJS 默认类型，使现有 JS 模块及 node:test 回归继续运行；TypeScript 入口由 Esbuild 打包为插件可加载的脚本。模板示例中的演示菜单、额外列、快捷键和弹窗没有接入产品。

## 人工发布

构建和测试不会创建 tag、推送、上传资产或发布 Release。没有 release 脚本或自动发布工作流；Scaffold 的发布入口也在配置中关闭。按 [发布指南](RELEASING.md) 审查产物，再由维护者手动操作。

native update_url 继续使用原有 HTTPS 占位；Scaffold 在本地生成的 update.json / update-beta.json 不是本项目手动检查更新清单，也不部署。手动更新仍由 plugin/update-config.json 与 release/update-manifest.json 管理。

## 复现文档配图

Windows 安装 Edge 后，运行 scripts/render_docs.ps1。脚本从当前界面和示例数据生成 7 张图及原图标副本，不读取真实文库或令牌。生成的浏览器资料留在 work/，图片在 docs/images/。这些配图是离线示例，不作为原生 Zotero 安装验证结果。
