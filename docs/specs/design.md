# pi-media-guard 设计方案

## 1. 目标

创建一个可独立开源、可发布到 npm、GitHub 和 Pi package gallery 的 Pi 扩展：

```text
pi-media-guard
```

它负责在每次模型请求前确定性地统计图片/文档媒体规模，并在超过预算时进行去重、压缩、文字替代或阻断，避免长 session 因历史 Base64 媒体反复重传而出现：

- `fetch failed` / WebSocket 断开；
- provider `request_too_large`；
- 多图/多页 PDF 超限；
- compaction 自身因媒体过大而失败；
- session 越长、单轮越慢的恶性循环。

插件应默认保护所有 Pi provider，不依赖模型“记得主动处理”，也不要求用户手工压缩 JSONL。

## 2. 设计依据

### 2.1 本次 Pi 故障

一个已匿名化的长 session 一次读取四张截图：

- 四张图分别满足 Pi 的单图 4.5 MiB Base64 限制；
- 合计 Base64 约 6.57 MB；
- session 已有约 124K tokens；
- 图片进入上下文后连续 `fetch failed`；
- 压成 1200px JPEG 后合计约 563 KB，session 可继续恢复。

根因是单图合规不等于整次请求安全。

### 2.2 Noah Agent SDK 的经验

参考内部 Agent SDK 的媒体路由、transcript integrity、图片集成和慢 trace 调研，应继承的结论：

1. Agent 可以做语义选页，但不能充当精确 Base64/HTTP 预算控制器。
2. 硬门控必须由 host/extension 确定性执行，不能只靠 system prompt。
3. PDF 要先 inventory、文本抽取和检索，再做小批视觉检查。
4. 大媒体状态下不能把“主动 compact”作为唯一恢复路径，因为 compact 自己也需要发请求。
5. 历史媒体可以在原 block 位置替换成事实性 text，但不能破坏 thinking 签名、tool call/result 关联、角色、顺序和分支结构。
6. 文档长任务的主要性能风险不只是单次 payload，而是碎片化操作导致 turn 数和上下文同时膨胀。
7. Noah 的 `analyze_images` 已验证“双预算”思路：解码媒体总量和最终序列化请求体分别设限。

## 3. 领域语言

插件采用以下术语：

**Media Block**

一次消息中的图片或文档内容块。避免用“附件”泛指所有文件，因为普通文本文件不属于媒体预算。

**Media Ledger**

当前活跃上下文中所有 Media Block 的确定性账本，记录位置、hash、类型、来源、优先级和字节规模。

**Request Projection**

由原始 session 上下文生成、仅用于本次模型请求的安全消息视图。默认不修改持久 JSONL。

**Media Budget**

一次模型请求允许携带的媒体数量、单块字节和累计序列化字节上限。

**Pressure Level**

预算状态：`green`、`yellow`、`red`。

**Externalization**

Request Projection 中不再内联旧媒体，只保留 artifact 路径、hash、描述和重新读取提示。原媒体仍可存在于 session 或文件系统。

**Evidence Note**

替代历史媒体的事实性 text block，包含来源、已知内容、hash 和不确定性，不包含操作性指令。

**Current Working Set**

当前用户消息及其后本轮工具结果中的媒体。它比历史媒体优先保留。

## 4. 范围

### 4.1 v1 必须完成

- 统计 Pi canonical `AgentMessage[]` 中的图片块；
- 精确计算 Base64 字符数、估算解码字节和媒体总量；
- 图片 hash 去重；
- 单图和累计预算；
- 对图片进行尺寸/质量压缩；
- 当前工作集优先、历史媒体先淘汰；
- 在 Request Projection 中将淘汰媒体替换成 Evidence Note；
- 默认不改 session JSONL；
- OpenAI Responses/Codex 和 Anthropic payload 最终审计；
- 状态命令、TUI 提示和本地脱敏指标；
- media-safe compaction；
- 对 PDF/多页文档提供 inventory-first workflow 和其他 PDF 插件互操作提示；
- 完整单元、属性和集成测试。

### 4.2 v1 非目标

