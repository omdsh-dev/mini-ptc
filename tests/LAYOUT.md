# Test Layout

- `tests/help.test.ts` owns the pure catalog formatting and fuzzy matching
  rules.
- `tests/plugin.test.ts` owns the Loader export shape and configuration
  validation.
- `tests/integration.test.ts` mounts the production plugin with the real
  `dsh-system-prompt` and `dsh-tools` services on scoped Cordis contexts. It
  proves prompt narrowing, `help()` behavior, nested dispatch, the direct-call
  guard, custom transport names, and disposal.
- `tests/harness.ts` provides the shared real-Cordis mount;
  `tests/fake-runtime.ts` is the in-process `PtcRuntime` used only by tests.

No snapshot fixtures are used: the catalog and full-detail text are asserted
directly, and the integration suite uses deterministic fixture tools.

A deployed profile still needs the real `dsh-ptc-runtime-node` provider and the
agent preset selected in the Web GUI; that composition is the consuming host's
responsibility and is not reproduced by the unit harness.
