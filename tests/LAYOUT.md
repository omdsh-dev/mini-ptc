# Test Layout

- `tests/help.test.ts` owns the pure catalog formatting and fuzzy matching
  rules.
- `tests/plugin.test.ts` owns the Loader export shape and configuration
  validation.
- `tests/prompt-state.test.ts` owns the per-session pin store, usage counting,
  first-help tracking, featured-tool ranking, and scope-to-session resolution.
- `tests/first-run.test.ts` owns first-program discovery exclusivity,
  transactional commit, and the no-help/failed-discovery cases.
- `tests/integration.test.ts` mounts the production plugin with the real
  `dsh-system-prompt` and `dsh-tools` services on scoped Cordis contexts. It
  proves prompt narrowing, `help()` behavior, exact-help pinning, the
  post-compaction top-five prompt update, nested dispatch, the direct-call
  guard, custom transport names, and disposal.
- `tests/harness.ts` provides the shared real-Cordis mount, an agent-shaped fake
  session, help priming (disabled by `primeHelp: false`), and a synthetic
  `compaction/end` event; `tests/fake-runtime.ts` is the in-process `PtcRuntime`
  used only by tests.

No snapshot fixtures are used: the catalog and full-detail text are asserted
directly, and the integration suite uses deterministic fixture tools.

A deployed profile still needs the real `dsh-ptc-runtime-node` provider and the
agent preset selected in the Web GUI; that composition is the consuming host's
responsibility and is not reproduced by the unit harness.
