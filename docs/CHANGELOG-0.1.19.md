# 0.1.19 · 在本机使用 PP-StructureV3（历史本地候选）

本页保留 0.1.19 候选的操作记录。0.1.20 已调整菜单并删除保存按钮，当前步骤见 [README 本地部署接入教程](../README.md#接入本地部署的-pp-structurev3)。

已安装 PaddleOCR 的用户可以让 Zotero 在本机识别新的扫描 PDF，无需 AI Studio 令牌。升级后默认沿用云端。右键菜单、MD/JSON 收纳、生成文字层、备份和恢复的操作不变。

1. 在部署环境的终端运行 `python -c "import sys; from paddleocr import PPStructureV3; print(sys.executable)"`。记下 Python 路径。需要安装好支持 PP-StructureV3 的 PaddleOCR 3.x、本平台适用的 PaddlePaddle 和文档解析依赖（含 pypdfium2）；先用该环境成功解析一张图片。参见 [PaddleOCR 官方教程](https://www.paddleocr.ai/latest/version3.x/pipeline_usage/PP-StructureV3.html)。
2. 打开 **设置 → PDF OCR Helper → OCR 与 PDF → 账号与模型**，勾选 **使用本机 PP-StructureV3 识别**。粘贴上一步的路径，或选择虚拟环境、Conda 环境、含 `.venv` 的部署目录。Windows 可填 `D:\ocr\.venv\Scripts\python.exe`；macOS / Linux 可填 `/完整路径/.venv/bin/python`。不要填网页地址、启动脚本或单独的模型权重。
3. 选 **自动** 可在每次启动模型时检测 CUDA，无可用 GPU 时使用 CPU。选 **CPU** 可固定使用处理器。有些 GPU 版 Paddle 环境需要 NVIDIA 运行库才能启动。在纯 CPU 电脑上，选择已安装 PaddlePaddle CPU 版的环境即可，同一套模型缓存可以复用。**检测本地环境** 检查解释器、PaddleOCR 导入和设备，不加载整套权重。点击 **保存 OCR / PDF 设置**。
4. 右键文献条目下已下载的扫描 PDF，选择 **PaddleOCR 识别并替换为可检索 PDF**。任务窗口显示本机识别页数。已有匹配 MD/JSON 的附件仍优先合并已有结果，无需重跑。首次试用可在“文件保存与备份”中关闭自动替换以先看生成件。

**模型放在其他位置？** 插件沿用 PaddleX 默认缓存或已有的 `PADDLE_PDX_CACHE_HOME`；如果部署目录含 `models/official_models`，会自动使用该缓存。可展开“自定义模型位置”，手工选择缓存根目录（包含 `official_models` 的那一层），或填写可信的本机 PP-StructureV3 PaddleX YAML，配置中的自定义模型使用绝对路径。模型未备齐时 PaddleOCR 可能尝试下载权重；要离线使用，应事先在同一环境和缓存下准备好。XPI 不包含模型，不执行部署目录中的启动脚本。

**两个 Python 设置分别做什么？** “账号与模型”指定已经安装模型的 Python；“高级与维护 → Python 环境”继续负责现有 PDF 工具。两者可不同；无需向插件的 PDF 环境安装 Paddle。仅在 Docker、WSL 或远端 HTTP 服务中运行模型的部署，需要可由 Zotero 所在系统直接启动的原生 Python 环境才能使用本版入口。

**公式识别** 默认开启，含公式的论文可保留 LaTeX 结果。处理纯文字书籍时可以关闭，以减少模型加载和内存使用。

**连续处理加速** 默认关闭。开启后，下一份使用同一环境、设备、配置文件和公式设置的 PDF 可以复用模型。关闭并保存后，空闲模型立即释放，正在识别的任务结束后释放。退出 Zotero 或后台服务空闲退出也会释放模型。

**长文档和恢复。** 插件按页保存进度，同一时间运行一份本地推理。取消或退出后，可在原任务上恢复并复用已完成的页。任务保留创建时的环境和设备；改设置后新建任务才能使用新配置。模型错误会显示在任务窗口，不会退回云端或覆盖原 PDF。为使高亮和选区与原图对齐，本地模式关闭页面自动转向及展平；整页方向错误时可先校正源文件再识别。

**文件与隐私。** PDF 在本机识别，不计入云端提交页数。Zotero 文件同步仍按已有设置执行。MD 包含文本、表格等模型输出，插图随 Markdown 内嵌；成像、排版复杂的页面仍应抽查识别文字。
