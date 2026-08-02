# Pi、Codex CLI 与 Claude Code 的图片上传预处理调研

> 调研日期：2026-08-02
>
> 本机版本：Pi `0.83.0`、Codex CLI `0.146.0`、Claude Code `2.1.212`

## 结论摘要

1. **Pi 不是没有图片预处理。** Pi 默认会校正格式、缩放尺寸并控制单张图片的 Base64 大小。
2. 本次故障更准确的原因是：**Pi 的限制是“单图限制”，缺少“整次请求/多图累计预算”，并且其编码选择实现会让低于阈值的 PNG 优先通过。** 四张图片单独都合法，但累计 Base64 达到约 6.57 MB，再叠加约 124K tokens 的长会话，Codex SSE 请求持续 `fetch failed`。
3. **OpenAI Codex CLI 会预处理图片。** 默认 `high` 路径按最长边和视觉 patch 数量缩放；当前源码限制为最长边 2048、最多 2500 个 32×32 patch。它没有看到类似 Claude Code 那样积极的单图字节压缩策略，PNG 在符合视觉预算时可能原样保留，缩放后也仍按 PNG 编码。
4. **Claude Code 会在客户端提前做更积极的图片预处理。** 已发布的 `2.1.212` 客户端包含尺寸限制、PNG 优化、JPEG 多档质量压缩、继续缩小尺寸和最终兜底压缩；默认限制可从客户端代码中确认是 2000×2000、Base64 5 MiB、原始目标 3.75 MiB，并在后续阶段把图像进一步压到约 512 KB 的字节预算。
5. **Claude Code 还有会话级媒体累计字节保护。** 发布客户端包含 `tengu_media_byte_cap`：统计消息中的图片/文档媒体字节，超过预算后从较旧消息中移除媒体块并放入 `[media removed: request limit]`。本机构建中可见 24 MiB（32 MiB 请求上限预留 8 MiB）和 75 MiB 两档，具体启用值受运行模式/feature flag 影响。
6. Anthropic API 服务端也会为视觉 token 预算缩放图片，但那发生在请求上传之后，**不能替代 CLI 侧预处理对网络请求体的保护**。

## 对比

| 客户端 | 上传前预处理 | 默认尺寸策略 | 字节策略 | 多图累计请求预算 |
|---|---|---|---|---|
| Pi 0.83.0 | 有 | 最大 2000×2000 | 单图 Base64 < 4.5 MiB；尝试 PNG/JPEG | 未发现 |
| Codex CLI 0.146.0 | 有 | `high`: 2048 最长边、2500 patches；`original`: 6000、10000 patches | 主要按尺寸/patch；PNG 可能保留或重编码为 PNG | 未发现客户端累计预算 |
| Claude Code 2.1.212 | 有，较积极 | 默认 2000×2000 | PNG 优化；JPEG 80/60/40/20；继续缩放；约 512 KB 后置预算 | 有媒体累计字节 cap；超限移除较旧媒体，构建中可见 24/75 MiB 两档 |

## 1. Pi 实际做了什么

Pi 的 `processImage()` 默认设置：

```ts
const autoResizeImages = options?.autoResizeImages ?? true;
```

它会：

- 接受 PNG、JPEG、GIF、WebP；其他可转换格式转成 PNG；
- 调用 `resizeImage()`；
- 以 Base64 和 MIME type 写入会话消息；
- 在缩放后附加原图和显示尺寸的坐标换算提示。

Pi `0.83.0` 的默认参数是：

```ts
maxWidth: 2000,
maxHeight: 2000,
maxBytes: 4.5 * 1024 * 1024, // Base64 payload
jpegQuality: 80,
```

策略注释声称会“尝试 PNG 和 JPEG 并选较小者”，但当前实现实际构造候选后按顺序返回第一个低于阈值的候选：

```ts
const candidates = [png, ...jpegCandidates];
for (const candidate of candidates) {
  if (candidate.encodedSize < opts.maxBytes) return candidate;
}
```