- 自己实现完整 PDF parser、OCR 或 RAG；
- 默认调用额外视觉模型生成摘要；
- 上传媒体到第三方云存储；
- 自动永久删除 session 历史；
- 修改 thinking/reasoning block；
- 修复任意未知第三方 extension 生成的私有 payload schema；
- 承诺精确预测 provider 压缩后的网络包大小。

## 5. 方案比较

### 方案 A：只在图片进入 session 时压缩

在 `input` 和 `tool_result` 事件中压缩图片。

优点：

- session 文件从一开始就较小；
- 后续请求无需重复压缩。

缺点：

- 仍没有历史累计预算；
- 永久降低 session 中图片质量；
- 无法治理已有 session；
- 其他 extension 后续注入的媒体可能绕过。

结论：作为优化层保留，但不能作为安全 seam。

### 方案 B：只改最终 provider payload

在 `before_provider_request` 中扫描最终 JSON payload。

优点：

- 最接近真实请求；
- 能看到 provider 序列化后的结构。

缺点：

- Anthropic/OpenAI/Google 结构不同；
- 容易误伤 reasoning、thinking 和 tool protocol；
- 接口浅而 provider adapter 复杂；
- 不利于跨 provider 测试。

结论：只做最终审计和支持 provider 的紧急兜底，不作为主 seam。

### 方案 C：Artifact/Vision-first

图片一律交给 sidecar vision，主 session 只保留文字描述。

优点：

- 主请求体最小；
- 适合文字模型和大文档。

缺点：

- 每组图片增加额外模型调用；
- 描述有损；
- 单图交互体验下降；
- vision sidecar 自己仍需要预算。

结论：作为可选 adapter，不作为默认。

### 方案 D：两阶段 Request Projection——选定

1. `input` / `tool_result`：可选的早期单图优化；
2. `context`：生成满足累计 Media Budget 的 Request Projection；
3. `before_provider_request`：审计最终 payload，并对已支持 provider 做最后一层紧急保护。

这是推荐方案。主 seam 是 provider 无关的 Pi canonical context，最终 payload guard 只承担补充职责。

## 6. 总体架构

```text
Pi session / current AgentMessage[]
              │
              ▼
┌──────────────────────────────────────────────┐
│ MediaGuard                                  │
│                                              │
│  1. Inventory → Media Ledger                │
│  2. Classify → Current / Historical         │
│  3. Policy → Budget Plan                    │
│  4. Transform → Request Projection          │
│  5. Verify → invariants + final footprint   │
└──────────────────────────────────────────────┘
              │
              ▼
      Pi context event result
              │
              ▼
     provider payload serializer
              │
              ▼
┌──────────────────────────────────────────────┐
│ Final Payload Guard                         │
│ inspect exact JSON / supported emergency fix│
└──────────────────────────────────────────────┘
              │
              ▼
          Provider
```

辅助路径：

```text
input/tool_result ──► Ingest Optimizer ──► smaller stored media (optional)
agent_settled     ──► Maintenance Policy ──► optional safe compaction
PDF tools         ──► local parse/search ──► selected page images only
```

## 7. 深模块与 seam

### 7.1 `MediaGuard`——外部核心模块

对 extension adapter 和测试只暴露一个主要接口：

```ts
interface MediaGuard {
  project(
    messages: AgentMessage[],
    environment: GuardEnvironment,
  ): Promise<GuardResult>;
}

interface GuardResult {
  messages: AgentMessage[];
  report: GuardReport;
}
```

`MediaGuard` 隐藏：

- 多种消息位置遍历；
- hash 去重；
- 优先级计算；
- 动态单图预算；
- 编码选择；
- Evidence Note 构造；
- 不变量验证；
- cache；
- 压缩失败降级。

这是一个深模块：调用方只需提交 messages 和环境，所有媒体安全复杂度集中在一个实现内。

### 7.2 `ImageCodec`——本地可替换 seam

```ts
interface ImageCodec {
  constrain(image: MediaImage, target: ImageTarget): Promise<EncodedImage | null>;
}
```

Adapters：

- `PiPhotonCodec`：生产环境，复用 Pi 导出的 `resizeImage()`；
- `FakeImageCodec`：测试环境，返回确定性大小。

