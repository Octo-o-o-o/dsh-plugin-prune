/**
 * Client functional test against the BUILT bundle (client/client.js):
 * stubs window.__ModuleLoader__, executes the factory with the real
 * react / react/jsx-runtime externals, and drives apply() with fake
 * slots/locale/connection services. Verifies the loader id, the slot
 * registration, the connection-RPC wiring (endpoints + payloads), the
 * plugin overview aggregation, and the panel element.
 */
import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'

const require2 = createRequire(import.meta.url)

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (request) => { captured = request },
  },
}

// Load the built artifact; the banner calls the loader synchronously.
require2('../client/client.js')
assert.ok(captured !== null, 'loader must be called')
assert.equal(captured.id, 'dsh-plugin-prune')

const factory = captured.factory
const stubRequire = (id) => {
  if (id === 'react') return require2('react')
  if (id === 'react/jsx-runtime') return require2('react/jsx-runtime')
  throw new Error(`unexpected external require: ${id}`)
}
const mod = factory(stubRequire)

assert.equal(mod.name, 'dsh-plugin-prune')
assert.deepEqual(mod.inject, ['slots', 'locale', 'connection'])
assert.equal(typeof mod.apply, 'function')
assert.equal(typeof mod.createUsageClient, 'function')

// --- drive apply() with fake services ---
const effects = []
let injectSlot = null
let injectCallback = null
let registration = null

const rpcCalls = []
const connection = {
  call: async (channel, endpoint, payload) => {
    rpcCalls.push({ channel, endpoint, payload })
    if (endpoint === 'pluginUsage/report') {
      return { ok: true, value: { trackedSince: 'now', registeredTools: 0, usedTools: 0, registered: [], entries: [] } }
    }
    if (endpoint === 'pluginInventory/list') {
      return { ok: true, value: { entries: [] } }
    }
    if (endpoint === 'pluginUsage/rate' || endpoint === 'pluginUsage/reset') {
      return { ok: true, value: endpoint === 'pluginUsage/rate' ? { ok: true } : { trackedSince: 'now', registeredTools: 0, usedTools: 0, registered: [], entries: [] } }
    }
    return { ok: false, error: { message: 'unexpected endpoint: ' + endpoint } }
  },
}

const ctx = {
  connection,
  effect(callback, label) { effects.push([callback, label]); return () => {} },
  locale: {
    register(namespace, dicts) { effects.push(['dict', namespace, dicts]); return () => {} },
    bind(namespace) { return key => `t(${key})` },
  },
  slots: {
    inject(slot, callback) { injectSlot = slot; injectCallback = callback; },
    register(meta, component) { registration = { meta, component }; return () => {} },
  },
}

mod.apply(ctx)

assert.equal(injectSlot, 'settings.plugins.tab')
assert.equal(typeof injectCallback, 'function')
injectCallback()

assert.ok(registration !== null)
assert.equal(registration.meta.name, 'settings.plugins.tab')
assert.equal(registration.meta.id, 'usage')
assert.equal(registration.meta.order, 20)
assert.equal(typeof registration.meta.label, 'function')
assert.equal(registration.meta.locale, 'dsh-plugin-prune')

// --- connection-RPC wiring through the typed facade ---
const element = registration.component()
assert.equal(typeof element.type, 'function')
assert.equal(element.props.t('tab'), 't(tab)')
const client = element.props.client
assert.ok(client !== null && typeof client === 'object')

const reportOutcome = await client.report()
assert.equal(reportOutcome.ok, true)
assert.equal(rpcCalls.length, 1)
assert.equal(rpcCalls[0].channel, '/api')
assert.equal(rpcCalls[0].endpoint, 'pluginUsage/report')
assert.deepEqual(rpcCalls[0].payload, { args: {} })

const rateOutcome = await client.rate({ key: 'bash', rating: 'useful' })
assert.equal(rateOutcome.ok, true)
assert.equal(rpcCalls[1].endpoint, 'pluginUsage/rate')
assert.deepEqual(rpcCalls[1].payload, { args: { request: { key: 'bash', rating: 'useful' } } })

const invOutcome = await client.inventory()
assert.equal(invOutcome.ok, true)
assert.equal(rpcCalls[2].endpoint, 'pluginInventory/list')
assert.deepEqual(rpcCalls[2].payload, { args: {} })

const resetOutcome = await client.reset()
assert.equal(resetOutcome.ok, true)
assert.equal(rpcCalls[3].endpoint, 'pluginUsage/reset')

// --- error branch ---
const failing = mod.createUsageClient({
  call: async () => ({ ok: false, error: { message: 'boom' } }),
})
const failed = await failing.report()
assert.equal(failed.ok, false)
assert.equal(failed.message, 'boom')

