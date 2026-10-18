# mini-ptc

A minimal programmatic-tool-calling agent preset for DeepSeek Harness 0.2.1-rc.2.

Instead of sending a generated TypeScript SDK that repeats every tool signature, mini-ptc sends one small transport tool (`run`) and a short introduction to a runtime `help()` function. The model writes a TypeScript program; `help()` reads the live tool registry through the host PTC runtime.

## What it changes

- **One model-facing tool.** The tool catalog in the system prompt is replaced by just the `run` schema.
- **Runtime discovery.** The program gets bare `help()`, `help("name")`, and `tools.<name>(args)`. Tool descriptions, parameters, and output schemas are formatted from the registry at call time; `run` itself is excluded because it is not a program binding.
- **No generated SDK.** The `tools:sdk` and `tools:ptc-only` prompt sections, plus per-tool `tool:*` and `mcp:*` guidance sections, are removed for this preset's agents.
- **One callable surface.** A scoped guard denies direct model calls to every tool except `run`. Nested calls dispatched by the program are allowed.

## Requirements

- A DSH profile built from the Web/standard bundle. The preset references host packages such as `dsh-tool-fs`, `dsh-tool-web`, and `dsh-tool-bash`.
- `ctx.ptcRuntime`. The released `dsh-ptc-runtime-node` provider is mounted by the base bundle and must expose a `typescript` `function-body` runtime.
- DSH 0.2.1-rc.2 (`engines.dsh: >=0.2.1-rc.2 <0.3.0`) and Node 24 or newer.

## Install and activate

```sh
pnpm run build
pnpm pack --dry-run --json
dsh plugin --profile web add /absolute/path/to/mini-ptc-0.1.0.tgz
```

Then open **Agent presets** in the Web GUI and choose **Mini PTC** for the session, or set it as the default. The shipped default remains `standard`.

## How it works

1. The preset mounts this plugin beside its tool rows. `apply` declares the scope `native`, registers the compact prompt section, narrows the assembled tool list to the transport, and registers a monotonic guard.
2. The system-prompt waterfall drops `tools:*`, `tool:*`, and `mcp:*` sections for this scope and replaces `assembly.tools` with the single `run` schema.
3. `run` builds a `tools` namespace from every visible tool plus a hidden `help` member. A prelude installed at the top of the program binds a bare `globalThis.help` to that member, so the model can write `await help()`.
4. Nested calls go back through `ctx.tools.execute` with the enclosing transport token as `parent`, so pre-execute policies, approvals, guards, timeouts, and result rendering stay on the native pipeline. Calls are serialized; an aborted program drains its queue before the tool settles.
5. The runtime receives `program = prelude + userCode`, the calling session's current directory and standing sandbox policy (when the host provides `workingDirectory`/`sandboxPolicy`), an abort signal, and a numeric budget. The transport reports captured logs, the completion value, and the runtime sandbox fact.

### help() behavior

| Call | Response |
| --- | --- |
| `help()` | Every tool name available inside the program, one per line. |
| `help("name")` | Exact name match: full description, parameter JSON Schema, and output JSON Schema. |
| `help("mispelled")` | Best fuzzy match (prefix, substring, token, subsequence, edit distance) as `name - full description`. |
| `help("nothing")` | The same name list returned by `help()`. |

Fuzzy results show the full, normalized description (never truncated); exact results keep the structured detail.

`help()` prints the response and returns it. Use `await help()` by itself for normal discovery; use `console.log(await help(...))` or return it when the program needs the text again.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `toolName` | `run` | The single directly callable transport name. `run_code` and `help` are rejected. |
| `timeoutMs` | `120000` | Default elapsed-time budget for one program. |
| `maxTimeoutMs` | `600000` | Deployment cap applied before the runtime budget. |

Change these in the preset row's `config`. The tool schema's optional `timeoutMs` argument overrides the default per call.

## Repository layout

```text
src/
  index.ts      Loader namespace: name, inject, Config, apply
  config.ts     Schemastery schema and direct-call defaults
  runtime.ts    Scope declarations, prompt section, waterfall, guard, tool
  transport.ts  run tool, bindings, prelude, runtime lifecycle
  help.ts       Pure help formatting and fuzzy matching
  prompt.ts     Compact help introduction
tests/
  help.test.ts        Catalog and matching rules
  plugin.test.ts      Loader shape and configuration
  integration.test.ts Real Cordis, tool registry, prompt assembly, execution
  harness.ts          Shared mount with the fake PTC runtime
  fake-runtime.ts     In-process runtime used only by tests
```

## Development

```sh
pnpm install
pnpm run lint
pnpm test
pnpm run build
pnpm pack --dry-run --json
```

Tests mount the production plugin with the real `dsh-system-prompt` and `dsh-tools` services and scoped Cordis contexts. They use an in-process fake runtime so the suite is keyless and fast; the sandboxed `dsh-ptc-runtime-node` provider is the runtime this package targets in a deployed profile, not a test dependency.

On restricted hosts that block child-process pipes, run `vitest run --pool=threads`. Vite's Windows config bundler may also need its `net use` probe skipped; that workaround is environment-specific and is not part of this package.

## Known limitations

- **TypeScript function-body only.** A `repl` or persistent-in-memory runtime is rejected at mount.
- **Nested calls are serialized.** `Promise.all` still works but does not overlap tool execution.
- **Nested calls are not replayed as session events.** Only the outer `run` result is recorded in model history; the registry still observes each nested call.
- **Tool guidance is removed.** The preset keeps `help()` descriptions and JSON Schemas as the tool documentation. The per-tool guidance sections owned by tool plugins are dropped for this scope.
- **Host packages are assumed.** The preset is not portable to a bare profile without the Web/standard tool packages.
- **No host patch.** `run_code` is reserved by `dsh-tools`, so the transport is named `run` by default; the plugin uses only public registry and system-prompt services.

## License

BSD-3-Clause.
