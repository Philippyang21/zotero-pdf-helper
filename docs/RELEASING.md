# 本地构建与发布前准备

截至 2026-10-24，当前版本 0.1.13 的模板、兼容适配及教程等源码已推送至 GitHub main 分支，正在定稿首发说明与资产，尚未创建 tag 或 Release。包含 build.py 的这一层已是 Git 仓库根目录；后续继续使用该仓库，不要重复初始化，也不要把工作区的历史版本、outputs/ 或浏览器资料一起上传。

## 需要确认的配置

| 项目 | 当前值 / 要求 |
| --- | --- |
| GitHub 仓库地址及公开状态 | https://github.com/Philippyang21/zotero-pdf-helper；源码已推送至 main，尚未创建 tag 或 Release |
| 更新信息源 | release/update-manifest.json 已随源码推送，计划地址为 https://raw.githubusercontent.com/Philippyang21/zotero-pdf-helper/main/release/update-manifest.json；匿名 HTTPS 可访问性仍待核验，manifestUrl 暂留 null |
| 社区插件详情页 | 未获得；communityUrl=null，不能替换为商店首页或 GitHub Release |
| 候选与正式版本 | 0.1.13 为本次首发目标，计划 tag 为 v0.1.13；发布时间由维护者确认 |
| Zotero 兼容范围 | 7.0–10.0.*；Windows x64 已验证 7.0.32、8.0.4、9.0.6、10.0.6，详见 COMPATIBILITY.md；不得扩展到 11 或宣称 macOS 已实测 |
| 许可证 | 原 LICENSE 为 AGPL-3.0，原样保留；本次没有新增或替换许可证 |
| 社区收录 | 尚未提交、审核或生成本插件详情页 |

GitHub 首发与启用手动检查更新分别验收。完成测试、重建和资产核验后，可以先在 GitHub 发布供用户手动下载的 XPI；社区详情页取得前，三项 URL 保持 null，清单保持 published=false，不能把检查更新描述为已在线工作。

## 更新清单约定

`plugin/update-config.json` 集中管理仓库、源、详情页、允许域名、超时和大小限制。它随 XPI 固定，不让远程数据扩展信任范围。初次部署需要修改配置后重新构建 XPI。HTTP 下载、带凭证/查询参数的 URL、外站、重定向、其他仓库路径均不接受。

当前来源策略为 raw.githubusercontent.com，且路径必须归属 repositoryUrl 对应仓库，以 `.json` 结尾并包含分支或提交引用。使用维护者核实的匿名可访问地址，不能填入本文示例或需要 Token 的私有仓库链接。若未来改用社区官方稳定接口，需要显式调整来源适配器与测试，不能只在配置中添加任意主机。

**Zotero 10 的必填字段**：原 manifest.update_url 的 .invalid HTTPS 占位继续保留。实测删去该字段会导致原生安装解析失败，换成 data: 空清单会因非 HTTPS 被禁用。它仅用于沿用宿主安装要求，不是本功能的真实源，也不应替换为本功能的自定义 JSON（两者格式不同）。宿主原生定期/手动检查可能尝试该预留域名；新模块不主动发起启动请求，且不修改用户的全局原生更新设置。严格禁止宿主层任何背景尝试仍需结合宿主设置另行处理，不能靠编造有效原生更新服务解决。

`release/update-manifest.json` 已随源码推送，已填真实候选版本号；`published=false`、`communityUrl=null` 表示手动更新清单尚未启用。即使先完成 GitHub 首发，也须等社区详情页和客户端配置就绪后再启用。远端返回 false 会检查失败，不会推荐该版本。

| 字段 | 规则 |
| --- | --- |
| schemaVersion | 必填，整数 1 |
| published | 稳定版、真实社区详情页和客户端配置就绪后才设 true；客户端只接受 true |
| addonId | 必须等于 manifest 的插件 ID |
| latestVersion | 必填，SemVer X.Y.Z，可有构建元数据；此稳定通道拒绝预发布版本 |
| minZoteroVersion | 必填，2–4 段数字，例如现有声明 7.0 |
| maxZoteroVersion | 必须出现，数字版本、尾部 .*，或显式 null 表示无上限 |
| releaseNotes | 必填字符串，可为空，最多 12,000 个 JS 字符；按纯文本显示 |
| communityUrl | 必填，必须与随 XPI 固定的详情页相同；HTTPS、zotero-chinese.com 下具体插件路径 |

当前允许详情页路径为 `/plugins/具体路径` 或 `/user-guide/plugins/具体路径`，拒绝首页、查询、锚点、非默认端口和用户名密码。这是安全约束，不是声称社区必然分配这类 URL。取得实际链接后应核对它能展示本插件并找到新版 .xpi；若官方提供的详情 URL 形式不同，应以官方实际格式调整验证器和测试，不能编造符合正则的地址。