因此，只要 PNG 已低于 4.5 MiB，就不会继续比较 JPEG 是否小得多。这与本次 session 完全吻合：四个工具结果仍是 PNG，Base64 分别约 1.82 MB、0.74 MB、1.21 MB、2.80 MB；每张都低于 4.5 MiB，但累计约 6.57 MB。

### 本次 session 的直接证据

目标 session：已匿名化

- 出错前最后一次成功请求约有 `124416` cache-read tokens；
- 一次读取四张截图；
- 四张图的 Base64 总量约 `6,567,972` 字符；
- 从图片进入上下文后连续出现 `fetch failed`，自动重试最终 `Aborted after 3 retry attempts`；
- 将四张图压为 1200px JPEG 后，Base64 总量下降到约 563 KB。

所以，本次问题不是“完全没有预处理”，而是 **预处理的单图阈值和编码选择不足以保护多图长会话的总请求体**。

## 2. Codex CLI 的处理

OpenAI Codex 是开源的。当前 `main` 的 `image_preparation.rs` 会遍历普通消息和工具结果中的图片，在构建请求前调用 `load_data_url_for_prompt(...ResizeWithLimits)`。

默认策略：

```rust
HIGH_DETAIL_LIMITS = {
  max_dimension: 2048,
  max_patches: 2500,
}

ORIGINAL_DETAIL_LIMITS = {
  max_dimension: 6000,
  max_patches: 10000,
}
```

patch 大小为 32×32。图片会先按最长边缩放，再按 patch 面积预算继续缩小。无法处理或过大的图片会被文本占位符替换，而不是无条件上传。

编码方面：

- 未触发缩放且格式为 PNG/JPEG/WebP 时，会保留原始字节；
- 触发缩放时倾向保留原格式；
- JPEG 使用 quality 85；
- PNG 仍编码为 PNG；
- 源码中的 1 GiB 输入上限被明确描述为防病态输入的 sanity guard，不是目标上传大小。

因此 Codex CLI 确实有视觉尺寸预处理，但**当前代码主要控制像素/patch，而不是像 Claude Code 那样把截图积极转成较小 JPEG**。对几张高压缩比不佳的 PNG 截图，它不一定能显著降低请求字节数。

## 3. Claude Code 的处理

Claude Code 官方文档公开支持拖放、粘贴、路径和多图会话，但没有完整公开客户端实现。检查 Anthropic 发布的本机 Claude Code `2.1.212` 可执行文件，可以确认客户端包含以下流程：

- 默认 `maxWidth: 2000`、`maxHeight: 2000`；
- 默认 `maxBase64Size: 5 MiB`；
- 默认 `targetRawSize: 3.75 MiB`；
- PNG 先尝试最高压缩和 palette；
- JPEG 依次尝试 quality 80、60、40、20；
- 超尺寸时等比缩到尺寸限制后再次尝试 PNG/JPEG；
- 仍太大时缩到最长边不超过 1000 并用 JPEG quality 20；
- 后续还有 `512000` 字节预算，超过时通过 JPEG 质量搜索进一步压缩；
- 另一路通用压缩会依次尝试原尺寸比例 1、0.75、0.5、0.25，然后 800px PNG、600px JPEG quality 50、400px JPEG quality 20；
- 发送前还有累计媒体字节 cap，超过时优先移除较旧图片/文档，并用 `[media removed: request limit]` 占位；本机构建包含 24 MiB 和 75 MiB 两档预算，运行时由模式/feature flag 选择。

这说明 Claude Code 的客户端预处理明显更强调**控制上传字节数**，不只是满足模型像素限制。

Anthropic Vision 官方文档另外说明：

- API 每图最大 8000×8000；超过 20 张时适用更严格的单图尺寸限制，跨平台安全值为 2000px；
- 标准视觉层的模型原生长边上限为 1568px，超出后服务端会下采样；
- Base64 多轮对话会在每轮重新发送完整图片字节，随着历史增长显著增加请求大小和延迟；官方建议 Files API + `file_id` 来避免重复传输；
- 标准端点请求大小上限为 32 MB，但某些合作平台更低。

