/**
 * Shared plain-JSON vocabulary between the Host service and the Client panel.
 * Both planes exchange only these shapes over the Remote boundary.
 * @module dsh-plugin-prune
 */

/** Human value rating attached to one tool/skill entry. */
export type UsageRating = 'useful' | 'neutral' | 'useless'

/** Aggregated statistics for one tool or one skill. */
export interface UsageEntry {
  /** Tool name, or `skill:<name>` for a skill. */
  readonly key: string
  readonly kind: 'tool' | 'skill'
  /** Best-effort owning plugin/package label. */
  readonly plugin: string
  readonly calls: number
  readonly errors: number
  /** Total dispatch duration in milliseconds (timed entries only). */
  readonly totalMs: number
  readonly avgMs: number
  readonly firstSeenAt: string | null
  readonly lastSeenAt: string | null
  /** Distinct agent sessions that used this key. */
  readonly sessions: number
  /** Approximate rendered output size in characters. */
  readonly outChars: number
  readonly rating: UsageRating | null
  /** Per-day call counts, keyed by `YYYY-MM-DD` (rolling window). */
  readonly daily: Readonly<Record<string, number>>
}

/** One tool name known to the registry at service start. */
export interface UsageRegisteredTool {
  readonly name: string
  readonly plugin: string
}

/** Snapshot the settings panel renders. */
export interface UsageReport {
  /** ISO timestamp of the first recorded call, or service start. */
  readonly trackedSince: string | null
  readonly registeredTools: number
  readonly usedTools: number
  readonly registered: readonly UsageRegisteredTool[]
  readonly entries: readonly UsageEntry[]
}

/** Rate one entry (`null` clears the rating). */
export interface UsageRateRequest {
  readonly key: string
  readonly rating: UsageRating | null
}
