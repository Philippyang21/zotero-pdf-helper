# PaddleOCR 官方 API 配置

核对日期：2026-10-21。依据官方当前文档及客户端实现开发，未使用 Codex 的 MCP 会话或未经验证的旧版同步端点。

## 配置步骤

1. 从 [AI Studio Access Token 页面](https://aistudio.baidu.com/account/accessToken) 获取 Token。
2. 设置 → PaddleOCR PDF Repair → OCR 与 PDF → 账号与模型 → **AI Studio 访问令牌**，填写后点“保存 OCR / PDF 设置”。
3. 默认服务地址为 `https://paddleocr.aistudio-app.com`。这是基础地址，不要追加 `/layout-parsing` 或 `/api/v2/ocr/jobs`。
4. 默认使用 `PP-StructureV3`。官方当前文档解析模型还包括 `PaddleOCR-VL`、`PaddleOCR-VL-1.5`、`PaddleOCR-VL-1.6`，设置项对应官方枚举。

模型可调用并不代表每次返回都含足够定位信息。插件会保存已经返回的 MD/JSON；缺少尺寸或坐标时停止生成并提示，不会自动调用第二个模型。

如使用自定义地址，必须是兼容同一官方协议的可信 HTTPS 代理。插件会把 Token 和 PDF 发给配置的这个地址；请核实地址归属。普通 PaddleX 自建同步 `/layout-parsing` 服务并不等同于此协议。

## 已实现的协议

- `POST /api/v2/ocr/jobs`：multipart 本地文件上传，字段 `file`、`model`、`optionalPayload` 和 `batchId`。
- `GET /api/v2/ocr/jobs/{jobId}`：读取 `data.state`，状态为 `pending/running/done/failed`。
- 读取 `data.extractProgress.totalPages/extractedPages`（兼容整数及数字字符串），仅在总页数与当前页段匹配、完成数处于有效范围时显示逐页百分比；缺字段时显示“云端未返回页数”。每次成功查询更新 `lastChecked`，不保存签名结果 URL。
- `GET /api/v2/ocr/jobs/batch/{batchId}`：读取 `data.extractResult`，恢复提交响应丢失的任务。
- 完成任务的 `data.resultUrl.jsonUrl` 指向 JSONL 结果。每行包含 `result.layoutParsingResults`；每页读取 `markdown.text` 和 `prunedResult`。
- 使用 Bearer Token；对象存储下载不带此令牌。

为保持坐标与原页面对应，关闭文档自动转向、图像扭曲矫正、图表理解和可视化输出。不会从 Markdown 重新排版 PDF。

## 在其他解析工具中准备可合并的结果

面向“在原 PDF 上补不可见文字层”，建议选择能返回行坐标的 PP-StructureV3；关闭整页方向分类 `useDocOrientationClassify` 和图像扭曲矫正 `useDocUnwarping`，避免坐标对应经过变形的页面。普通正向文字可保持文本行方向分类关闭；它与整页转向不是同一功能。表格、公式、印章识别按原文需要开启，不决定是否返回页面尺寸。

同时保存完整定位 JSON 和 Markdown；如果界面区分完整/精简 JSON，选择完整结果。输出应保留每页 `width/height`、页序、`overall_ocr_res.rec_texts`、`rec_polys` 或 `rec_boxes`。这些是导出格式要求，不保证存在同名设置开关。官方本地产线示例使用 `save_to_json()` 和 `save_to_markdown()` 分别保存两种结果，字段说明见 [PP-StructureV3 教程](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PP-StructureV3.md)。

如果当前工具导出的 `prunedResult` 始终删去尺寸，切换识别开关仍可能缺字段。已生成结果可使用 [旧版倍率兼容方式](JSON.md)，无需为补元数据重复识别。

提交前先将文件标识、参数、批次 ID 和提交意图持久化。POST 没有网络自动重试。若请求可能已到达服务端，恢复时先查原批次；找不到唯一任务时停留在可恢复状态，允许填写现有任务 ID，不以“未查到”推断“未提交”。批次 ID 用于查询，不被当作服务端幂等保证。

## 文件与等待限制

官方异步 API 文档当前列出：每次最多 1,000 页，本地上传最多 50 MB，URL 文件最多 200 MB。本插件只使用本地上传，不会为此将文件上传到其他文件托管站点。

只有文件超过 1,000 页或 50 MB 时才本地拆分。0.1.7 根据实际序列化字节数查找连续页段，目标 48,000,000 字节，每段不超过 1,000 页或 50,000,000 字节。单页在 48–50 MB 时允许单独提交，超过 50 MB 时拒绝。图像不重采样，不改变原始 PDF。每段单独保存批次、远端任务 ID 和原始结果，完成后按原页序合并。

每份 PDF 的 `partConcurrency` 可选 1 或 2（默认 2）；全进程共享两段信号量，避免同时处理多份 PDF 时请求数量成倍增加。配额预留与提交意图在同一锁内落盘，随后发出单次 POST。发生异常时停止启动后续页段，保留正在上传期间返回的回执；重启或恢复先读本地结果、原任务 ID 或原批次。旧任务有任何分段记录时均沿用原页段，绝不重新分段已提交任务。

每段记录客户端观察到的 `uploading/pending/running/downloading/waiting` 秒数；快照包含运行中阶段的实时累计，查询结束才持久化最终区间。旧任务升级前未记录的阶段不会按时间戳猜补。并行时段耗时会重叠，`apiSeconds` 对本版远端流程记录墙钟用时，不把各段耗时相加；旧任务已有的累计值保留。

每次 HTTP 请求等待上限为 300 秒，单次轮询窗口为 30 分钟；这是插件的客户端等待设置，不是推测的官方任务失效时间。窗口结束后暂停，恢复仍查询同一任务。没有依据把服务端任务认定为已失效后重交。

限流、认证或服务异常会暂停远端处理并保留记录。本地提醒阈值并不查询官方实时余额；本插件没有实现或伪造余额查询接口。

## 账户额度查询的核查结果（2026-10-20）

已核对[官方异步接口文档](https://ai.baidu.com/ai-doc/AISTUDIO/fml7mozw5)和[官方 HTTP 客户端](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr/_api_client/_http.py)：公开接口覆盖提交、任务状态、批次查询及结果下载，未找到可核验的账户已用/剩余配额查询协议。不能据此断言平台内部没有此接口，但当前没有足够依据实现可靠的自动账户统计。

[中文配额说明](https://ai.baidu.com/ai-doc/AISTUDIO/Xmjclapam)最近标注更新为 2026-09-08，列出每用户、每模型每日 20,000 页及超额 429；这是公开规则，不代表某个账户的实际剩余。较旧英文页面仍显示 3,000 页，不能混用旧数值，也不能以规则上限扣除本插件提交数来冒充账户余额。

0.1.4 的界面明确区分：账户已用/剩余未知、本插件今日获任务 ID 的提交页数、提交回执待确认页数、本地提醒阈值。后台返回 `accountQuota.available=false`，不返回虚构的 `remaining`。页面入口为 [PaddleOCR 官方任务页](https://aistudio.baidu.com/paddleocr/task)，由用户主动打开并登录；插件不抓取登录凭证，不通过试提交消耗额度来探测余额。

## 官方依据

- [官方 API 总览](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/serving/paddleocr_official_api/overview.md)
- [官方 Python 客户端文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/serving/paddleocr_official_api/python.md)
- [官方 HTTP 客户端源码](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr/_api_client/_http.py)
- [官方状态与响应解析源码](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr/_api_client/_core.py)
- [官方 JSONL 结果解析源码](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr/_api_client/_poller.py)
- [PP-StructureV3 API](https://ai.baidu.com/ai-doc/AISTUDIO/Fmfz6oh2e)
- [异步 API 使用说明](https://ai.baidu.com/ai-doc/AISTUDIO/fml7mozw5)
- [API 配额及错误码](https://ai.baidu.com/ai-doc/AISTUDIO/Xmjclapam)
- [官方 MCP 集成文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/integrations/mcp_server.md)

官方可能调整模型、限制和响应。遇到不兼容的结构会保留结果并报错，不会自动转用其他模型或二次识别。