服务端视觉下采样发生在服务端收到请求以后，因此仍需要客户端压缩来避免网络层和请求体层面的失败。

## 建议给 Pi 的改进方向

按优先级：

1. **修正“选较小编码”的实现**：对同一尺寸真正比较 PNG 与 JPEG 候选，而不是返回第一个达标 PNG。
2. **增加整次请求图片预算**：例如默认所有内联图片 Base64 合计不超过 2–4 MiB；超出时按比例重新压缩。
3. **对多图使用更低单图预算**：1 张可宽松，多张时动态收紧到 256–512 KB/张。
4. **截图优先 JPEG/WebP**：照片和复杂 UI 截图优先有损编码；纯文字/线稿再保留 PNG。
5. **发送前记录可诊断指标**：图片数量、各图编码大小、图片合计、完整 request bytes、压缩前后比例。
6. **失败恢复**：遇到 transport/fetch failure 且请求包含大图时，自动进行一次更激进压缩后重试，而不是原样重发三次。
7. **会话级图片淘汰或摘要**：模型已提取完图片信息后，允许 compaction 将旧图片替换成文字摘要，避免每轮重复发送 Base64。
8. 对支持文件引用的 provider，可考虑上传一次后保存 `file_id`，避免每轮内联重复发送。

## 补充：累计预算、Pi 扩展与大 PDF

### 三家是否有整次请求/多图累计预算

- **Pi 0.83.0：未发现内置累计图片字节预算。** 它只在读取/附加单张图时应用尺寸和单图 Base64 阈值。`context` 和 `before_provider_request` 扩展事件足以让第三方在发送前实现累计预算。
- **Codex CLI 0.146.0 / 当前开源 main：未发现普通请求路径上的累计媒体字节 cap。** 它有单图尺寸/patch 预算；远端 compaction v2 对保留历史设置 64K token 预算，图片消息也会占预算并可能被丢弃，但这不是常规发送前的请求字节预算。
- **Claude Code 2.1.212：有。** `tengu_media_byte_cap` 会统计累计图片/文档媒体字节，超限后移除较旧媒体；本机构建可见 24 MiB 和 75 MiB 两档，同时保留 32 MiB 请求限制的头部/文本空间。

因此，“三家都没有”并不准确；**Claude Code 已做累计媒体保护，Pi 和 Codex CLI 主要还是单图/视觉预算。**

### 可用的 Pi 扩展

未在 npm `pi-package` 搜索结果中发现一个明确宣称“对所有 provider、所有历史图片统一实施累计 Base64 请求预算”的现成扩展。最接近的有：

