/**
 * Plugin-level overview: joins the usage report with the shipped plugin
 * inventory Remote so the panel can answer the real question — which
 * installed plugins can be removed. Pure functions; unit-tested through the
 * client bundle exports.
 * @module dsh-plugin-prune/client/overview
 */

import type { UsageEntry, UsageReport } from '../types.ts'

/** Structural view of the shipped `pluginInventory.list()` result. */
export interface InventoryEntryLike {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string | null
}

export interface InventorySnapshotLike {
  readonly entries: readonly InventoryEntryLike[]
}

/** One aggregated row of the plugin overview table. */
export interface PluginRow {
  readonly plugin: string
  readonly status: 'ok' | 'disabled' | 'failed'
  readonly registeredTools: number
  readonly usedTools: number
  readonly calls: number
  readonly errors: number
  readonly lastSeenAt: string | null
  readonly ratedUseless: boolean
  readonly suspicious: boolean
  readonly suggestion: { text: string, warn: boolean }
}

const SKILL_PLUGIN_LABEL = 'skills'
const UNKNOWN_LABEL = '未知来源'

function last7Days(entry: UsageEntry): number {
  const now = new Date()
  let total = 0
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(now.getTime() - offset * 86400000).toISOString().slice(0, 10)
    total += entry.daily[day] ?? 0
  }
  return total
}

export { last7Days }

export interface OverviewLocale {
  statusOk: string
  statusDisabled: string
  statusFailed: string
  sFailed: string
  sDisabled: string
  sNever: string
  sMarked: string
  sActive: string
}

/**
 * Build the plugin overview from the usage report and the inventory snapshot.
 * Every inventory entry appears (so never-used plugins are visible); usage
 * entries whose plugin label matches no inventory module are grouped under
 * the unknown label.
 */
export function buildPluginRows(
  report: UsageReport,
  snapshot: InventorySnapshotLike | null,
  locale: OverviewLocale,
): PluginRow[] {
  const toolsByPlugin = new Map<string, number>()
  const usedByPlugin = new Map<string, number>()
  const callsByPlugin = new Map<string, number>()
  const errorsByPlugin = new Map<string, number>()
  const lastSeenByPlugin = new Map<string, string | null>()
  const uselessByPlugin = new Map<string, boolean>()

  for (const registered of report.registered) {
    const plugin = registered.plugin || UNKNOWN_LABEL
    toolsByPlugin.set(plugin, (toolsByPlugin.get(plugin) ?? 0) + 1)
  }
  for (const entry of report.entries) {
    if (entry.kind !== 'tool') continue
    const plugin = entry.plugin || UNKNOWN_LABEL
    callsByPlugin.set(plugin, (callsByPlugin.get(plugin) ?? 0) + entry.calls)
    errorsByPlugin.set(plugin, (errorsByPlugin.get(plugin) ?? 0) + entry.errors)
    if (entry.calls > 0) usedByPlugin.set(plugin, (usedByPlugin.get(plugin) ?? 0) + 1)
    const last = lastSeenByPlugin.get(plugin)
    if (entry.lastSeenAt !== null && (last === undefined || last === null || entry.lastSeenAt > last)) {
      lastSeenByPlugin.set(plugin, entry.lastSeenAt)
    }
    if (entry.rating === 'useless') uselessByPlugin.set(plugin, true)
  }

  const plugins = new Set<string>()
  const statusOf = new Map<string, 'ok' | 'disabled' | 'failed'>()
  if (snapshot !== null) {
    for (const entry of snapshot.entries) {
      plugins.add(entry.moduleName)
      statusOf.set(entry.moduleName, entry.fiberPhase === 'failed' ? 'failed' : entry.enabled ? 'ok' : 'disabled')
    }
  }
  for (const plugin of [...toolsByPlugin.keys(), ...callsByPlugin.keys(), ...uselessByPlugin.keys()]) {
    if (plugin !== SKILL_PLUGIN_LABEL && plugin !== UNKNOWN_LABEL) plugins.add(plugin)
  }

  const rows: PluginRow[] = []
  for (const plugin of plugins) {
    const status = statusOf.get(plugin) ?? 'ok'
    const calls = callsByPlugin.get(plugin) ?? 0
    const errors = errorsByPlugin.get(plugin) ?? 0
    const ratedUseless = uselessByPlugin.get(plugin) ?? false
    const registeredTools = toolsByPlugin.get(plugin) ?? 0
    const usedTools = usedByPlugin.get(plugin) ?? 0
    const lastSeenAt = lastSeenByPlugin.get(plugin) ?? null

    let suggestion: PluginRow['suggestion']
    let suspicious = false
    if (status === 'failed') {
      suggestion = { text: locale.sFailed, warn: true }
      suspicious = true
    } else if (status === 'disabled') {
      suggestion = { text: locale.sDisabled, warn: false }
    } else if (ratedUseless) {
      suggestion = { text: locale.sMarked, warn: true }
      suspicious = true
    } else if (calls === 0) {
      suggestion = { text: locale.sNever, warn: true }
      suspicious = true
    } else {
      suggestion = { text: locale.sActive, warn: false }
    }

    rows.push({
      plugin,
      status,
      registeredTools,
      usedTools,
      calls,
      errors,
      lastSeenAt,
      ratedUseless,
      suspicious,
      suggestion,
    })
  }
  rows.sort((a, b) => {
    if (a.suspicious !== b.suspicious) return a.suspicious ? -1 : 1
    return b.calls - a.calls
  })
  return rows
}