默认不直接依赖 `sharp`，避免给 Pi package 增加大型原生依赖。若 Pi 的 resize 实现不能真正比较 PNG/JPEG 大小，可在后续增加可选 `SharpCodec`。

### 7.3 `MediaDescriber`——真正可选 seam

```ts
interface MediaDescriber {
  describe(items: MediaItem[], request: DescriptionRequest): Promise<EvidenceNote[]>;
}
```

Adapters：

- `NoopDescriber`：默认，不增加模型调用；
- `PiVisionDescriber`：可选，用配置的视觉模型批量描述；
- 未来可接本地 OCR/VLM。

只有启用 adapter 时才产生额外模型调用。描述按媒体 hash 缓存。

### 7.4 `ProviderPayloadAdapter`——最终 payload seam

```ts
interface ProviderPayloadAdapter {
  supports(model: Model): boolean;
  inspect(payload: unknown): PayloadFootprint;
  emergencyProject(payload: unknown, policy: FinalPayloadPolicy): unknown;
}
```

首批 adapters：

- `OpenAIResponsesPayloadAdapter`；
- `OpenAICodexResponsesPayloadAdapter`；
- `AnthropicMessagesPayloadAdapter`。

Google adapter 可在 v1.1 增加。未知 provider 只审计 canonical context，不做 payload surgery。

## 8. 不变量

无论策略如何，必须保持：

1. message role 和顺序不变；
2. assistant thinking/reasoning/signature block 逐字节不变；
3. tool call ID、tool result ID、名称和配对关系不变；
4. 不删除整条 tool result message；
5. 只替换媒体 leaf block，或改变该媒体 block 的编码数据；
6. Current Working Set 在预算允许时优先保留；
7. 输出媒体总量不得超过配置预算；
8. Request Projection 失败时不得悄悄回退到原始超大媒体；
9. 不记录 Base64、图片内容、凭据或完整 provider payload；
10. 默认不修改 session JSONL。

Evidence Note 示例：

```text
[Historical image externalized by pi-media-guard]
Source: /tmp/example/page-004.png
Media hash: sha256:ab12…
Original: image/png, 2416x1414
Reason: request media budget
Known description: unavailable
Re-read the source artifact if exact pixels or small labels are needed.
```

它只陈述事实，不包含“忽略前文”“必须执行”等指令。

## 9. 预算模型

同时维护四种预算：

```ts
interface MediaBudget {
  maxMediaBlocks: number;
  maxSerializedMediaBytes: number;
  maxDecodedMediaBytes: number;
  maxSerializedBytesPerImage: number;
}
```

建议默认值：

```json
{
  "maxMediaBlocks": 8,
  "maxSerializedMediaBytes": 2097152,
  "maxDecodedMediaBytes": 1572864,
  "maxSerializedBytesPerImage": 524288
}
```

解释：

- 默认累计 Base64/序列化媒体 2 MiB；
- 单图最多 512 KiB；
- 给文本、tools、reasoning 和 JSON 结构留足空间；
- 比 Claude Code 的 24 MiB 累计 cap 更保守，因为本次 Codex SSE 在较小 body 上已表现不稳定；
- 用户可按 provider profile 放宽。

Pressure Level：

| Level | 条件 | 行为 |
|---|---|---|
| Green | < 60% | 只去重和处理单图超限 |
| Yellow | 60–100% | 压缩历史图、提示 Agent 后续使用批处理/文本抽取 |
| Red | > 100% | 强制生成安全 Request Projection，淘汰旧媒体，绝不原样发送 |

Provider profiles 只修改默认预算，不改变安全算法：

```json
{
  "profiles": {
    "openai-codex": { "maxSerializedMediaBytes": 2097152 },
    "openai": { "maxSerializedMediaBytes": 4194304 },
    "anthropic": { "maxSerializedMediaBytes": 4194304 }
  }
}
```

不直接把 provider 官方最大请求体作为插件预算，因为还要为非媒体上下文保留空间。

## 10. 决策算法

### 10.1 Inventory

扫描所有 canonical messages，生成 Media Ledger：