1. [`pi-image-paste`](https://github.com/tuanhung303/pi-image-paste)
   - 粘贴/拖入时自动优化；默认单图目标 2 MiB，可配置质量和缩放阶梯。
   - 仍是单图限制，不是累计预算；可把 `maxImageBytes` 配到 256–512 KiB，间接降低多图风险。
   - 主要覆盖用户粘贴附件，不等同于治理历史中的所有 `read` 工具图片。
2. [`pi-vision-handoff`](https://github.com/monotykamary/pi-vision-handoff)
   - 用单独视觉模型描述图片，在 Pi 的 `context` 事件中把图片替换成缓存的文字描述。
   - 这是减少后续每轮 Base64 重传的有效方案；代价是多一次视觉调用和有损文字化。
   - 支持按图片 hash 缓存、同一批图片合并描述，默认主要服务文本模型，也可显式配置目标模型。
3. [`@okrapdf/pi`](https://github.com/okrapdf/pi)
   - 面向 PDF 的布局感知解析、检索和截图。
   - PDF 视觉解析是**逐页模型调用**，结果保存为 Markdown、布局块和逐页原始响应，不把所有页塞进一次请求。
   - `pdf_screenshot` 硬限制一次最多 8 页，工具提示建议通常保持 1–4 页；支持页范围和费用上限。
4. [`pi-docparser`](https://github.com/maxedapps/pi-docparser)
   - 本地 LiteParse/PDFium 文本提取、搜索、OCR 和截图。
   - 推荐先搜索定位页，再只截图 1–4 个相关页面；完整输出写临时文件，避免直接进入上下文。
   - 截图工具本身允许更宽范围，因此安全性仍依赖工具提示/使用方式，而不是严格累计字节 cap。

第三方 Pi 包拥有完整本机权限，安装前应审计源码。上述调查只读取了 npm tarball/README/源码，没有安装执行。

### 大 PDF / 多页视觉文档的推荐处理架构

不要把 PDF 每页一次性转成图片后全部内联。稳健流程是：

1. **本地预解析**：先提取原生文本、目录、页码、标题、表格和坐标；仅对扫描页选择性 OCR。
2. **落盘而非内联**：完整 Markdown/JSON/OCR/页面图片保存到 artifact 目录，主上下文只保留路径、索引和短摘要。
3. **检索后看图**：先全文搜索、BM25/向量检索或目录定位，再渲染相关的 1–4 页。
4. **逐页或小批视觉调用**：每页单独调用，或每批 2–4 页；设置并发上限、超时、重试和费用上限。
5. **Map–reduce 摘要**：生成逐页摘要 → 章节摘要 → 全文摘要；保留 `结论 → 页码 → 原文块/截图` 的引用链。
6. **缓存与去重**：按 `document hash + page + DPI + OCR/模型版本` 缓存文本、截图和视觉描述，恢复 session 时不重复上传。
7. **累计预算**：发送前同时限制图片数量、Base64/原始字节总量和估算视觉 token；超限时优先用缓存文字描述替换旧图片。
8. **分离特殊内容**：表格走结构化提取，图表/签名/版式才走视觉模型；不要让视觉模型承担可由 PDF 文本层完成的工作。
9. **provider 文件引用**：支持 Files API/`file_id` 时可避免每轮重复传 Base64，但仍需页选择和上下文预算；它解决传输重复，不自动解决模型注意力与费用问题。

对纯文本 PDF，推荐 `pi-docparser` 的 parse/search 路线；对扫描件、复杂表格和版式敏感文档，`@okrapdf/pi` 的逐页视觉解析路线更合理。

## 最终判断

**不是 Pi 没有图片预处理，而是 Pi 0.83.0 的预处理粒度和压缩策略不够稳健。**

- Pi：有预处理，但偏“单图 API 合规”；
- Codex CLI：有预处理，偏“视觉尺寸与 patch 预算”；
- Claude Code：有预处理，而且更偏“尺寸 + 单图字节预算 + 多级降级 + 会话媒体累计预算”。

本次四图长 session 场景中，Claude Code 的客户端策略最有可能提前把图片压到安全范围；Codex CLI 是否显著变小取决于图片尺寸是否触发重编码和原始格式；Pi 虽然缩到了 2000px，但让多个仍较大的 PNG 一起进入上下文，最终没有守住总请求体。

## 一手资料

### Pi

- Pi `processImage` 源码（官方仓库）：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/utils/image-process.ts>
- Pi `image-resize-core` 源码（官方仓库）：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/utils/image-resize-core.ts>
- 本机 Pi 0.83.0 发布包中的 `dist/utils/image-process.d.ts.map` 与 `dist/utils/image-resize-core.d.ts.map`

### OpenAI Codex CLI

- 图片请求预处理：<https://github.com/openai/codex/blob/main/codex-rs/core/src/image_preparation.rs>
- 图片加载、缩放和编码：<https://github.com/openai/codex/blob/main/codex-rs/utils/image/src/lib.rs>
- 对应测试：<https://github.com/openai/codex/blob/main/codex-rs/core/src/image_preparation_tests.rs>
- `view_image` 工具：<https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/view_image.rs>

### Anthropic / Claude Code

- Claude Code 官方图片工作流：<https://code.claude.com/docs/en/common-workflows#work-with-images>
- Anthropic Vision 官方文档：<https://platform.claude.com/docs/en/build-with-claude/vision>
- 本机 Anthropic 发布客户端版本 `2.1.212`；上述客户端压缩流程和常量来自该一方发布制品。Claude Code 客户端不是完整开源项目，因此这部分不能提供公开源码行链接。
