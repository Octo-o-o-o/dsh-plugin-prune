/**
 * Typed client facade over the connection RPC carrier.
 *
 * Community plugins cannot inject their own Remote namespace (it is created
 * by the plugin's own `apply`, so declaring it as a hard dependency would
 * deadlock), and `ctx.get` only resolves services provided in the same
 * scope. The sanctioned path is therefore the connection's shared `/api`
 * channel — the exact carrier every generated Remote face uses underneath —
 * with the gateway's strict descriptors on the Host side routing the
 * endpoints (see `../remote-descriptors.ts`).
 * @module dsh-plugin-prune/client/rpc
 */

import type { UsageRateRequest, UsageReport } from '../types.ts'
import type { InventorySnapshotLike } from './overview.ts'

export interface RpcOutcome<T> {
  readonly ok: boolean
  readonly value: T | null
  readonly message: string | null
}

export interface UsageClient {
  report(): Promise<RpcOutcome<UsageReport>>
  rate(request: UsageRateRequest): Promise<RpcOutcome<{ ok: boolean }>>
  reset(): Promise<RpcOutcome<UsageReport>>
  inventory(): Promise<RpcOutcome<InventorySnapshotLike>>
}

interface RpcResultLike {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly message?: unknown }
}

/** The subset of the connection service this client touches. */
export interface ConnectionRpcLike {
  call(channel: string, endpoint: string, payload: unknown, signal?: unknown): Promise<unknown>
}

export function createUsageClient(connection: ConnectionRpcLike): UsageClient {
  const call = async <T>(endpoint: string, args: Record<string, unknown>): Promise<RpcOutcome<T>> => {
    try {
      const raw = await connection.call('/api', endpoint, { args }) as RpcResultLike
      if (raw !== null && typeof raw === 'object' && raw.ok === true) {
        return { ok: true, value: (raw.value ?? null) as T, message: null }
      }
      const message = raw !== null && typeof raw === 'object' && raw.error !== null && typeof raw.error === 'object'
        ? String((raw.error as { message?: unknown }).message ?? 'remote call failed')
        : 'remote call failed'
      return { ok: false, value: null, message }
    } catch (error) {
      return { ok: false, value: null, message: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    report: () => call<UsageReport>('pluginUsage/report', {}),
    rate: request => call<{ ok: boolean }>('pluginUsage/rate', {
      request: request as unknown as Record<string, unknown>,
    }),
    reset: () => call<UsageReport>('pluginUsage/reset', {}),
    inventory: () => call<InventorySnapshotLike>('pluginInventory/list', {}),
  }
}
