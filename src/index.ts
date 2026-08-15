/**
 * Host half of dsh-plugin-prune.
 *
 * A TypertRemoteService that observes `tools/execute` / `tools/result`,
 * aggregates per-tool and per-skill usage telemetry, persists it as JSON
 * under the DSH home directory, and exports three Remote methods the
 * settings panel consumes: `report`, `rate`, `reset`.
 *
 * The plugin adds no model-visible tools and modifies no business state:
 * it is a pure observer. Registration provenance is best-effort (static
 * catalog + stack attribution), see `static-map.ts`.
 * @module dsh-plugin-prune
 */

import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { USAGE_DESCRIPTORS } from './remote-descriptors.ts'
import { StatsStore, resolveDataPath } from './stats.ts'
import type { ToolExecLike } from './stats.ts'
import type { UsageRateRequest, UsageReport } from './types.ts'

export type {
  UsageEntry,
  UsageRateRequest,
  UsageRating,
  UsageRegisteredTool,
  UsageReport,
} from './types.ts'
export { resolveDataPath } from './stats.ts'
export { STATIC_MAP, UNKNOWN } from './static-map.ts'

/** Optional row configuration; every field has a safe default. */
export interface Config {
  /** Persist debounce window in milliseconds (>= 100; default 2000). */
  readonly debounceMs?: number
  /** Rolling window of per-day call counts kept per entry (>= 7; default 90). */
  readonly keepDays?: number
  /** Absolute data-file path override (default `$DSH_HOME/dsh-plugin-prune.json`). */
  readonly dataPath?: string
}

/** Structural surface of the tools registry this observer touches. */
interface ToolsLike {
  schemas?: () => unknown
  register: (definition: { name?: unknown }) => unknown
}

/** Structural surface of the context event API (keeps host Events types out of scope). */
interface ObserverContext {
  on(event: string, listener: (...args: never[]) => unknown): () => void
  get(name: string): unknown
  effect(callback: () => unknown | (() => unknown), label?: string): unknown
}

/** Structural surface of the typert registry this service contributes to. */
interface TypertLike {
  readonly local: { get(endpoint: string): unknown }
  register(contribution: {
    package: string
    face: 'host'
    schemas: readonly unknown[]
    model: { services: readonly unknown[], events: readonly unknown[], objects: readonly unknown[] }
    invocations: readonly unknown[]
  }): () => unknown
}

export class PluginUsageService extends TypertRemoteService {
  /**
   * Both services are hard dependencies, declared the standard way: cordis
   * delivers them to the row's (possibly scoped) context, whereas `ctx.get`
   * only resolves services provided in the same scope. `typert` carries the
   * strict invocation contribution; `tools` supplies the registry snapshot
   * and the late-registration attribution hook.
   */
  static inject = ['typert', 'tools']

  private readonly stats: StatsStore
  private readonly ctxAsObserver: ObserverContext

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginUsage')
    this.ctxAsObserver = ctx as unknown as ObserverContext
    this.stats = new StatsStore(resolveDataPath(config.dataPath), {
      debounceMs: config.debounceMs,
      keepDays: config.keepDays,
    })

    this.ctxAsObserver.on('tools/execute', ((exec: ToolExecLike, next: () => unknown) => {
      try {
        this.stats.markStart(exec)
      } catch {
        // Observer failures must never disturb the dispatch pipeline.
      }
      return next()
    }) as (...args: never[]) => unknown)

    this.ctxAsObserver.on('tools/result', ((exec: unknown, result: unknown) => {
      try {
        this.stats.record(exec, result)
      } catch (error) {
        console.error('[dsh-plugin-prune] record failed:', error instanceof Error ? error.message : String(error))
      }
    }) as (...args: never[]) => unknown)

    const tools = (ctx as unknown as { tools: ToolsLike | undefined }).tools
    if (tools !== undefined) {
      try {
        if (typeof tools.schemas === 'function') {
          const schemas = tools.schemas()
          if (Array.isArray(schemas)) {
            const names = schemas
              .map(schema => (schema as { name?: unknown } | null | undefined)?.name)
              .filter((name): name is string => typeof name === 'string')
            this.stats.setRegistered(names)
          }
        }
        if (typeof tools.register === 'function') this.wrapToolsRegister(tools)
      } catch (error) {
        console.error('[dsh-plugin-prune] tools registry inspection failed:', error instanceof Error ? error.message : String(error))
      }
    }

    const typertDiag = this.registerTypertContribution(ctx)
    this.stats.writeDiagnostic({ toolsFound: tools !== undefined, ...typertDiag })

    ctx.effect(() => () => this.stats.dispose())
  }

  /**
   * Register strict invocation descriptors so the api-gateway claims and
   * dispatches `pluginUsage/*` through its generated local registry. This is
   * more robust than relying on `@Remote` markers alone: marker storage is a
   * module-local WeakMap that splits when the profile resolves a second copy
   * of `dsh-typert-protocol` beside the deployment's own.
   */
  private registerTypertContribution(ctx: Context): Record<string, unknown> {
    try {
      const typert = (ctx as unknown as { typert: TypertLike | undefined }).typert
      if (typert === undefined || typeof typert.register !== 'function') {
        return { typertFound: false, contributionError: null, endpointRegistered: false }
      }
      const disposer = typert.register({
        package: 'dsh-plugin-prune',
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: USAGE_DESCRIPTORS,
      })
      const endpointRegistered = typert.local.get('pluginUsage/report') !== undefined
      ctx.effect(() => () => {
        try {
          disposer()
        } catch {
          // Already withdrawn with the fiber.
        }
      }, 'dsh-plugin-prune: typert contribution')
      return { typertFound: true, contributionError: null, endpointRegistered }
    } catch (error) {
      console.error('[dsh-plugin-prune] typert registration failed:', error instanceof Error ? error.message : String(error))
      return {
        typertFound: true,
        contributionError: error instanceof Error ? error.message : String(error),
        endpointRegistered: false,
      }
    }
  }

  /** Read the aggregated report. */
  @Remote
  report(): UsageReport {
    return this.stats.report()
  }

  /** Rate one tool/skill entry; `rating: null` clears the rating. */
  @Remote
  rate(request: UsageRateRequest): { ok: boolean } {
    return this.stats.rate(request)
  }

  /** Drop all collected statistics and return the empty report. */
  @Remote
  reset(): UsageReport {
    return this.stats.reset()
  }

  /** Track tools registered after this plugin activated (all scopes), via their stack frames. */
  private wrapToolsRegister(tools: ToolsLike): void {
    const original = tools.register
    const stats = this.stats
    tools.register = function (this: unknown, definition: { name?: unknown }) {
      try {
        const name = definition?.name
        if (typeof name === 'string' && name !== '') {
          stats.addRegistered(name)
          stats.attributeRegister(name, new Error().stack)
        }
      } catch {
        // Best-effort attribution only.
      }
      return original.apply(this, arguments as unknown as [{ name?: unknown }])
    }
    this.ctxAsObserver.effect(() => () => {
      tools.register = original
    })
  }
}

export default PluginUsageService
