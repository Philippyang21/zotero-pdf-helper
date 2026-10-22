# 本地构建与发布前准备

当前版本 0.1.13 是本地候选，尚未公开发布。源码沿用原目录；建议未来以包含 build.py 的这一层作为 Git 仓库根目录，不要把工作区的历史版本、outputs/ 或浏览器资料一起上传。

## 需要确认的配置

| 项目 | 当前值 / 要求 |
| --- | --- |
| GitHub 仓库地址及公开状态 | https://github.com/Philippyang21/zotero-pdf-helper；公开空仓库，待首次推送 |
| 更新信息源 | 计划使用 https://raw.githubusercontent.com/Philippyang21/zotero-pdf-helper/main/release/update-manifest.json；为避免半配置，manifestUrl 暂留 null |
| 社区插件详情页 | 未获得；communityUrl=null，不能替换为商店首页或 GitHub Release |
| 候选与正式版本 | 本地 0.1.13，正式版本与发布时间由维护者确认 |
| Zotero 兼容范围 | 原声明继续为 10.0–10.0.*，不能未经验证扩展为 7/8/9/11 |
| 许可证 | 原 LICENSE 为 AGPL-3.0，原样保留；本次没有新增或替换许可证 |
| 社区收录 | 尚未提交、审核或生成本插件详情页 |

未确认这些项目时可以本机构建、测试和试装，但不能把检查更新描述为已在线工作。

## 更新清单约定

`plugin/update-config.json` 集中管理仓库、源、详情页、允许域名、超时和大小限制。它随 XPI 固定，不让远程数据扩展信任范围。初次部署需要修改配置后重新构建 XPI。HTTP 下载、带凭证/查询参数的 URL、外站、重定向、其他仓库路径均不接受。

当前来源策略为 raw.githubusercontent.com，且路径必须归属 repositoryUrl 对应仓库，以 `.json` 结尾并包含分支或提交引用。使用维护者核实的匿名可访问地址，不能填入本文示例或需要 Token 的私有仓库链接。若未来改用社区官方稳定接口，需要显式调整来源适配器与测试，不能只在配置中添加任意主机。

**Zotero 10 的必填字段**：原 manifest.update_url 的 .invalid HTTPS 占位继续保留。实测删去该字段会导致原生安装解析失败，换成 data: 空清单会因非 HTTPS 被禁用。它仅用于沿用宿主安装要求，不是本功能的真实源，也不应替换为本功能的自定义 JSON（两者格式不同）。宿主原生定期/手动检查可能尝试该预留域名；新模块不主动发起启动请求，且不修改用户的全局原生更新设置。严格禁止宿主层任何背景尝试仍需结合宿主设置另行处理，不能靠编造有效原生更新服务解决。

`release/update-manifest.json` 是待部署的候选清单，已填真实候选版本号，`published=false`、`communityUrl=null` 明确表示尚未上线。远端返回 false 会检查失败，不会推荐未发布版本。

| 字段 | 规则 |
| --- | --- |
| schemaVersion | 必填，整数 1 |
| published | 稳定版正式可下载后才设 true；客户端只接受 true |
| addonId | 必须等于 manifest 的插件 ID |
| latestVersion | 必填，SemVer X.Y.Z，可有构建元数据；此稳定通道拒绝预发布版本 |
| minZoteroVersion | 必填，2–4 段数字，例如现有声明 10.0 |
| maxZoteroVersion | 必须出现，数字版本、尾部 .*，或显式 null 表示无上限 |
| releaseNotes | 必填字符串，可为空，最多 12,000 个 JS 字符；按纯文本显示 |
| communityUrl | 必填，必须与随 XPI 固定的详情页相同；HTTPS、zotero-chinese.com 下具体插件路径 |

当前允许详情页路径为 `/plugins/具体路径` 或 `/user-guide/plugins/具体路径`，拒绝首页、查询、锚点、非默认端口和用户名密码。这是安全约束，不是声称社区必然分配这类 URL。取得实际链接后应核对它能展示本插件并找到新版 .xpi；若官方提供的详情 URL 形式不同，应以官方实际格式调整验证器和测试，不能编造符合正则的地址。

