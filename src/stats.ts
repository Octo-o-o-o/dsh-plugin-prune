/**
 * Telemetry aggregation and durable JSON persistence.
 *
 * The store is a pure observer: it never mutates business state, never
 * serializes live runtime objects, and reads only the leaf fields it needs
 * from tool executions (`name`, `callId`, `arguments`, `agent.id`, `isError`,
 * `content`).
 * @module dsh-plugin-prune/stats
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { STATIC_MAP, UNKNOWN, staticSource } from './static-map.ts'
import type { UsageEntry, UsageRateRequest, UsageRating, UsageReport, UsageRegisteredTool } from './types.ts'

/** Structural view of the tool-execution leaf fields this observer reads. */
export interface ToolExecLike {
  readonly callId?: unknown
  readonly name?: unknown
  readonly arguments?: unknown
  readonly agent?: unknown
}

/** Structural view of the result leaf fields this observer reads. */
export interface ToolResultLike {
  readonly isError?: unknown
  readonly content?: unknown
}

export interface StatsOptions {
  /** Persist debounce window in milliseconds (>= 100; default 2000). */
  readonly debounceMs?: number
  /** Rolling window of per-day call counts kept per entry (>= 7; default 90). */
  readonly keepDays?: number
}

interface InternalEntry {
  key: string
  kind: 'tool' | 'skill'
  plugin: string
  calls: number
  errors: number
  totalMs: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  outChars: number
  rating: UsageRating | null
  daily: Record<string, number>
  /** Sessions carried over from a persisted snapshot. */
  baseSessions: number
}

interface PersistedSnapshot {
  version?: unknown
  updatedAt?: unknown
  entries?: unknown
  sources?: unknown
}

const SKIP_STACK_PACKAGES = new Set([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-scope',
])

/** Resolve the durable data file: `$DSH_HOME/dsh-plugin-prune.json`, else `~/.dsh`. */
export function resolveDataPath(override?: string): string {
  if (typeof override === 'string' && override.trim() !== '') return override
  const base = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(base, 'dsh-plugin-prune.json')
}

/** Best-effort package attribution from one register-call stack. */
function attributeFromStack(stack: string | undefined): string | null {
  if (typeof stack !== 'string') return null
  const lines = stack.split('\n').slice(2)
  for (const line of lines) {
    const match = line.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)
    if (match === null) continue
    const pkg = match[1]
    if (SKIP_STACK_PACKAGES.has(pkg)) continue
    return pkg
  }
  return null
}

export class StatsStore {
  private readonly entries = new Map<string, InternalEntry>()
  private readonly sources: Record<string, string> = { ...STATIC_MAP }
  private readonly started = new Map<string, number>()
  private readonly sessionSets = new Map<string, Set<string>>()
  private registeredNames: string[] = []
  private readonly dataPath: string
  private readonly debounceMs: number
  private readonly keepDays: number
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private trackedSince: string | null = null

  constructor(dataPath: string, options: StatsOptions = {}) {
    this.dataPath = dataPath
    this.debounceMs = typeof options.debounceMs === 'number' && Number.isFinite(options.debounceMs) && options.debounceMs >= 100
      ? options.debounceMs
      : 2000
    this.keepDays = typeof options.keepDays === 'number' && Number.isFinite(options.keepDays) && options.keepDays >= 7
      ? options.keepDays
      : 90
    this.trackedSince = this.iso()
    this.load()
  }

  /** Record the dispatch start time for one call id. */
  markStart(exec: unknown): void {
    const callId = (exec as ToolExecLike | null | undefined)?.callId
    if (typeof callId === 'string') this.started.set(callId, Date.now())
  }

  /** Record the registry snapshot of tool names visible at service start. */
  setRegistered(names: readonly string[]): void {
    this.registeredNames = [...names]
  }

  /** Attribute one newly registered tool from its registration stack. */
  attributeRegister(name: string, stack: string | undefined): void {
    if (this.sources[name] !== undefined) return
    const source = attributeFromStack(stack)
    if (source !== null) this.sources[name] = source
  }

