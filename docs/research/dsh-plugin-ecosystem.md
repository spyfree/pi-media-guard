# DSH(DeepSeek Harness)媒体守卫插件调研

日期:2026-08-17。方法:对 `deepseek-ai/deepseek-harness` 源码(commit 47f94385,2026-08-13)逐条核验、
npm registry 全量关键词排查、awesome-dsh-plugin 中英文全表扫描(1,116 插件)、生态规模数据核实,
以及一轮以"推翻空白结论"为目标的对抗性复核。所有 `file:line` 引用均指 DSH monorepo 当时的 HEAD。

## 结论(TL;DR)

**值得单独开发。** 结论与此前一份调研一致,但依据更新为源码级证据,且有三处关键修正:

1. **空白是真的,但要收窄表述。** DSH core *已有*逐消息聚合准入限制(默认 20 张 / 100 MB per
   message,超限硬拒)。真正的空白是:**跨轮次整请求的聚合媒体预算 + 公平份额压缩(而非硬拒)+
   Evidence Note 外部化 + 逐图账本**,面向视觉能力路由。1,116 个精选插件中没有任何一个做这件事。
2. **不需要上游 PR 就能做 M0。** 此前调研认为"唯一干净路径是给官方提 `ctx.mediaProjector` seam
   PR"。源码证据推翻了这一点:`llm/stream` waterfall 能拿到完整的出站请求(含 messages),
   短路重派发投影副本是仓库内外都已验证的模式。上游 seam PR 降级为后续硬化项,不是前置条件。
3. **DSH 的病理确认存在、且比 Pi 更重。** `toPiContextWithImages` 每次请求对全部历史图片做
   无缓存磁盘重读 + 全量 sha256 重校验 + 重新 base64;compaction 遇到图片直接抛错;spill 只处理
   文本。多轮多图会话在 DSH 上没有任何泄压阀。

## 1. DSH 与生态规模(2026-08-17 实测数据)

| 项目 | 数据 | 来源 |
| --- | --- | --- |
| deepseek-ai/deepseek-harness | 135,048 stars / 13,593 forks,MIT,"Everything is a Plugin" | GitHub(exa 抓取) |
| 当前版本 | `@deepseek-ai/dsh` 0.1.0-rc.6(2026-08-13),**developer preview,官方声明预期破坏性变更** | npm |
| GitHub topic `dsh-plugin` | 4,731 仓库(此前调研称 2600+,已过时偏低;注意有蹭标签水分,见 §7) | github.com/topics |
| awesome-dsh-plugin 精选列表 | 1,116 插件,14 个板块;Vision & Multimodal 板块 44 个 | count.json + 全文扫描 |
| npm `keywords:dsh-plugin` | 1,047 包,近 1–2 天内仍在密集发布 | registry 搜索 API |
| dsh-market(npm `dshmarket`) | v1.10.1,~11.8k 周下载,awesome 列表标注"Recommended" | npm |

分发格局确认:**没有单一官方插件注册表**。实际三条腿:
(a) GitHub 仓库打 `dsh-plugin` topic(官方 README 明示,市场每 2 小时自动抓取);
(b) npm 发布,官方 CLI 安装——注意实际命令是 **`dsh plugin --profile <name> add <包名>`**
(`--profile` 是 requiredOption,`apps/cli/src/args.ts:171-181`),裸 `dsh plugin add` 会报错;
(c) 精选收录:awesome-dsh-plugin(PR 提交 `data/plugins/<owner>__<repo>.yml`,要求仓库 ≥1 天、
≥10 commits、打 topic、package.json 声明 `dsh.bundle` manifest)与两个市场
(`dsh-market/dsh-market`;`bradeGithub/DSH-Plugins-Marketplace`,其 `STANDARD.md` 是事实上的
收录识别规范)。`dsh-external/hub` 确认不存在(org 与 repo 均查无)。

