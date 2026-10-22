# 依赖与许可证

- **Python 3.10+**：使用用户已安装的解释器，不随 XPI 分发 Python。
- **PyMuPDF 1.26.7 / MuPDF**：本地 PDF 操作与结构验证；按项目所附 AGPL 条款或其单独商业授权使用。该固定版本在 PyPI 提供 macOS x86_64 与 arm64 wheel，要求 Python 3.10+。上游：[PyMuPDF](https://github.com/pymupdf/PyMuPDF)、[1.26.7 发布文件](https://pypi.org/project/PyMuPDF/1.26.7/#files)。
- **Droid Sans Fallback**：使用 PyMuPDF 内置字体资源，保持其原有字体许可证；没有复制用户系统字体。
- **httpx 0.28.1 及其依赖**：复用 HTTP 客户端，由 pip 在插件独立环境中安装；上游：[HTTPX](https://github.com/encode/httpx)。
- **Zotero APIs**：宿主提供的插件、附件、凭证和全文索引接口，没有将 Zotero 程序复制进安装包。
- **引用文本整理（0.1.8 起）**：使用宿主 JavaScript 字符串和正则，规则独立编写，无新增运行依赖；未复制外部文本 formatter 代码。0.1.9 使用 Zotero 通知和条目保存接口处理新高亮，移除显示覆盖层。

本项目自己的代码采用 AGPL-3.0，见根目录 LICENSE。源码和构建脚本随交付提供。开发过程参考了 PaddleOCR 官方文档及 HTTP/结果解析源码，本项目没有安装 PaddlePaddle 推理引擎或本地 OCR 模型，也没有把官方 SDK 的完整依赖引入 Zotero。