  /** Aggregate one settled tool execution. */
  record(exec: unknown, result: unknown): void {
    const execLike = exec as ToolExecLike | null | undefined
    const resultLike = result as ToolResultLike | null | undefined
    const name = execLike?.name
    if (typeof name !== 'string' || name === '') return

    let key = name
    let kind: 'tool' | 'skill' = 'tool'
    let plugin = this.sourceOf(name)
    if (name === 'skill') {
      const args = execLike?.arguments
      if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
        const skillName = (args as { name?: unknown }).name
        if (typeof skillName === 'string' && skillName !== '') {
          key = `skill:${skillName}`
          kind = 'skill'
          plugin = 'skills'
        }
      }
    }

    let entry = this.entries.get(key)
    if (entry === undefined) {
      entry = {
        key, kind, plugin,
        calls: 0, errors: 0, totalMs: 0,
        firstSeenAt: null, lastSeenAt: null,
        outChars: 0, rating: null,
        daily: {}, baseSessions: 0,
      }
      this.entries.set(key, entry)
    }

    entry.calls += 1
    if (resultLike?.isError === true) entry.errors += 1

    const callId = execLike?.callId
    const startedAt = typeof callId === 'string' ? this.started.get(callId) : undefined
    if (typeof callId === 'string') this.started.delete(callId)
    if (typeof startedAt === 'number') {
      const now = Date.now()
      if (now >= startedAt) entry.totalMs += now - startedAt
    }

    const now = this.iso()
    if (now !== null) {
      entry.lastSeenAt = now
      if (entry.firstSeenAt === null) entry.firstSeenAt = now
      const day = now.slice(0, 10)
      entry.daily[day] = (entry.daily[day] ?? 0) + 1
      const days = Object.keys(entry.daily)
      if (days.length > this.keepDays) {
        days.sort()
        for (const old of days.slice(0, days.length - this.keepDays)) delete entry.daily[old]
      }
    }

    const agentId = (execLike?.agent as { id?: unknown } | null | undefined)?.id
    if (typeof agentId === 'string') {
      let set = this.sessionSets.get(key)
      if (set === undefined) {
        set = new Set()
        this.sessionSets.set(key, set)
      }
      set.add(agentId)
    }