```ts
interface MediaLedgerItem {
  messageIndex: number;
  contentIndex: number;
  kind: "image" | "document";
  mimeType: string;
  hash: string;
  serializedBytes: number;
  decodedBytes: number;
  source?: string;
  age: number;
  currentWorkingSet: boolean;
  priority: number;
}
```

Base64 decoded bytes使用确定性公式计算，不先分配完整 Buffer：

```text
decoded ≈ floor(base64Length × 3 / 4) - padding
```

### 10.2 去重

相同 `hash`：

- 保留最新、最高优先级的一份；
- 其他副本替换成轻量引用；
- 不重复进行 vision description。

### 10.3 优先级

由高到低：

1. 当前用户直接附加图片；
2. 当前 turn 的工具结果图片；
3. 最近一次用户媒体；
4. 最近历史媒体；
5. 已有缓存 Evidence Note 的媒体；
6. 重复媒体；
7. 最旧媒体。

优先级是 host 策略，不接受模型参数临时放宽。

### 10.4 压缩

1. 先处理超过单图上限的图片；
2. 根据剩余总预算为 Current Working Set 分配 fair-share；
3. 先限制最长边 2000；
4. 必要时逐级尝试 1600、1200、1000、800；
5. 每级尝试 PNG/JPEG，真正选择较小且满足预算的编码；
6. 缓存键：`sha256(input) + codecVersion + target`。

使用 Pi `resizeImage()` 时，将动态 `maxBytes` 传入；若其实现仍优先接受 PNG，则 `PiPhotonCodec` 需要额外比较候选，或引入修复后的上游版本。

### 10.5 Externalization

压缩后仍超预算：

- 最旧历史媒体先换成缓存 Evidence Note；
- 没有描述时换成 deterministic placeholder；
- Current Working Set 只有在自身已经无法满足硬预算时才会被替换；
- 被替换时必须 TUI warning，不能静默丢失。

### 10.6 验证

Transformation 后重新扫描：

- 媒体数量和总字节必须满足预算；
- tool/thinking invariants 必须通过；
- 若失败，运行 emergency projection：保留最高优先级且能放入预算的媒体，其余全部 Evidence Note；
- emergency projection 仍失败则本轮不发送媒体，并明确通知用户。

## 11. Pi 事件集成

### `input`

- 对用户直接附件做早期单图优化；
- 可配置 `ingest.persistOptimized=true|false`；
- 默认 `true`，减少新 session 膨胀；
- 原始粘贴文件不删除。

### `tool_result`

- 对 `read` 和第三方工具返回的 image block 做早期优化；
- 保留 text、details、toolCallId；
- 可从 text/details 提取 source path；
- 默认目标 512 KiB。

### `context`——主安全 seam

- 调用 `MediaGuard.project()`；
- 只修改 Pi 提供的 deep copy；
- 每次 LLM call 都执行，因此覆盖 resume、branch 和工具循环；
- 使用 hash cache，避免每轮重复压缩。

### `before_provider_request`

- 计算最终 `JSON.stringify(payload)` 字节；
- 记录脱敏 footprint；
- 支持 adapter 时检查 payload 中媒体是否仍超预算；
- 必要时执行 emergency projection；
- 不遍历或修改 reasoning/thinking 密文。

限制：如果另一个 extension 在 `pi-media-guard` 的 provider hook 之后继续注入媒体，Pi 当前没有“绝对最后 handler”机制。文档应建议把本插件放在 package 列表末尾；无法防御恶意 extension。

### `agent_settled`

- 更新状态；
- 可选触发 maintenance compaction；
- 默认只提醒，不自动执行有损 compact。

### `session_before_compact`

当待摘要历史媒体超过安全阈值：

- 先用 MediaGuard 生成 text-safe summary input；
- cached Evidence Note 进入摘要；
- 原图片不进入 summary provider request；
- 返回合法 compaction entry；
- 不伪造 compact boundary。

## 12. Compaction 策略

配置：

```json
{
  "compaction": {
    "mode": "suggest",
    "mediaThresholdBytes": 4194304,
    "contextPercentage": 80,
    "cooldownTurns": 10
  }
}
```

模式：

- `off`：不参与；
- `suggest`：默认，只在 TUI 提醒；
- `auto-idle`：仅 `agent_settled` 且跨过阈值时触发；
- `custom-only`：只保证用户手工 `/compact` 使用 media-safe summary input。