// --- plugin overview aggregation (pure, exported through the bundle) ---
assert.equal(typeof mod.buildPluginRows, 'function')
assert.equal(typeof mod.last7Days, 'function')

const zhLocale = {
  statusOk: 'OK', statusDisabled: 'Disabled', statusFailed: 'Failed',
  sFailed: 'F', sDisabled: 'D', sNever: 'N', sMarked: 'M', sActive: 'A',
}
const report = {
  trackedSince: null,
  registeredTools: 3,
  usedTools: 1,
  registered: [
    { name: 'bash', plugin: '@deepseek-ai/dsh-tool-bash-persistent' },
    { name: 'read', plugin: '@deepseek-ai/dsh-tool-fs' },
    { name: 'mystery', plugin: '@acme/widget' },
  ],
  entries: [
    { key: 'bash', kind: 'tool', plugin: '@deepseek-ai/dsh-tool-bash-persistent', calls: 12, errors: 1, totalMs: 100, avgMs: 8, firstSeenAt: null, lastSeenAt: '2026-08-15T10:00:00.000Z', sessions: 2, outChars: 9, rating: null, daily: { '2026-08-15': 5 } },
    { key: 'read', kind: 'tool', plugin: '@deepseek-ai/dsh-tool-fs', calls: 0, errors: 0, totalMs: 0, avgMs: 0, firstSeenAt: null, lastSeenAt: null, sessions: 0, outChars: 0, rating: null, daily: {} },
    { key: 'mystery', kind: 'tool', plugin: '@acme/widget', calls: 0, errors: 0, totalMs: 0, avgMs: 0, firstSeenAt: null, lastSeenAt: null, sessions: 0, outChars: 0, rating: 'useless', daily: {} },
    { key: 'skill:x', kind: 'skill', plugin: 'skills', calls: 3, errors: 0, totalMs: 0, avgMs: 0, firstSeenAt: null, lastSeenAt: null, sessions: 0, outChars: 0, rating: null, daily: {} },
  ],
}
const snapshot = {
  entries: [
    { entryId: 'e1', moduleName: '@deepseek-ai/dsh-tool-bash-persistent', enabled: true, fiberPhase: 'active' },
    { entryId: 'e2', moduleName: '@acme/widget', enabled: true, fiberPhase: null },
    { entryId: 'e3', moduleName: '@deepseek-ai/dsh-tool-fs', enabled: false, fiberPhase: 'active' },
    { entryId: 'e4', moduleName: '@broken/pkg', enabled: true, fiberPhase: 'failed' },
    { entryId: 'e5', moduleName: '@never/used', enabled: true, fiberPhase: 'active' },
  ],
}
const rows = mod.buildPluginRows(report, snapshot, zhLocale)
const byPlugin = new Map(rows.map(r => [r.plugin, r]))

assert.equal(byPlugin.get('@deepseek-ai/dsh-tool-bash-persistent').calls, 12)
assert.equal(byPlugin.get('@deepseek-ai/dsh-tool-bash-persistent').usedTools, 1)
assert.equal(byPlugin.get('@deepseek-ai/dsh-tool-bash-persistent').registeredTools, 1)
assert.equal(byPlugin.get('@deepseek-ai/dsh-tool-bash-persistent').suggestion.text, 'A')

assert.equal(byPlugin.get('@broken/pkg').status, 'failed')
assert.equal(byPlugin.get('@broken/pkg').suggestion.text, 'F')
assert.equal(byPlugin.get('@broken/pkg').suspicious, true)

assert.equal(byPlugin.get('@deepseek-ai/dsh-tool-fs').status, 'disabled')
assert.equal(byPlugin.get('@deepseek-ai/dsh-tool-fs').suggestion.text, 'D')

assert.equal(byPlugin.get('@never/used').calls, 0)
assert.equal(byPlugin.get('@never/used').suggestion.text, 'N')
assert.equal(byPlugin.get('@never/used').suspicious, true)

assert.equal(byPlugin.get('@acme/widget').ratedUseless, true)
assert.equal(byPlugin.get('@acme/widget').suggestion.text, 'M')

assert.equal(byPlugin.has('skills'), false, 'skill pseudo-plugin excluded')
assert.equal(rows.length, 5, 'inventory entries plus known plugins, skills excluded')

// rows sorted suspicious-first
assert.equal(rows[0].suspicious, true)

// last7Days counts the rolling window
const today = new Date().toISOString().slice(0, 10)
const entry7 = { daily: { [today]: 3 } }
assert.equal(mod.last7Days(entry7), 3)

console.log('CLIENT TEST PASS')
