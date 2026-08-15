/**
 * Host functional test against the BUILT artifact (lib/index.js):
 * real cordis Context, real event bus, simulated tool pipeline.
 * Verifies: listener wiring, aggregation, ratings, persistence, reset, dispose.
 */
import { strict as assert } from 'node:assert'
import { readFileSync, rmSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import PluginUsageService from '../lib/index.js'

const dataPath = '/tmp/dsh-plugin-prune-host-test.json'
try { rmSync(dataPath, { force: true }) } catch { /* ignore */ }

const ctx = new Context()

// Provide a fake tools registry BEFORE the service reads it.
const registry = {
  schemas: () => [{ name: 'bash' }, { name: 'read' }, { name: 'skill' }, { name: 'mystery' }],
  register(definition) { return () => {} },
}
ctx.provide('tools', registry)

const service = new PluginUsageService(ctx, { dataPath, debounceMs: 100 })
assert.equal(service.name, 'pluginUsage')

// --- simulate the tool pipeline ---
ctx.emit('tools/execute', { callId: 'c1', name: 'bash' }, () => 'next-marker')
ctx.emit('tools/result', { callId: 'c1', name: 'bash', agent: { id: 's1' } }, {
  isError: false,
  content: [{ type: 'text', text: 'hello' }],
})
ctx.emit('tools/result', { callId: 'c2', name: 'skill', arguments: { name: 'code-simplifier' }, agent: { id: 's1' } }, {
  isError: false,
  content: [],
})
ctx.emit('tools/result', { callId: 'c3', name: 'read', agent: { id: 's2' } }, {
  isError: true,
  content: [{ type: 'text', text: 'boom' }],
})

// Late-registration attribution from a realistic 3-line stack.
service['stats'].attributeRegister('mystery', [
  'Error',
  '    at Object.register (node_modules/dsh-plugin-prune/lib/index.js:10:1)',
  '    at apply (node_modules/@acme/widget/dist/index.js:3:1)',
].join('\n'))

const report = service.report()
const byKey = new Map(report.entries.map(e => [e.key, e]))
assert.equal(byKey.get('bash').calls, 1)
assert.equal(byKey.get('bash').errors, 0)
assert.equal(byKey.get('bash').sessions, 1)
assert.equal(byKey.get('bash').outChars, 5)
assert.equal(byKey.get('bash').plugin, '@deepseek-ai/dsh-tool-bash-persistent')
assert.equal(byKey.get('skill:code-simplifier').kind, 'skill')
assert.equal(byKey.get('read').errors, 1)
assert.equal(report.registeredTools, 4)
assert.equal(report.usedTools, 2)
assert.equal(report.registered.find(r => r.name === 'mystery').plugin, '@acme/widget')

// --- remote methods ---
assert.deepEqual(service.rate({ key: 'bash', rating: 'useful' }), { ok: true })
assert.deepEqual(service.rate({ key: 'does-not-exist', rating: null }), { ok: false })
assert.equal(service.report().entries.find(e => e.key === 'bash').rating, 'useful')

// --- persistence ---
await new Promise(resolve => setTimeout(resolve, 200))
const persisted = JSON.parse(readFileSync(dataPath, 'utf8'))
assert.equal(typeof persisted.entries.bash, 'object')
assert.equal(persisted.entries.bash.rating, 'useful')
assert.equal(persisted.entries.bash.sessions, 1)

// --- reset + dispose flush ---
service.reset()
assert.equal(service.report().entries.length, 0)
service['stats'].dispose()
const afterReset = JSON.parse(readFileSync(dataPath, 'utf8'))
assert.equal(Object.keys(afterReset.entries).length, 0)

rmSync(dataPath, { force: true })
console.log('HOST TEST PASS')
