# 构建与发布

当前版本0.1.16，保留首次公开的0.1.13及其附件。本版修复jar配置读取，并移除0.1.15对匿名GitHub REST API配额的依赖。

## 检查更新协议

仅在用户点击时依次执行：

1. HEAD `https://github.com/Philippyang21/zotero-pdf-helper/releases/latest`，不跟随跳转，只读取Location，必须是同仓库 `/releases/tag/v稳定版本`。
2. GET `https://raw.githubusercontent.com/Philippyang21/zotero-pdf-helper/v版本/plugin/manifest.json`，核对版本、插件ID和Zotero兼容范围。使用发布标签而非main。
3. HEAD 同仓库该标签的 `pdf-helper-版本.xpi` 地址确认可用，不跟随资产重定向，不下载XPI。

GitHub官方latest入口见 [链接发行版文档](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)。检查不请求REST API或HTML，不使用凭据，不上传文献。更新说明以固定纯文本提示用户到对应Release查看完整内容。

本地配置schemaVersion=4，包含repositoryUrl、latestReleaseUrl、assetNamePrefix、timeoutMs和maxResponseBytes。latest地址必须精确对应固定仓库；跳转目标必须精确匹配同仓库稳定版本标签，拒绝错仓库、外站、预发布标签、查询、凭证、锚点和编码/路径伪装。只有经过校验的具体Release页可在用户确认后打开。

每个请求超时10秒；GET元数据最多64 KiB，HEAD不读取响应正文。不能按XPI的Content-Length中止HEAD，它表示潜在文件大小而不是已下载字节。所有阶段和请求间交接均支持取消，无自动重试、后台轮询或自动下载。

配置使用支持jar URI的本地 `Zotero.File.getContentsFromURL` 读取；不要使用会转到HTTP解析的异步接口。403/429显示访问限制，缺少发布信息显示对应提示。本地版本高于公开正式版时显示无需更新，不提示降级。

独立的 `release/update-manifest.json` 仅保留为构建辅助元数据，published=false不变，客户端不读取。无需部署清单或等待社区收录。0.1.13–0.1.15用户需要先安装0.1.16修复版。

保留原manifest的 `https://paddleocr-pdf-repair.invalid/updates.json` 宿主安装占位，不将自定义检查协议填入原生更新器，也不改宿主全局更新偏好。

## 构建与验收

依赖见 [DEVELOPMENT](DEVELOPMENT.md)。已有构建环境可以复用。

```powershell
pnpm build
pnpm test
node scripts/check-release.cjs --ready
python -m unittest discover -s tests -p test_release.py -v
python package_release.py --out ./artifacts
```

--ready只校验配置及版本元数据，不代表候选已发布。还须在用户真实网络中运行打包jar路径的完整检查，验证HEAD跳转响应可能省略responseURL的宿主行为，不能把普通GET测试代替HEAD协议验证。界面回归使用tests/check_text_browser.ps1，包含访问限制、失败、取消、新版与不兼容状态。

## 正式发布顺序

1. 审查源码与测试，使用现有Git仓库。改号运行 `python scripts/set_version.py X.Y.Z`；同步README公开版本、徽章、XPI文件名和日志措辞后重建。
2. 提交推送经过审阅的源文件；以同一提交创建vX.Y.Z正式Release和标签。标签中plugin/manifest.json的版本、ID和范围必须与同版XPI一致。
3. 上传 `pdf-helper-X.Y.Z.xpi`、源码ZIP、ASCII命名的-bundle.zip及SHA256SUMS.txt，保留既有v0.1.13及附件。
4. 匿名下载核对哈希、版本与范围，验证latest入口指向预期正式版、同标签manifest和XPI的HEAD可用性，再用插件检查。用户确认后应打开具体版本页，在Assets手动下载安装。

经审阅推送vX.Y.Z标签后，.github/workflows/release.yml使用固定提交的官方动作构建、测试、打包和校验；先上传完整草稿，再公开Release。工作流只使用GitHub为当前仓库提供的临时令牌，不提取本机Git凭据，不修改已公开的同名Release。失败的未公开草稿可重新运行；也可在Actions手动输入已有标签重试。

社区提交后置，无须先获得社区详情URL或部署生产自定义feed。