禁止在活跃工具调用中启动并发 session maintenance。Pi 的 `ctx.compact()` 比 Agent SDK 更直接，但仍只在 settled/idle 状态使用。

## 13. PDF 与多页文档

插件自身不成为 PDF parser，而是提供策略和互操作。

### 13.1 默认规则

- 一个 PDF 不按“一张媒体”计算；
- 先通过文件 metadata / `pdfinfo` 获取页数；
- 原生文本 PDF 优先 parse/search；
- 扫描件选择性 OCR；
- 视觉检查每批建议 1–4 页，硬上限 8 页；
- 完整 Markdown/JSON/PNG 写 artifact，主上下文只放路径、页码、摘要和引用。

### 13.2 与现有 Pi packages 互操作

启动时通过 `pi.getAllTools()` 检测：

- `@okrapdf/pi`：`pdf_parse`、`pdf_search`、`pdf_screenshot`；
- `pi-docparser`：`document_parse`、`document_search`、`document_screenshot`。

若存在，在 yellow/red 时给 Agent 注入具体建议：

```text
Media budget is red. Do not directly read more PDF page images.
Use document_search/pdf_search first, then inspect 1–4 relevant pages.
```

若不存在，只给出通用本地工具建议，不自动安装第三方包。

### 13.3 反碎片化

配套 skill 明确：

- 不允许“一轮裁一张小图看一个字段”；
- 对表单字段一次生成带编号 contact sheet；
- 对注释/checkbox 一次性输出 JSON manifest；
- 一批读取多个必要页面；
- 逐页摘要后再章节 reduce；
- 所有视觉结论带页码和 artifact path。

这直接吸收 Noah 慢 trace 中“145 turns 里 100+ turns 是逐字段探测”的经验。

## 14. 配置接口

全局：

```text
~/.pi/agent/pi-media-guard.json
```

项目覆盖：

```text
.pi/pi-media-guard.json
```

建议 schema：

```json
{
  "version": 1,
  "enabled": true,
  "mode": "protect",
  "budget": {
    "maxMediaBlocks": 8,
    "maxSerializedMediaBytes": 2097152,
    "maxDecodedMediaBytes": 1572864,
    "maxSerializedBytesPerImage": 524288
  },
  "ingest": {
    "optimizeUserImages": true,
    "optimizeToolImages": true,
    "persistOptimized": true
  },
  "history": {
    "strategy": "compress-then-externalize",
    "keepLatestMedia": 2
  },
  "describer": {
    "enabled": false,
    "model": null,
    "cache": "session"
  },
  "pdf": {
    "recommendedBatchPages": 4,
    "hardBatchPages": 8
  },
  "compaction": {
    "mode": "suggest",
    "mediaThresholdBytes": 4194304,
    "contextPercentage": 80,
    "cooldownTurns": 10
  },
  "privacy": {
    "persistDescriptions": false,
    "metrics": "local-redacted"
  }
}
```

`mode`：

- `observe`：只统计和告警；
- `optimize`：压缩但不 externalize；
- `protect`：默认，强制满足预算。

未知字段拒绝还是忽略应使用“拒绝项目配置、回退安全默认”的策略，避免拼写错误无声关闭保护。

## 15. 用户与 Agent 接口

保持接口小：一个命令族，不注册大量 slash command。

```text
/media status
/media explain
/media config
/media cache clear
/media compact
```

默认 `/media` 等同 `/media status`。

状态示例：

```text
Media Guard: yellow
Active: 5 images, 1.6 MiB serialized
Budget: 2.0 MiB, 8 blocks
Last projection: compressed 2, externalized 1, deduplicated 1
Provider payload: 3.9 MiB total
```

TUI footer只显示：

```text
media 1.6/2.0M · yellow
```

默认不注册 Agent 可调用的 `compact_now`。可选 `inspect_media_budget` tool 只返回分级摘要，不返回 Base64 或完整 JSONL，也不能放宽预算。

## 16. 隐私与安全

