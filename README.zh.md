# @oh-my-dsh/mini-ptc

DeepSeek Harness 0.2.1-rc.2 的极简程序化工具调用（PTC）Agent 预设。

它不发送重复所有工具签名的 TypeScript SDK，而是只发送一个小传输工具（`run`）和一段 `help()` 介绍。模型编写 TypeScript 程序，`help()` 在运行时读取真实工具注册表。

## 它改变了什么

- **只暴露一个工具。** 系统提示词里的工具目录被替换为 `run` 一个 schema。
- **运行时发现。** 程序内可用 `help()`、`help("name")` 和 `tools.<name>(args)`；工具描述、参数和输出 schema 在调用时从注册表格式化；`run` 自身不在列表中，因为它不是程序内绑定。
- **提示词记忆。** 精确的 `help("name")` 还会把该工具的完整定义固定进系统提示词。每次成功压缩后，刚被压缩区间内使用次数最多的 5 个工具会默认写入提示词。
- **不再生成 SDK。** 本预设作用域内删除 `tools:sdk`、`tools:ptc-only` 以及各工具的 `tool:*`、`mcp:*` 说明段。
- **单一可调用面。** 作用域 guard 拒绝模型直接调用 `run` 之外的任何工具；程序内部的嵌套调用放行。

## 要求

- 由 Web/standard bundle 构建的 DSH profile。预设引用了 `dsh-tool-fs`、`dsh-tool-web`、`dsh-tool-bash` 等宿主包。
- `ctx.ptcRuntime`。base bundle 默认挂载的 `dsh-ptc-runtime-node` 必须提供 `typescript` + `function-body` 运行时。
- DSH 0.2.1-rc.2（`engines.dsh: >=0.2.1-rc.2 <0.3.0`）与 Node 24 或更新版本。

## 安装与启用

```sh
pnpm run build
pnpm pack --dry-run --json
dsh plugin --profile web add /absolute/path/to/oh-my-dsh-mini-ptc-0.1.0.tgz
```

在 Web GUI 的 **Agent 预设（Agent presets）** 中选择 **Mini PTC**，或将其设为默认。发行版默认仍是 `standard`。

## 工作原理

1. 预设把本插件与工具行一起挂载。`apply` 声明该作用域为 `native`，注册紧凑提示词段，收窄组装后的工具列表，并注册单调 guard。
2. 系统提示词 waterfall 删除该作用域的 `tools:*`、`tool:*`、`mcp:*` 段，把 `assembly.tools` 替换为单个 `run` schema。
3. `run` 用所有可见工具构造 `tools` 命名空间，再附加一个隐藏的 `help` 成员；程序顶部的 prelude 把它绑定为裸 `globalThis.help`，因此模型可以写 `await help()`。
4. 嵌套调用通过 `ctx.tools.execute` 回到原生管线，并把外层传输 token 作为 `parent`；审批、guard、超时和结果渲染都保持原生行为。调用串行执行；程序中止时会先排空队列再结算。
5. 运行时收到 `program = prelude + userCode`、调用会话的当前目录与常设 sandbox 策略（宿主提供 `workingDirectory`/`sandboxPolicy` 时）、中止信号和数值预算；传输层返回捕获日志、完成值和 sandbox 事实。

### help() 行为

| 调用 | 返回 |
| --- | --- |
| `help()` | 程序内可用的所有工具名，每行一个。 |
| `help("name")` | 精确匹配：完整描述、参数 JSON Schema、输出 JSON Schema，并固定进系统提示词。 |
| `help("拼错的名字")` | 最佳模糊匹配（前缀、子串、分词、子序列、编辑距离），输出 `name - 完整描述`。 |
| `help("nothing")` | 与 `help()` 相同的名称列表。 |

模糊匹配显示完整、归一化后的描述（不截断）；精确匹配保持原有的结构化详情。

`help()` 会打印并返回结果。通常直接 `await help()` 即可；如果程序还需要这段文本，可用 `console.log(await help(...))` 或直接返回。

### 提示词记忆

