# 支持的定位 JSON

## 官方 PaddleOCR 结果

支持官方异步服务 JSONL 下载后形成的对象列表、同步响应的 `result.layoutParsingResults`、单页 `prunedResult`，以及本地产线保存的 `res`/单页对象列表。

PP-StructureV3 主要读取：

- 页面 `width/height`，原始图像单位，通常为像素。
- `overall_ocr_res.rec_texts` 和 `rec_polys`，也支持 `rec_boxes`。
- `parsing_res_list` 的列表阅读顺序及 `block_bbox`。行文字按所属版面块排序，用真实行框定位，减少双栏串行。
- 如果没有行框，可用 `parsing_res_list.block_content/block_bbox` 生成块级文字层，并显示定位精度提示。

官方 `layoutParsingResults` 数组按页序处理。`prunedResult` 可能没有 `page_index`；插件按已保存的任务页段和数组位置映射。外部本地 JSON 中显式提供的 `page_index` 从 0 开始，不能重复或越界。

默认情况下，缺少真实页面尺寸、无法解析坐标、页数不符、整份没有文字或使用了缺少反变换的扭曲矫正结果时拒绝生成。不会用最后一个文字框估算页面大小，也不会把 Markdown 平均分配到页面。

## 旧版 PaddleOCR PDF 结果缺少页面尺寸

部分旧版导出仅保留 `prunedResult`，包含行文字和坐标，却不含 `width/height`。改变表格、公式或图表识别开关不能保证补回这些字段，需要导出端保留完整元数据，或提供可核实的坐标基准。

0.1.3 支持在设置中显式填写“旧版 JSON 的 PDF 坐标倍率”：

- 默认 `0`：不补尺寸，缺失时仍报错。
- 已确认 PDF 按 144 DPI 渲染时填 `2`，即 PDF point 尺寸的 2 倍。按每一页实际显示裁剪框分别计算宽高，并向上取整。
- JSON 已有尺寸时优先使用其尺寸；统一格式 `zotero-paddleocr/1` 始终要求显式尺寸，不应用兼容补值。
- 倍率作为本地任务参数保存。改变倍率只影响本地生成，不触发重新识别。

[PaddleX PDF 读取器源码](https://github.com/PaddlePaddle/PaddleX/blob/develop/paddlex/inference/utils/io/readers.py) 当前默认 `zoom=2.0`，但读取器也支持像素上限等调整。不能据此认定所有服务、版本、上传方式都使用固定倍率；必须核实实际结果。扫描图像在 PDF 中的原生像素尺寸、服务返回的缩略图尺寸均不能代替 OCR 坐标空间尺寸。文档发生旋转、裁剪或扭曲后，没有对应变换也不能只靠倍率修正。

《中国文学史料学》的现有 1,392 页 PP-StructureV3 JSON 经本地核对可用倍率 `2`。完整文件的临时生成、页面保真抽查及定位检查见 [测试记录](TESTING.md)；原 PDF 和 JSON 未修改。

## 其他工具的统一格式

其他 OCR 工具的结果可转换成以下结构。插件不会猜测未知工具的字段含义。

```json
{
  "schema": "zotero-paddleocr/1",
  "pages": [
    {
      "index": 0,
      "width": 1240,
      "height": 1754,
      "origin": "top-left",
      "space": "display",
      "lines": [
        {"text": "中文与 English", "bbox": [100, 120, 600, 160], "order": 0},
        {"text": "下一行", "quad": [[100,180],[360,180],[360,220],[100,220]], "order": 1}
      ]
    }
  ]
}
```

- 必须为 PDF 每一页提供一个页面对象。空白页使用 `lines: []`，不要省略这一页。
- `index` 从 0 开始；`order` 是该页阅读顺序，建议使用整数。
- `bbox` 是 `[x0,y0,x1,y1]`；`quad` 是沿文字方向的左上、右上、右下、左下四角，支持倾斜和旋转文字。
- 默认 `origin` 为 `top-left`；可显式使用 `bottom-left`。
- 默认 `space` 为 `display`：坐标对应阅读器显示的、已经应用 PDF 页面旋转的裁剪页图像。`width/height` 必须描述这张图像的实际尺寸。
- `space: "unrotated"` 表示未应用 PDF 页面旋转的裁剪页坐标。不要传入整个 MediaBox 的坐标却声明为裁剪页坐标。
- 可以使用像素或 point，但页面尺寸和全部坐标必须使用同一单位。引擎按实际页面尺寸比例映射，再转换回未旋转的 PDF 页面空间。

Markdown 只用于保留可读文本并做长度差异提示。OCR 错字、标点或轻微坐标误差不触发二次识别，也不作为自动替换门槛。

## 已知精度边界

行级框优于块级框。只有块框时，单行长段落会作为块内一行处理；显式换行会在该块内部按行排布，不恢复模型未提供的精确基线。块级选择范围可能较宽。

没有版面阅读顺序时遵循现有行顺序/位置，不保证复杂双栏、跨页表格和公式的复制顺序。图形形式的公式、图片中未识别的文字和未返回的表格内容不会凭空补全。