- 无网络 telemetry；
- 默认不持久化视觉描述；
- metrics 仅包含时间、hash 前缀、MIME、尺寸和字节，不含路径时可配置脱敏；
- 不记录完整 payload；
- 视觉描述 adapter 明确提示可能把图片发送给第二个模型/provider；首次启用要求用户显式配置；
- 项目配置仅在 trusted project 中读取；
- extension/package 拥有本机权限，README 必须说明；
- artifact 路径只作为本地引用，不自动暴露 HTTP URL。

## 17. 故障策略

| 故障 | 默认行为 |
|---|---|
| Codec 不可用 | 历史媒体 externalize；当前媒体若超限则明确移除并 warning，不原样超限发送 |
| 图片损坏 | Evidence Note 标记无法处理 |
| Describer 失败 | 不缓存失败，使用 deterministic placeholder |
| Provider adapter 不支持 | canonical context guard 继续生效，最终 payload 只审计 |
| Final payload 仍超限 | 支持 provider 执行 emergency projection；否则 warning + 记录诊断 |
| Compaction summary 失败 | 保持原 session，不写半成品 compaction |
| 配置损坏 | 使用安全默认并通知 |
| Cache 损坏 | 丢弃 cache，重新处理 |
| Extension 内部异常 | context handler 捕获并执行最小 emergency projection；不依赖 Pi 的“extension error 后继续”默认行为 |

## 18. 测试策略

### 18.1 纯模块测试

通过 `MediaGuard.project()` 这个接口测试：

- 0/1/多图；
- 4 张合计超限但单图合法；
- 重复图片；
- 当前工作集大于预算；
- codec 失败；
- description cache 命中/失败；
- historical externalization；
- exact boundary；
- Unicode Evidence Note；
- 图片/文本混合 tool result。

### 18.2 属性测试

随机生成消息树内容，验证：

- 输出媒体永不超过预算；
- 输入输出 tool IDs 完全一致；
- thinking/reasoning hash 完全一致；
- message role/order 不变；
- 相同输入和配置输出确定一致；
- 重复执行 projection 幂等。

### 18.3 Provider contract fixtures

为三种 payload adapter 保存脱敏 fixture：

- Anthropic Messages；
- OpenAI Responses；
- OpenAI Codex Responses。

验证只修改媒体 leaf，不修改 reasoning/tool structure。

### 18.4 Session 集成测试

- 创建真实 Pi JSONL fixture；
- resume 后发送短 prompt；
- branch/tree 后统计活跃路径而非整个文件；
- compaction 后旧媒体不再进入 active context；
- extension reload 后 cache 可重建；
- 与 `pi-vision-handoff` 和 `pi-image-paste` 的 load-order contract。

### 18.5 回归 fixture

用本次 session 的匿名尺寸/字节分布构造 fixture：

```text
1.82 MB + 0.74 MB + 1.21 MB + 2.80 MB Base64
```

断言 projection 后：

- 总媒体 ≤ 2 MiB；
- 当前四张仍有可用视觉输入，或明确 externalize 的数量和原因；
- provider payload 不再出现 6.57 MB 图片总量。

### 18.6 性能目标

- 全部 cache 命中时 projection < 10ms；
- 4 张 2K 图片首次压缩 < 2s；
- 不做 Base64 大字符串的多次无谓复制；
- cache 使用 LRU，默认最大 128 项或 256 MiB；
- 多图压缩有受限并发，默认 2。

## 19. 仓库结构

建议新建独立 GitHub repository：

```text
pi-media-guard/
├── README.md
├── LICENSE
├── SECURITY.md
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts
│   ├── media-guard.ts
│   ├── domain.ts
│   ├── policy.ts
│   ├── ledger.ts
│   ├── evidence-note.ts
│   ├── config.ts
│   ├── cache.ts
│   ├── codecs/
│   │   ├── pi-photon.ts
│   │   └── fake.ts
│   ├── describers/
│   │   ├── noop.ts
│   │   └── pi-vision.ts
│   └── providers/
│       ├── anthropic.ts
│       ├── openai-responses.ts
│       └── openai-codex.ts
├── skills/
│   └── media-safe-documents/
│       └── SKILL.md
├── test/
│   ├── media-guard.test.ts
│   ├── invariants.property.test.ts
│   ├── provider-contracts.test.ts
│   └── fixtures/
└── docs/
    ├── architecture.md
    ├── configuration.md
    ├── pdf-workflows.md
    └── compatibility.md
```