插件自描述约定:package.json 里的 `dsh.bundle`(`{"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}`,
CLI 按 `manifest.dsh?.bundle?.patch` 识别并激活,`apps/cli/src/plugin.ts:36-45`)和 `dsh.client`
(web UI 注入)。此前调研的"0.4.1 引入 dsh.bundle"说法有误——DSH 现在才 0.1.0-rc。

## 2. 对此前调研的逐条核验

| 声明 | 结论 | 关键证据 |
| --- | --- | --- |
| DSH 只有单图准入限制,无聚合预算 | **部分成立** | `ImageAttachmentLimits` 除单图外还有 per-message 聚合:`maxImagesPerMessage`/`maxMessageImageBytes`(默认 20 张 / 100 MB,`attachment-local/src/index.ts:15-21`),apiproxy 准入时硬拒(`api-proxy.ts:156-166`)。但**整请求跨轮次**层面确实无任何预算/驱逐 |
| `toPiContextWithImages` 每请求全量重读历史图并 base64 | **确认** | 函数确实叫这个名字,`packages/llm/llm-pi-ai/src/context.ts:143`;逐图 `attachments.readImage` + base64(`context.ts:40-45`);store 每次读都无缓存 fs 读取 + 全量 sha256 重校验(`store.ts:204-231`) |
| 附件 ref 即 sha256,dedup 零成本 | **确认,且更优** | `sha256:<hex>` 内容寻址(`store.ts:19,139,190`);`ImageBlock` 的 ref 直接携带 `bytes/width/height`(`llm/src/types.ts:71-75`)——**预算核算阶段可以完全不读字节** |
| sharp 已在依赖里,插件可直接用 | **部分成立** | sharp ^0.35.3 只是 `dsh-attachment-local` 的依赖(默认 bundle 会装),且只用于校验/探测,无任何 resize/重编码调用。pnpm 不 hoist,**插件必须自带 sharp 依赖** |
| `agent/request` 不带消息、`agent/pre-step` 写历史,均不可用 | **前提对,结论错** | 两个前提均确认(`runtime-types.ts:231,244`)。但漏了 `llm/stream` waterfall——见 §4,这推翻了下一条 |
| 唯一干净路径是上游 `ctx.mediaProjector` seam PR | **被推翻(部分)** | `llm/stream` 短路重派发机制上可行且有先例;上游 seam 仍是架构上更正统的路径,但不是前置条件。"~20 行"的估计也偏乐观 |
| 官方命令 `dsh plugin add` | **部分成立** | 存在但必须带 `--profile <name>`;本质是把 add/remove 等参数原样转发给 profile 目录内的 pnpm(`apps/cli/src/plugin.ts:120-158`) |
| topic 2600+ 仓库 | **确认(已涨到 4,731)** | 见 §1;有水分,精选口径 1,116 |
| `dsh-agent-budget` 是最接近的(token 预算) | **修正** | awesome 列表确有 `vibeinging/dsh-agent-budget` 条目(token 预算,非媒体),但该名字**并未发布到 npm** |
| `dsh-external/hub` 不存在 | **确认** | org/repo 均查无 |
| `opencode-media-guard` / `obsidian-media-claim` 是别的生态的类似物 | **确认** | 前者(keefetang)是 OpenCode 的图片限额守卫:准入拦截 + 预算 + 落盘外部化,**无压缩无投影**;后者是 OpenClaw 的媒体暂存插件,与预算无关 |
| `huguanyu666/dsh-store` 等社区插件用官方命令安装 | **确认(拼写修正)** | 实际是 `huguangyu666/dsh-store`;`TecFancy/dsh-auth-gate`、`itr-del/dsh-feishu` 均存在且文档写明官方 CLI 安装路径 |

## 3. 竞品与空白验证

对抗性复核(中英文关键词全量排查 npm + awesome 全表 + web 搜索 + DSH 源码)**未能找到全重叠竞品**:
没有任何 DSH 插件同时做聚合整请求媒体预算、请求时公平份额压缩、预算驱动的附件外部化。
`dsh-media-guard` 这个 npm 名未被占用。