动态的 `mini-ptc:help` 段会携带一个 `## Included tool reference` 区块，内容是完整工具定义：

- **精确 help 固定。** `help("name")` 把该工具定义固定到会话结束；固定项按调用顺序累积并去重。
- **压缩后默认项。** 每次成功的 `compaction/end` 后，插件统计自上次压缩以来程序内的工具调用次数，把前 5 个写入同一区块；随后计数清零，下一次压缩替换默认项，已固定的项保留。

该段在下一次模型步骤组装。路由声明 `systemPromptUpdate: 'in-history'`（发行版 DeepSeek 适配器即是）时，变更后的提示词会追加到历史中，保留缓存前缀，而不是重写头部系统节点；不具备该能力的路由会重写头部。

提示词状态按存活会话保存在内存中；会话销毁或进程重启会丢失固定项与计数。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `toolName` | `run` | 唯一可直接调用的传输名；`run_code` 和 `help` 会被拒绝。 |
| `timeoutMs` | `120000` | 单次程序的默认经过时间预算。 |
| `maxTimeoutMs` | `600000` | 在运行时预算之前应用的部署上限。 |

在预设行的 `config` 中修改。工具 schema 的可选 `timeoutMs` 参数可按次覆盖默认值。

## 仓库结构

```text
src/
  index.ts      Loader 命名空间：name、inject、Config、apply
  config.ts     Schemastery schema 与直接调用默认值
  runtime.ts    作用域声明、提示词段、waterfall、guard、工具
  transport.ts  run 工具、prelude、运行时生命周期
  bindings.ts   tools 命名空间、隐藏 help 成员、串行分发
  help.ts       纯 help 格式化与模糊匹配
  prompt.ts     紧凑介绍与已包含工具引用
  prompt-state.ts  逐会话固定项与压缩后前五
tests/
  help.test.ts         目录与匹配规则
  plugin.test.ts       Loader 形状与配置
  prompt-state.test.ts 固定项、计数与前五排名
  integration.test.ts  真实 Cordis、工具注册表、提示词组装、执行
  harness.ts           带 fake PTC runtime 的共享挂载
  fake-runtime.ts      仅供测试的进程内 runtime
```

## 开发

```sh
pnpm install
pnpm run lint
pnpm test
pnpm run build
pnpm pack --dry-run --json
```

测试使用真实的 `dsh-system-prompt`、`dsh-tools` 服务和 scoped Cordis 上下文挂载生产插件；runtime 使用进程内 fake，因此无需密钥且速度快。真实部署中的 `dsh-ptc-runtime-node` 是目标 runtime，不是测试依赖。

在阻止子进程管道的受限宿主上，可运行 `vitest run --pool=threads`。Vite 的 Windows 配置打包器可能还需要跳过 `net use` 探测；该绕行属于环境细节，不属于本包。

## 已知限制

- **仅支持 TypeScript function-body。** `repl` 或 persistent-in-memory runtime 会在挂载时被拒绝。
- **嵌套调用串行。** `Promise.all` 仍可用，但不会重叠执行工具。
- **嵌套调用不写入会话事件。** 模型历史只保留外层 `run` 结果；注册表仍能观测每次嵌套调用。
- **移除了工具指导。** 本预设以 `help()` 返回的描述和 JSON Schema 作为工具文档；工具插件拥有的逐工具指导段在该作用域被删除。
- **依赖宿主包。** 没有 Web/standard 工具包的裸 profile 无法直接使用该预设。
- **不打宿主补丁。** `dsh-tools` 保留了 `run_code`，因此传输默认命名为 `run`；插件只使用公开的注册表与系统提示词服务。
- **提示词记忆在内存中。** 固定项与调用计数随进程存活；重启或会话销毁会丢失。
- **in-history 依赖路由能力。** 只有已准备路由声明 `systemPromptUpdate: 'in-history'` 时才追加到历史；否则重写头部系统节点。
- **精确固定项没有上限。** 固定很多工具会持续增长系统提示词，直到会话结束；只有压缩后的前 5 个有上限。

## 许可证

BSD-3-Clause。