比较安装版本使用 SemVer；Zotero 范围使用宿主 Services.vc.compare，继承本项目 manifest 的 10.0.* 规则。无当前版本、损坏清单、预发布源或配置缺失均失败。只有适用的新版本才展示下载按钮，不兼容版本显示版本要求，不作为推荐升级。

## 构建和验证

打包只需 Python 标准库；Node 用于 JS 验证，Python 回归另需 requirements.txt 中依赖。所有命令在包含 build.py 的项目根目录执行。

```powershell
node scripts/check-release.cjs
node --test tests/test_plugin.cjs tests/test_text.cjs tests/test_text_ui.cjs tests/test_text_annotations.cjs tests/test_updates.cjs
python -m unittest discover -s tests -v
python build.py
python package_release.py --out ./artifacts
```

macOS 使用 `python3`，或运行装有 requirements.txt 的虚拟环境解释器。Windows 离线浏览器回归：`./tests/check_text_browser.ps1 -Page updates -Light`；深色用 `-Dark`，窄屏用 `-Width 640`。浏览器数据只落在 work/，不入包。

`build.py` 检查 manifest/helper 版本一致、打包原有 helper 源码和插件资源。`package_release.py` 通过目录与扩展名白名单分发源码，排除 work、环境、缓存、数据库、PDF、模型、日志和任意临时二进制，并验证 XPI 内资源与嵌套 helper。完整包另含使用说明、候选更新说明、开发报告、发布清单及 SHA256.json。

正式发布前运行 `node scripts/check-release.cjs --ready`。当前返回非零是预期结果，表示 URL 和 published 等仍未就绪。该脚本只离线校验结构和版本一致性，不会检查公网可达性、创建 Release 或提交收录；不能把通过它当作在线链路验收。

## 后续人工发布顺序

1. 确认正式版本；需要改号时运行 `python scripts/set_version.py X.Y.Z`，再更新 CHANGELOG、对应 docs/CHANGELOG-X.Y.Z.md 及清单说明。脚本不处理已发布清单，避免意外改写生产源。归档已发布数据后再开始下一候选。
2. GitHub 仓库已确定为 `Philippyang21/zotero-pdf-helper`，公开状态由维护者创建时选择。当前没有 Git 历史可迁移。人工在项目根目录初始化 Git、检查 `git status --short`，只按目录/文件逐项暂存并审查，不对工作区执行 `git add .`。
3. 审查分发文件清单与原图标授权。保留 LICENSE、THIRD_PARTY 和对应源码；运行依赖由原有流程安装，不能把 python-env、第三方 wheel、模型或 Zotero 数据库打包。源码测试中的引用片段仅是现有规则回归样本，公开前由维护者复核其使用范围。
4. 本地全部验证后，由维护者决定推送及创建 Release。tag 建议为 `v` 加 manifest 版本，Release 附同版本 .xpi、源码 ZIP、校验和和更新说明。未发布候选不能标成正式稳定版。
5. 按 [社区材料](COMMUNITY-SUBMISSION.md) 人工请求收录。初次进入社区前允许先完成 XPI 的分发准备，但不能启用候选清单。等待审核和网站展示，确认该插件的实际详情页和镜像下载正确。
6. 取得真实社区详情页后，将 `https://github.com/Philippyang21/zotero-pdf-helper`、`https://raw.githubusercontent.com/Philippyang21/zotero-pdf-helper/main/release/update-manifest.json` 和真实 communityUrl 一次性写入集中配置，清单的 communityUrl 同步；重新构建并验证。已分发的无配置候选需要用户手动覆盖安装这个已配置构建；它不能凭空获得后来添加的源。
7. 正式 .xpi 和社区页面可获得后，将经过审查的公开清单设置 published=true，再由维护者部署到固定地址。运行 --ready，并实际核查匿名 HTTPS 获取、相同版本、下一测试版本、系统浏览器取消/确认和真实安装。以后每次稳定发布只在新版已可下载且兼容声明真实时更新清单；保持详情 URL 稳定，避免旧安装被引导到别的插件。

本次仅准备源码与本地产物，没有初始化 Git、提交、推送、上传文件、发布 Release、申请收录或改许可证。尚无自动发布 workflow，防止 tag/push 意外触发公开发布。