但每条"胳膊"在生态里都有部分重叠的先行者,定位时必须知道:

| 插件 | 重叠点 | 与本方案的差距 |
| --- | --- | --- |
| `GXX182/dsh-vision-bridge` | **最接近**:有 `maxTotalImageBytes` 聚合限制,且实践了"只改 provider 请求副本、durable log 保留原件"的投影原则 | scope 是 text-only→Gemini 视觉桥接;无压缩 |
| `good-boy4069/dsh-vision-guard` | 双门守卫,Gate 2 就是 `llm/stream` 请求时后备重写(治 400 死锁),有每日 OCR 预算 + LRU | 面向 text-only 路由,重写成 OCR 文本;无字节核算无压缩 |
| `Favio8/dsh-plugin-deepeye` | 请求时图片降采样(maxImageDimension 1536)+ JPEG 重压缩省 token,挂 `llm/stream` | 只作用于视觉转写路径,不管视觉路由上保留的原图 |
| `Flyvhidbwo/dsh-vision-proxy` | sharp 自动降采样(>4M 像素)+ sha256 dedup 缓存 | 目的是给文本模型接视觉,非预算执行 |
| `Johnny-xuan/dsh-paste-to-path`、`PicGo/dsh-plugin` | 外部化(粘贴转路径 / 上传图床) | 入口时/手动触发,非请求时自动守卫;无预算 |
| `ruby1304/dsh-vision-subagent` | 图片字节隔离在子 agent 上下文外 | 媒体驱逐,无压缩无整请求预算 |
| `JohnXu22786/context-pruner` | 走官方 `ctx.compaction` seam 的确定性超额裁剪 + 审计报告 | 只处理文本 tool result,不碰图片块 |
| `@deepseek-ai/dsh-output-retention`(第一方) | "有界保留 + 保留了什么的通告"原语,机制上与预算+Evidence Note 同构 | 文本 tool output 专用 |
| `keefetang/opencode-media-guard`(OpenCode 生态) | 同生态位的完整实现,证明需求真实存在 | 准入拦截型(无压缩、无确定性投影),且装不进 DSH |

Vision & Multimodal 板块 44 个插件的构成:约 36 个视觉桥接/OCR("给文本模型接眼睛"),约 7 个图像
生成/截图采集,1 个本地降采样只为转文本网格阅读(`jing-hy/picturereader`)。该家族已经占住
**text-only 模型侧**的问题;dsh-media-guard 的独占领地是**视觉能力路由上的聚合预算与压缩**,
两者互补不竞争(共存策略见 §7)。

另一个此前调研没发现的事实:**`pi2dsh`**(npm)是让未修改的 Pi 扩展包直接跑在 DSH 上的兼容桥
(vendor 了 202 个 pi-coding-agent 符号)。理论上 `dsh plugin --profile ... add pi-media-guard`
今天就能试。但其文档明确把 provider payload 拦截列为"不提供,应写成 DSH llm adapter",
pi-media-guard 也不在其验证支持名单里——`context` 钩子路径是否被桥接未验证。
**行动项:花 30 分钟实测 pi2dsh + pi-media-guard**;无论结果如何都值得写进新仓库 README 的定位
说明(大概率结论:桥接跑不满安全模型,需要原生移植)。

## 4. 技术可行性:挂钩点(本次调研最重要的修正)

DSH 的事件词表集中声明在 `packages/core/agent/src/runtime-types.ts:146-291`,waterfall 全集:
`agent/pre-step`、`agent/request`、`agent/request-error`、`tools/pre-execute`、`tools/execute`、
`tools/post-execute`、`llm/stream`、`system-prompt/assemble`。

- `agent/pre-step`:只带本 step 的 inbox 消息(非全历史),且进入的消息会被 durable append 到
  session(`agent-loop/src/agent.ts:282-284`)——确认不可用作请求时投影。