package manifest：

```json
{
  "name": "pi-media-guard",
  "version": "0.1.0",
  "license": "MIT",
  "keywords": ["pi-package", "pi", "llm", "image", "pdf", "context-window"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "pi": {
    "extensions": ["./dist/extension.js"],
    "skills": ["./skills"]
  }
}
```

运行依赖放 `dependencies`，Pi core 包放 `peerDependencies`。发布包中必须包含编译后的 `dist`、skill、README 和 license。

## 20. 发布方式

可以同时发布到 GitHub、npm 和 Pi 社区：

1. GitHub 创建公开仓库 `pi-media-guard`；
2. 使用 MIT license；
3. npm 发布 `pi-media-guard`；
4. `package.json` 加 `pi-package` keyword 和 `pi` manifest；
5. 用户安装：

```bash
pi install npm:pi-media-guard
```

或直接从 GitHub：

```bash
pi install git:github.com/<owner>/pi-media-guard@v0.1.0
```

Pi package gallery 会发现带 `pi-package` keyword 的 npm 包，可在 `pi.dev/packages` 展示；还可以在 Pi Discord 分享。没有必要把插件合并进 Pi 主仓库。

建议发布前提供：

- 30 秒演示 GIF/video；
- 本次四图故障的匿名 before/after；
- 支持 provider/version matrix；
- threat model；
- 与 `pi-image-paste`、`pi-vision-handoff`、`@okrapdf/pi`、`pi-docparser` 的差异说明；
- 明确第三方 package 拥有完整本机权限。

## 21. 实施阶段

### Phase 0：独立原型

- 复制匿名 session fixture；
- 实现 ledger + pure policy；
- 证明 6.57 MB → ≤ 2 MB；
- 不接 Pi UI，不发布。

### Phase 1：MVP `0.1.0`

- image-only canonical context guard；
- Pi codec；
- `/media status`；
- observe/optimize/protect；
- OpenAI Codex payload audit；
- 单元/属性测试；
- GitHub alpha。

### Phase 2：`0.2.0`

- input/tool_result ingest optimization；
- Anthropic/OpenAI final payload adapters；
- media-safe manual compaction；
- project/global config；
- npm 发布。

### Phase 3：`0.3.0`

- 可选 Vision describer；
- PDF tool detection 和配套 skill；
- auto-idle compaction；
- compatibility docs。

### Phase 4：`1.0.0`

- 多 provider 稳定矩阵；
- migration policy；
- fuzz/large-session soak tests；
- stable config schema；
- Pi gallery/community 宣布。

## 22. 验收标准

1. 本次四图回归 fixture 不超过 2 MiB 媒体预算；
2. 新旧 session、resume、tree、compaction 都不会破坏消息协议；
3. thinking/reasoning/tool IDs 逐字节保持；
4. 默认不发送额外网络请求；
5. 默认不永久修改用户 session；
6. codec/describer 失败时仍不会原样发送超预算媒体；
7. 支持 OpenAI Codex、OpenAI Responses、Anthropic Messages；
8. PDF workflow 不会建议一次内联全部页面；
9. 用户能通过一个 `/media` 命令理解当前状态和插件采取的动作；
10. npm tarball 包含可加载的 `dist/extension.js`；解包后可通过 `pi -ne -e <package-dir>` 验证，并可通过 `pi install npm:pi-media-guard` 安装；
11. README、license、security、privacy 和 provider compatibility 齐全；
12. 无 Base64/图片内容泄漏到日志。

## 23. 推荐决策

建议按方案 D 实施，并坚持以下产品定位：

> pi-media-guard is a deterministic request-media safety layer for Pi. It keeps multimodal sessions usable by enforcing aggregate media budgets, preserving the current working set, and externalizing older media without rewriting session history.

它不是图片粘贴 UI、不是 PDF parser、不是 vision proxy，也不是通用 compaction 插件。它只专注一个高价值 seam：**Pi session 到 provider request 之间的媒体安全投影**。