    const content = resultLike?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        const text = (block as { text?: unknown } | null | undefined)?.text
        if (typeof text === 'string') entry.outChars += text.length
      }
    }

    this.persistSoon()
  }

  /** Build the plain-JSON report snapshot. */
  report(): UsageReport {
    const entries: UsageEntry[] = []
    for (const entry of this.entries.values()) {
      const set = this.sessionSets.get(entry.key)
      entries.push({
        key: entry.key,
        kind: entry.kind,
        plugin: entry.plugin,
        calls: entry.calls,
        errors: entry.errors,
        totalMs: entry.totalMs,
        avgMs: entry.calls > 0 ? Math.round(entry.totalMs / entry.calls) : 0,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        sessions: entry.baseSessions + (set?.size ?? 0),
        outChars: entry.outChars,
        rating: entry.rating,
        daily: entry.daily,
      })
    }
    entries.sort((a, b) => b.calls - a.calls)
    const usedTools = entries.reduce((sum, entry) => sum + (entry.kind === 'tool' && entry.calls > 0 ? 1 : 0), 0)
    const registered: UsageRegisteredTool[] = this.registeredNames.map(name => ({
      name,
      plugin: this.sourceOf(name),
    }))
    return {
      trackedSince: this.trackedSince,
      registeredTools: this.registeredNames.length,
      usedTools,
      registered,
      entries,
    }
  }

  /** Rate one entry; `null` clears the rating. */
  rate(request: UsageRateRequest): { ok: boolean } {
    const entry = typeof request.key === 'string' ? this.entries.get(request.key) : undefined
    if (entry === undefined) return { ok: false }
    const rating = request.rating === 'useful' || request.rating === 'neutral' || request.rating === 'useless'
      ? request.rating
      : null
    entry.rating = rating
    this.persistSoon()
    return { ok: true }
  }

  /** Drop all collected statistics. */
  reset(): UsageReport {
    this.entries.clear()
    this.sessionSets.clear()
    this.persistNow()
    return this.report()
  }

  /** Flush pending state; called on service dispose. */
  dispose(): void {
    this.disposed = true
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      this.persistNow()
    } catch (error) {
      console.error('[dsh-plugin-prune] dispose flush failed:', error instanceof Error ? error.message : String(error))
    }
  }

  private sourceOf(name: string): string {
    const learned = this.sources[name]
    if (typeof learned === 'string' && learned !== '') return learned
    return staticSource(name)
  }

  private iso(): string | null {
    return new Date().toISOString()
  }

  private persistSoon(): void {
    if (this.disposed) return
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.persistNow()
      } catch (error) {
        console.error('[dsh-plugin-prune] persist failed:', error instanceof Error ? error.message : String(error))
      }
    }, this.debounceMs)
  }

  private persistNow(): void {
    mkdirSync(dirname(this.dataPath), { recursive: true })
    const tmp = `${this.dataPath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.snapshot()))
    renameSync(tmp, this.dataPath)
  }

  private snapshot(): PersistedSnapshot {
    const entries: Record<string, unknown> = {}
    for (const entry of this.entries.values()) {
      const set = this.sessionSets.get(entry.key)
      entries[entry.key] = {
        kind: entry.kind,
        plugin: entry.plugin,
        calls: entry.calls,
        errors: entry.errors,
        totalMs: entry.totalMs,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        outChars: entry.outChars,
        rating: entry.rating,
        daily: entry.daily,
        sessions: entry.baseSessions + (set?.size ?? 0),
      }
    }
    const sources: Record<string, string> = {}
    for (const [name, source] of Object.entries(this.sources)) {
      if (STATIC_MAP[name] === undefined) sources[name] = source
    }
    return { version: 1, updatedAt: this.iso(), entries, sources }
  }

  private load(): void {
    try {
      const raw = readFileSync(this.dataPath, 'utf8')
      this.hydrate(JSON.parse(raw) as unknown)
    } catch {
      // Fresh start, or an unreadable/corrupt file: keep the empty store.
    }
  }

  private hydrate(data: unknown): void {
    const snapshot = data as PersistedSnapshot | null | undefined
    if (snapshot === null || typeof snapshot !== 'object') return
    if (snapshot.entries !== null && typeof snapshot.entries === 'object') {
      for (const [key, raw] of Object.entries(snapshot.entries as Record<string, unknown>)) {
        if (raw === null || typeof raw !== 'object') continue
        const record = raw as Record<string, unknown>
        const rating = record.rating === 'useful' || record.rating === 'neutral' || record.rating === 'useless'
          ? record.rating
          : null
        const daily: Record<string, number> = {}
        if (record.daily !== null && typeof record.daily === 'object') {
          for (const [day, count] of Object.entries(record.daily as Record<string, unknown>)) {
            if (typeof count === 'number' && Number.isFinite(count) && count > 0) daily[day] = count
          }
        }
        this.entries.set(key, {
          key,
          kind: record.kind === 'skill' ? 'skill' : 'tool',
          plugin: typeof record.plugin === 'string' && record.plugin !== '' ? record.plugin : UNKNOWN,
          calls: typeof record.calls === 'number' && record.calls > 0 ? record.calls : 0,
          errors: typeof record.errors === 'number' && record.errors > 0 ? record.errors : 0,
          totalMs: typeof record.totalMs === 'number' && record.totalMs > 0 ? record.totalMs : 0,
          firstSeenAt: typeof record.firstSeenAt === 'string' ? record.firstSeenAt : null,
          lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : null,
          outChars: typeof record.outChars === 'number' && record.outChars > 0 ? record.outChars : 0,
          rating,
          daily,
          baseSessions: typeof record.sessions === 'number' && record.sessions > 0 ? record.sessions : 0,
        })
      }
    }
    if (snapshot.sources !== null && typeof snapshot.sources === 'object') {
      for (const [name, source] of Object.entries(snapshot.sources as Record<string, unknown>)) {
        if (typeof source === 'string' && source !== '') this.sources[name] = source
      }
    }
  }
}
