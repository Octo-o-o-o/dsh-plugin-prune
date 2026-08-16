/**
 * Client half of dsh-plugin-prune: registers the "Plugin Health" tab inside
 * the shipped Plugins settings section and talks to the Host through the
 * connection RPC carrier (the same `/api` channel every generated Remote
 * face uses). Built by tsdown into the __ModuleLoader__ factory bundle at
 * client/client.js; the only externals are the loader module table's react
 * entries.
 * @module dsh-plugin-prune/client
 */

import { createElement } from 'react'
import { en, zh } from './locales.ts'
import { UsagePanel } from './UsagePanel.tsx'
import { createUsageClient } from './rpc.ts'
import type { ConnectionRpcLike } from './rpc.ts'

// Exported for the functional tests (extra exports are ignored by the loader).
export { buildPluginRows, last7Days } from './overview.ts'
export { createUsageClient } from './rpc.ts'

const NS = 'dsh-plugin-prune'

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>, en: Record<string, string> }): unknown
  bind(namespace: string): (key: string) => string
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** Structural client context: keeps this external package free of monorepo-internal types. */
interface UsageClientContext {
  connection: ConnectionRpcLike
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

export const name = 'dsh-plugin-prune'
export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: UsageClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-prune: dictionaries')
  const t = ctx.locale.bind(NS)
  const client = createUsageClient(ctx.connection)

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'usage',
    order: 20,
    label: () => t('tab'),
    locale: NS,
  }, () => createElement(UsagePanel, { client, t })))
}
