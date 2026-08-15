/**
 * Client functional test against the BUILT bundle (client/client.js):
 * stubs window.__ModuleLoader__, executes the factory with the real
 * react / react/jsx-runtime externals, and drives apply() with fake
 * slots/locale/remote services. Verifies the loader id, the slot
 * registration, the Remote $mount contribution, and the panel element.
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
assert.deepEqual(mod.inject, ['slots', 'locale', 'remote'])
assert.equal(typeof mod.apply, 'function')

// --- drive apply() with fake services ---
const effects = []
let mountContribution = null
let injectSlot = null
let injectCallback = null
let registration = null

const ctx = {
  get(name) {
    if (name === 'remote') {
      return { $mount: async (contribution) => { mountContribution = contribution; return () => {} } }
    }
    return undefined
  },
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

assert.ok(mountContribution !== null, 'remote $mount must receive the contribution')
assert.equal(mountContribution.package, 'dsh-plugin-prune')
assert.equal(mountContribution.descriptors.length, 3)
const methods = mountContribution.descriptors.map(d => d.method).sort()
assert.deepEqual(methods, ['rate', 'report', 'reset'])
const rate = mountContribution.descriptors.find(d => d.method === 'rate')
assert.equal(rate.namespace, 'pluginUsage')
assert.equal(rate.service, 'pluginUsage')
assert.equal(rate.parameters.length, 1)
assert.equal(rate.parameters[0].wire, 'request')
assert.equal(rate.parameters[0].codec.mode, 'strict')
assert.equal(rate.result.mode, 'strict')

// --- render the panel element ---
const element = registration.component()
assert.equal(typeof element.type, 'function')
assert.ok(element.props.remote instanceof Promise)
assert.equal(typeof element.props.t, 'function')
assert.equal(element.props.t('tab'), 't(tab)')

console.log('CLIENT TEST PASS')