- `agent/request`:只产出 `LlmCallConfig`,文档明言"cannot mutate messages"——确认不可用。
- **`llm/stream`(`packages/llm/llm/src/index.ts:52-64`,dispatch 于 `:921-927`):可用。**
  它收到完整 `GenerateOptions`(含 messages),且此时图片仍是 `ImageBlock` 附件 ref
  (字节只在 adapter 内部才解析)——**预算核算阶段零字节成本**。请求对象 deep-frozen 不可原地改,
  但 listener 可以短路:构造投影副本后 `return ctx.llm.stream(projectedCopy)`;副本不在
  `AGENT_LOOP_REQUESTS` WeakSet 里(`call-config.ts:66-78`),递归自然终止,durable 历史零接触。
  先例:仓库内 `dsh-llm-replay` 测试中间件、社区 `dsh-vision-guard` Gate 2、`GXX182/dsh-vision-bridge`
  都是这个模式。

两个诚实的注脚:
(1) `llm/stream` 文档契约写着 listener "read it, never rewrite it"(reconstructability 不变量,
`index.ts:56-61`)——短路重派发在机制上合法、在文档精神上是灰色地带;
(2) 重派发副本会丢失 `PreparedLlmCall` 注册绑定(`index.ts:800-813`)。
因此:**M0/M1 用 `llm/stream` 短路落地,不阻塞;上游 PR(在 `toPiContext`/`buildRequest` 处加
sanctioned 投影 seam)作为 M2 硬化项**,让插件从灰色模式切换到正统 seam。这与此前调研的
"先提 PR 才能做"路线相反,把上游合并周期从关键路径上拿掉了。

压缩产物的落地方式也已验证:插件用 `ctx.attachments.saveImage` 存入压缩变体拿到新的内容寻址
ref;`readImage` 每次读都全量重校验且无缓存,所以插件自己以原图 sha256 为 key 缓存压缩变体
既必要又免费。

## 5. pi-media-guard 可移植性

本仓库的核心管线(`ledger.ts`、`policy.ts`、`media-guard.ts`、`evidence-note.ts`、`config.ts`、
`emergency.ts`)除消息类型 import 外全部 host-agnostic,可直接复用的还有:
四图回归 fixture(1.82+0.74+1.21+2.80 MB = 6,567,972 Base64 字节)、fast-check 性质测试
(预算永不超、tool ID/thinking 逐字节保留、确定性/幂等)、truncatingCodec 测试替身、
"永不静默回退到超大原件"的两级失败策略(`emergency.ts`)、公平份额除以 keepable 唯一图数、
重复图也压缩以保持 hash 可折叠、压缩并发 2 + 10s 超时。

