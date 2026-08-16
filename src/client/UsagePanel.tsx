/**
 * The plugin-prune settings tab: a plugin overview (joined with the shipped
 * plugin inventory, answering "which plugins can I remove") plus the per-tool
 * detail table with calls, error rate, latency, last use, sessions, output
 * size, 7-day activity, your value rating and a machine suggestion.
 * Pure React — all data arrives through the Remote faces.
 */

import { useCallback, useEffect, useState } from 'react'
import type { UsageEntry, UsageRateRequest, UsageRating, UsageReport } from '../types.ts'
import { buildPluginRows, last7Days } from './overview.ts'
import type { InventorySnapshotLike, OverviewLocale, PluginRow } from './overview.ts'
import type { UsageClient } from './rpc.ts'
import css from './UsagePanel.module.css'

export type Translate = (key: string) => string

export interface UsagePanelProps {
  readonly client: UsageClient
  readonly t: Translate
}

interface Row {
  readonly key: string
  readonly kind: 'tool' | 'skill'
  readonly plugin: string
  readonly calls: number
  readonly errors: number
  readonly avgMs: number
  readonly lastSeenAt: string | null
  readonly sessions: number
  readonly outChars: number
  readonly rating: UsageRating | null
  readonly last7: number
}

interface Suggestion {
  readonly text: string
  readonly warn: boolean
}

const RATINGS: readonly UsageRating[] = ['useful', 'neutral', 'useless']

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

function fmtTime(value: string | null): string {
  return value === null ? '—' : value.slice(0, 16).replace('T', ' ')
}

function fmtChars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

function suggestionOf(entry: Row, t: Translate): Suggestion {
  if (entry.rating === 'useless') return { text: t('sMarked'), warn: true }
  if (entry.calls === 0) return { text: t('sNever'), warn: true }
  if (entry.calls >= 3 && entry.errors / entry.calls >= 0.5) return { text: t('sHighErr'), warn: true }
  if (entry.calls >= 5 && entry.errors / entry.calls <= 0.1 && entry.rating === 'useful') return { text: t('sReliable'), warn: false }
  return { text: t('sInUse'), warn: false }
}

function isSuspicious(entry: Row): boolean {
  return entry.calls === 0
    || (entry.calls >= 3 && entry.errors / entry.calls >= 0.5)
    || entry.rating === 'useless'
}

