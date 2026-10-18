# mini-ptc Contributor Notes

This repository is a standalone DeepSeek Harness agent-preset bundle: a small
PTC transport plus the preset that composes it.

- Read `docs/dsh-plugin-contracts.md` before changing package metadata,
  dependencies, display resources, lifecycle, client behavior, or distribution.
- Start with `.agents/skills/dsh-plugin-development/SKILL.md`; stage skills
  live under `.agents/skills/`.
- Keep the function-plugin named exports `name`, `inject`, `Config`, and
  `apply`; never add a default export.
- Own every registration with the plugin fiber and prove disposal. The
  transport, prompt section, waterfall, guard, and scope declaration all lift
  when the preset fiber disposes.
- Keep `engines.dsh`, `engines.node`, `dsh.manifestVersion`,
  `dsh.bundle.patch`, `exports`, `files`, and the exported display assets
  synchronized with the package.
- `cordis.patch.yml` inserts the `mini-ptc` agent preset and names the host
  packages it assumes. Keep that list aligned with the standard Web agent
  plane; the preset is not intended for a bare profile.
- The host PTC transport name `run_code` is reserved. The mini transport is
  `run` by default and is configurable only to another non-reserved name.
- Run `pnpm run lint`, `pnpm test`, and `pnpm run build` before publishing.
- Do not commit, push, publish, tag, or change remotes without direct user
  authority.