需要替换的 Pi 特有件:钩子接线(`context`/`before_provider_request` → `llm/stream` 短路)、
codec(Pi 的 `resizeImage` → 自带 sharp)、消息 schema 映射(**重大差异**:Pi 图片块是平铺
base64 `{type:'image',data,mimeType}`,DSH 是附件 ref——账本构建从"解码算哈希"变成"直接读
ref 的 sha256 与 bytes 元数据",更便宜)、provider profile 词表(DSH 路由标识)、配置路径
(`~/.pi/agent/...` → DSH 约定)、OpenAI Codex 载荷审计(要么砍掉,要么按 DeepSeek 的
chat-completions wire 格式 `{type:'image_url',image_url:{url}}` 重写适配器)。

## 6. 值不值得做:判断

**做。** 理由按权重排:

1. **病理真实且无解药**:DSH 把全部历史图片每请求重读重发,聚合超限时用户只会撞
   `IMAGES_TOO_LARGE` 硬拒或 provider 400,compaction 不能碰图、spill 不收图——
   与 pi-media-guard 的创立事故一模一样,且缺口更大。
2. **空白经对抗性复核仍成立**:1,116 精选插件 + 1,047 npm 包里没有全重叠竞品;
   OpenCode 生态的同类物证明需求可迁移。
3. **技术路径比预想的短**:不需要等上游 PR;核心管线现成;DSH 的 ref 模型让观察/预算阶段
   零字节成本,比 Pi 版还干净。
4. **生态窗口**:135k stars、几天内 1,000+ 插件的爆发期,市场每 2 小时自动抓 topic,
   先occupied生态位的成本从未这么低。

## 7. 风险与对策

- **API 不稳定**(最大风险):DSH 是 0.1.0-rc developer preview,官方明言会破坏性变更。
  对策:peerDependency 收紧到已验证 rc 区间;host 接触面收敛到一个 adapter 文件;
  上游 seam PR 成功后切换到 sanctioned 接口。
- **`llm/stream` 契约灰色地带**:见 §4 注脚。对策:observe 模式完全只读(零争议),
  protect 模式的短路重派发在 README 里如实披露,并把 seam PR 作为路线图公开项。
- **多插件在同一 waterfall 上动图片**(vision bridges 同场):顺序不保证,可能互相踩。
  对策:默认跳过已被识别为桥接产物的文本标记块;文档声明与主流 bridge 的共存测试矩阵;
  这与 Pi 版 design.md §11 的"没有绝对最后 handler"是同一个问题,payload 级审计留作后手。
- **topic 数字水分**:营销与文档引用精选口径(1,116)而非 topic 口径(4,731),
  STANDARD.md 已记载蹭标签案例,引用后者会损伤可信度。

## 8. 落地建议

- **独立仓库 `dsh-media-guard`**(npm 名未被占用),MIT,与 pi-media-guard 同作者同风格;
  package.json 声明 `dsh.bundle` manifest + `dsh-plugin` keyword,仓库打 `dsh-plugin` topic。
- 安装文档写清真实命令:`dsh plugin --profile <name> add dsh-media-guard`。
- 里程碑修订(相对此前调研的方案):
  - **M-1(半小时)**:pi2dsh 实测 pi-media-guard,结论进 README。
  - **M0**:纯插件原型,`llm/stream` 短路 + observe 模式;移植四图 fixture 在真 DSH profile
    上跑通(不需要任何上游改动)。
  - **M1**:protect 模式——按 ref 元数据核算 → fair-share 压缩(自带 sharp,变体经
    `saveImage` 入库,按原图 sha256 缓存)→ Evidence Note 外部化;移植 property tests。
  - **M2**:上游 sanctioned seam PR;vision-bridge 共存矩阵;(可选)DeepSeek wire 载荷审计。
  - **M3**:provider profiles、`/media` 等价命令与状态面、awesome-dsh-plugin/dsh-market 收录
    (满足 ≥1 天、≥10 commits、topic、manifest 四条件后提 PR)。

## 附录:验证方法与数据源

- DSH 源码:`https://github.com/deepseek-ai/deepseek-harness` 浅克隆,HEAD 47f94385(2026-08-13),
  monorepo `@deepseek-ai/dsh-root` 0.1.0-rc.5;全部技术声明按 file:line 核验。
- npm registry 搜索 API:~20 组中英文关键词(media/image/guard/budget/compress/attachment/
  压缩/图片/媒体/图床 等)+ 精确包名存在性检查。
- awesome-dsh-plugin:中英文 README 全文(raw.githubusercontent),1,116 插件逐板块扫描,
  中英文为同一生成目录的平行翻译(无中文独有板块)。
- 生态页面:github.com/topics/dsh-plugin、dsh-market、DSH-Plugins-Marketplace/STANDARD.md
  (经服务端抓取);awesome-dsh-plugin.com/count.json。
- 对抗性复核:独立 agent 以"找到现成竞品推翻空白结论"为目标做发散搜索,结论:全重叠竞品不存在,
  部分重叠清单见 §3。