export function UsagePanel({ client, t }: UsagePanelProps) {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [snapshot, setSnapshot] = useState<InventorySnapshotLike | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suspiciousOnly, setSuspiciousOnly] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const reportOutcome = await client.report()
    if (!reportOutcome.ok) {
      setError(reportOutcome.message ?? 'failed to load')
      return
    }
    setReport(reportOutcome.value)
    const inventoryOutcome = await client.inventory()
    if (inventoryOutcome.ok && inventoryOutcome.value !== null) setSnapshot(inventoryOutcome.value)
    setError(null)
  }, [client])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 8000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (confirmReset) {
      const timer = window.setTimeout(() => setConfirmReset(false), 3000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [confirmReset])

  const rate = async (key: string, rating: UsageRating | null): Promise<void> => {
    setBusy(true)
    try {
      const request: UsageRateRequest = { key, rating }
      const outcome = await client.rate(request)
      if (!outcome.ok) setError(outcome.message ?? 'failed to rate')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setBusy(true)
    try {
      const outcome = await client.reset()
      if (!outcome.ok) setError(outcome.message ?? 'failed to reset')
      else if (outcome.value !== null) setReport(outcome.value)
      setConfirmReset(false)
    } finally {
      setBusy(false)
    }
  }

  if (error !== null) {
    return (
      <div className={css.panel}>
        <h3>{t('title')}</h3>
        <div className={css.hint}>{t('loadFailed')}{error}</div>
        <button type="button" className={css.btn} onClick={() => void load()}>{t('retry')}</button>
      </div>
    )
  }

  if (report === null) {
    return <div className={css.panel}>{t('loading')}</div>
  }

  const byKey = new Map<string, UsageEntry>()
  for (const entry of report.entries) byKey.set(entry.key, entry)
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const registered of report.registered) {
    const entry = byKey.get(registered.name)
    if (entry !== undefined) {
      rows.push({ ...entry, last7: last7Days(entry) })
      seen.add(entry.key)
    } else {
      rows.push({
        key: registered.name,
        kind: 'tool',
        plugin: registered.plugin,
        calls: 0, errors: 0, avgMs: 0,
        lastSeenAt: null, sessions: 0, outChars: 0, rating: null, last7: 0,
      })
    }
  }
  for (const entry of report.entries) {
    if (!seen.has(entry.key)) rows.push({ ...entry, last7: last7Days(entry) })
  }

  const overviewLocale: OverviewLocale = {
    statusOk: t('statusOk'),
    statusDisabled: t('statusDisabled'),
    statusFailed: t('statusFailed'),
    sFailed: t('sFailed'),
    sDisabled: t('sDisabled'),
    sNever: t('sNever'),
    sMarked: t('sMarked'),
    sActive: t('sActive'),
  }
  const pluginRows: PluginRow[] = buildPluginRows(report, snapshot, overviewLocale)
  const visiblePlugins = suspiciousOnly ? pluginRows.filter(row => row.suspicious) : pluginRows

  const visible = suspiciousOnly ? rows.filter(isSuspicious) : rows
  visible.sort((a, b) => b.calls - a.calls)

  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const totalErrors = rows.reduce((sum, row) => sum + row.errors, 0)

  const statusLabel = (status: PluginRow['status']): string => {
    if (status === 'failed') return t('statusFailed')
    if (status === 'disabled') return t('statusDisabled')
    return t('statusOk')
  }

  return (
    <div className={css.panel}>
      <h3>{t('title')}</h3>
      <div className={css.meta}>
        {t('metaRegistered')}{report.registeredTools}{t('metaUsed')}{report.usedTools}{t('metaCalls')}
        {totalCalls}{t('metaMid')}{totalErrors}{t('metaEnd')}
      </div>
      <div className={css.toolbar}>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void load()}>{t('refresh')}</button>
        <label className={css.checkboxLabel}>
          <input type="checkbox" checked={suspiciousOnly} onChange={() => setSuspiciousOnly(value => !value)} />
          {t('suspiciousOnly')}
        </label>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void reset()}>
          {confirmReset ? t('resetConfirm') : t('reset')}
        </button>
      </div>

      <h4>{t('ovTitle')}</h4>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('thPlugin')}</th>
            <th>{t('thStatus')}</th>
            <th className={css.num}>{t('thTools')}</th>
            <th className={css.num}>{t('thCalls')}</th>
            <th className={css.num}>{t('thErr')}</th>
            <th>{t('thLast')}</th>
            <th>{t('thSuggest')}</th>
          </tr>
        </thead>
        <tbody>
          {visiblePlugins.length === 0
            ? <tr><td colSpan={7}>{t('ovEmpty')}</td></tr>
            : visiblePlugins.map(row => {
              const errorRate = row.calls > 0 ? `${Math.round((row.errors / row.calls) * 100)}%` : '—'
              return (
                <tr key={row.plugin}>
                  <td><div className={css.pkg}>{row.plugin}</div></td>
                  <td>{statusLabel(row.status)}</td>
                  <td className={css.num}>{row.usedTools}/{row.registeredTools}</td>
                  <td className={css.num}>{row.calls}</td>
                  <td className={css.num}>{errorRate}</td>
                  <td>{fmtTime(row.lastSeenAt)}</td>
                  <td><span className={row.suggestion.warn ? css.suggestWarn : css.suggestOk}>{row.suggestion.text}</span></td>
                </tr>
              )
            })}
        </tbody>
      </table>

      <h4>{t('dtTitle')}</h4>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('thName')}</th>
            <th>{t('thSource')}</th>
            <th className={css.num}>{t('thCalls')}</th>
            <th className={css.num}>{t('thLast7')}</th>
            <th className={css.num}>{t('thErr')}</th>
            <th className={css.num}>{t('thAvg')}</th>
            <th>{t('thLast')}</th>
            <th className={css.num}>{t('thSessions')}</th>
            <th className={css.num}>{t('thOutput')}</th>
            <th>{t('thRating')}</th>
            <th>{t('thSuggest')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0
            ? <tr><td colSpan={11}>{t('empty')}</td></tr>
            : visible.map(row => {
              const suggestion = suggestionOf(row, t)
              const errorRate = row.calls > 0 ? `${Math.round((row.errors / row.calls) * 100)}%` : '—'
              return (
                <tr key={row.key}>
                  <td>
                    <span className={css.name}>{row.key}</span>
                    {row.kind === 'skill' ? <span className={css.tag}>{t('kindSkill')}</span> : null}
                  </td>
                  <td><div className={css.pkg}>{row.plugin || t('unknown')}</div></td>
                  <td className={css.num}>{row.calls}</td>
                  <td className={css.num}>{row.last7}</td>
                  <td className={css.num}>{errorRate}</td>
                  <td className={css.num}>{row.calls > 0 ? fmtMs(row.avgMs) : '—'}</td>
                  <td>{fmtTime(row.lastSeenAt)}</td>
                  <td className={css.num}>{row.sessions}</td>
                  <td className={css.num}>{fmtChars(row.outChars)}</td>
                  <td>
                    <span className={css.rating}>
                      {RATINGS.map(rating => {
                        const active = row.rating === rating
                        const extra = active ? (rating === 'useful' ? css.onGood : rating === 'useless' ? css.onBad : '') : ''
                        const label = rating === 'useful' ? t('rUseful') : rating === 'neutral' ? t('rNeutral') : t('rUseless')
                        return (
                          <button
                            key={rating}
                            type="button"
                            className={`${css.rateBtn} ${extra}`}
                            disabled={busy}
                            title={label}
                            onClick={() => void rate(row.key, active ? null : rating)}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </span>
                  </td>
                  <td><span className={suggestion.warn ? css.suggestWarn : css.suggestOk}>{suggestion.text}</span></td>
                </tr>
              )
            })}
        </tbody>
      </table>
      <div className={css.hint}>{t('note')}</div>
    </div>
  )
}
