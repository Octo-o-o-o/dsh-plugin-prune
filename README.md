# dsh-plugin-prune

**Prune dead plugins in DeepSeek Harness** — measures the *real* usage of every
plugin's tools and skills (calls, error rate, latency, cross-session use) plus
your value ratings, and flags the plugins you can safely remove.

[中文说明](./README.zh.md)

## What it does

This is a **pure observer plugin**: it registers no model tools and modifies no
business state. It:

- Listens to `tools/execute` + `tools/result` and aggregates, per tool and per
  skill, the number of calls, error count, total/average dispatch duration,
  rendered output size, distinct using sessions, and per-day call counts
  (rolling 90-day window).
- Adds a **「插件体检 / Plugin Health」** tab inside *Settings → Plugins* with:
  - a **plugin overview table** joined with the shipped plugin inventory
    (`pluginInventory` Remote): status (ok/disabled/failed), contributed tool
    counts and real call statistics per installed plugin — flagging the
    never-used / failed / marked-useless ones, i.e. the direct answer to
    "which plugins can I remove";
  - a **tool/skill detail table**: calls, 7-day activity, error rate, average
    latency, last use, sessions, output size, machine suggestions
    (**never called — likely a dead plugin, consider removing** / high error
    rate / marked useless / active and reliable), and a one-click
    **Useful / Neutral / Useless** value rating per row.
- Persists the statistics as JSON at `$DSH_HOME/dsh-plugin-prune.json`
  (falls back to `~/.dsh/dsh-plugin-prune.json`), so counts accumulate across
  restarts.

> Note: statistics are only collected **while the plugin is installed and
> running**; past usage cannot be reconstructed.

## Installation

```sh
# from npm
dsh plugin --profile web add dsh-plugin-prune

# from a git checkout
dsh plugin --profile web add github:<your-org>/dsh-plugin-prune
```

Restart `dsh web` and open *Settings → Plugins → Plugin Health*.

Compatibility: `dsh >= 0.1.0-rc.5`, Node `^22.19 || >=24`, web profile.
`engines.dsh` gates installation on older deployments.

## Configuration (optional)

The patch row accepts optional config:

```yaml
- id: plugin-prune
  name: 'dsh-plugin-prune'
  config:
    debounceMs: 2000   # persist debounce (>= 100)
    keepDays: 90       # per-day count window (>= 7)
    dataPath: ''       # absolute file override; empty = $DSH_HOME default
```

## Honest limitations

- DeepSeek Harness exposes **no first-class tool → plugin provenance**. The
  “source plugin” column is best-effort: a static catalog for shipped official
  tools, stack-frame attribution for tools registered while this plugin runs,
  and a small table for well-known third-party tools. Anything else shows
  「未知来源」 — the per-tool statistics themselves are always exact.
- UI-only plugins (themes, skins, layout tweaks) emit no tool calls, so they
  cannot be measured automatically. The value of such plugins remains a manual
  judgement.
- “Safe to remove” combines objective signals (frequency, error rate, latency,
  cross-session use) with your own rating; use both before uninstalling.

## Privacy & security

- Everything stays **on your machine**: the stats file contains tool names,
  counters, timestamps and your ratings. Nothing is sent anywhere.
- Like every dsh plugin, this package is **host code**: review it before
  installing (it is small: ~800 lines total, no runtime dependencies beyond
  the dsh platform packages), and pin a version or commit.

## Development

```sh
pnpm install
pnpm run check      # typecheck (host + client) and build
```

Layout: `src/index.ts` (host service) → `lib/`; `src/client/` → the
`__ModuleLoader__` factory bundle at `client/client.js`. `cordis.patch.yml`
inserts the host row; `scripts/preflight.mjs` guards the package-name wiring.

## Publishing to other users

1. **npm**

   ```sh
   npm publish --access public
   ```

   `prepare` builds on git installs; `prepack` runs the full check plus
   preflight. Publish a version only after `pnpm run check` passes.

2. **GitHub** — push the repository and add the topic **`dsh-plugin`** so
   `dsh-find-plugin` and the community directories can discover it.

3. **awesome-dsh-plugin.com** — submit the package to the community curated
   directory so the marketplace surfaces it.

4. **Changelog & tags** — tag releases (`v0.1.0`); the marketplace and users
   alike prefer pinned versions over `latest`.

## License

MIT