比较安装版本使用 SemVer；Zotero 范围使用宿主 Services.vc.compare，继承本项目 manifest 的 10.0.* 规则。无当前版本、损坏清单、预发布源或配置缺失均失败。只有适用的新版本才展示下载按钮，不兼容版本显示版本要求，不作为推荐升级。

## 构建和验证

模板迁移后，打包需要 Node.js 22.8+、pnpm 安装的锁定构建依赖及 Python 3.10+。Python 业务回归另需 requirements.txt 中依赖。所有命令在包含 build.py 和 package.json 的项目根目录执行，完整环境见 [开发说明](DEVELOPMENT.md)。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
node scripts/check-release.cjs
python -m unittest discover -s tests -v
python package_release.py --out ./artifacts
```

macOS 使用 `python3`，或运行装有 requirements.txt 的虚拟环境解释器。Windows 离线浏览器回归：`./tests/check_text_browser.ps1 -Page updates -Light`；深色用 `-Dark`，窄屏用 `-Width 640`。浏览器数据只落在 work/，不入包。

`build.py` 调用模板工具链，检查 package/manifest/helper 版本一致、编译入口、核对原有 helper 源码和插件资源。`package_release.py` 通过目录与扩展名白名单分发源码，包含模板 TypeScript、构建配置、锁文件与文档图片，排除 work、环境、node_modules、.scaffold、数据库、PDF、模型、日志和任意临时二进制，并验证 XPI 内资源与嵌套 helper。

GitHub 首发前运行普通模式 `node scripts/check-release.cjs`，并完成测试、重建及包内文件与校验和核验。普通模式须成功退出；当前输出 ready=false，列出三项 URL、published=false 和 feed.communityUrl，表示线上手动更新尚未就绪。

启用线上手动更新前再运行 `node scripts/check-release.cjs --ready`，届时必须通过。当前 --ready 返回非零是预期结果；不要为通过检查而填写虚构详情页或提前设置 published=true。该脚本只离线校验结构和版本一致性，不会检查公网可达性、创建 Release 或提交收录；不能把通过它当作在线链路验收。

## 后续人工发布顺序

1. 确认正式版本；需要改号时运行 `python scripts/set_version.py X.Y.Z`，再更新 CHANGELOG、对应 docs/CHANGELOG-X.Y.Z.md 及清单说明。脚本不处理已发布清单，避免意外改写生产源。归档已发布数据后再开始下一候选。
2. `Philippyang21/zotero-pdf-helper` 已完成首次提交和 main 推送，继续使用现有仓库。人工在项目根目录检查 `git status --short` 和 `git diff`，只按目录/文件逐项暂存并审查后续修改，不对工作区执行 `git add .`。
3. 审查分发文件清单与原图标授权。保留 LICENSE、THIRD_PARTY 和对应源码；运行依赖由原有流程安装，不能把 python-env、第三方 wheel、模型或 Zotero 数据库打包。源码测试中的引用片段仅是现有规则回归样本，公开前由维护者复核其使用范围。
4. 本地全部验证后，由维护者提交并推送必要修改，确认远端内容与构建源码一致，再创建 Release。当前计划 tag 为 `v0.1.13`，标题为 `PDF OCR Helper 0.1.13`，附同版本 .xpi、源码 ZIP、完整 ZIP、校验和和准确更新说明。发布前同步 README 的版本徽章和下载说明，再重建并核验最终包；发布说明须明确社区尚未收录、手动检查更新尚未启用。发布后由维护者将 B 站教程改为公开，再核对匿名播放。
5. 按 [社区材料](COMMUNITY-SUBMISSION.md) 人工请求收录。初次进入社区前允许先完成 XPI 的分发准备，但不能启用候选清单。等待审核和网站展示，确认该插件的实际详情页和镜像下载正确。
6. 取得真实社区详情页后，将 `https://github.com/Philippyang21/zotero-pdf-helper`、`https://raw.githubusercontent.com/Philippyang21/zotero-pdf-helper/main/release/update-manifest.json` 和真实 communityUrl 一次性写入集中配置，清单的 communityUrl 同步；以高于已公开版本的新版本重新构建并验证。已分发的无配置版本需要用户手动覆盖安装这个已配置构建；它不能凭空获得后来添加的源。
7. 正式 .xpi 和社区页面可获得后，将经过审查的公开清单设置 published=true，再由维护者部署到固定地址。运行 --ready，并实际核查匿名 HTTPS 获取、相同版本、下一测试版本、系统浏览器取消/确认和真实安装。以后每次稳定发布只在新版已可下载且兼容声明真实时更新清单；保持详情 URL 稳定，避免旧安装被引导到别的插件。

当前已完成 Git 初始化、首次提交和源码推送；尚未创建 tag、发布 Release、上传 Release 资产或申请社区收录。许可证保持不变。尚无自动发布 workflow，后续公开发布由维护者按步骤操作。
