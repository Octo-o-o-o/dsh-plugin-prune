/**
 * Shared Remote invocation descriptors for the `pluginUsage` namespace.
 *
 * Used on BOTH planes:
 *  - Host: registered into `ctx.typert` as a generated-style contribution, so
 *    the api-gateway claims and dispatches `pluginUsage/*` endpoints through
 *    its strict local registry. This is the robust path: `@Remote` decorator
 *    markers live in a module-local WeakMap and can split when the profile
 *    resolves a second copy of `dsh-typert-protocol`.
 *  - Client: mounted into `ctx.remote.$mount` to install the namespace face.
 *
 * Codecs are strict with identity parsing — the Host validates business
 * values, the boundary trusts the JSON shape.
 * @module dsh-plugin-prune/remote-descriptors
 */

import type { InvocationDescriptor, TypertCodec, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'

export const REMOTE_NAMESPACE = 'pluginUsage'

const identitySchema: TypertSchema<unknown> = {
  parse: (value: unknown) => value,
}

const identityCodec: TypertCodec = {
  mode: 'strict',
  typeSymbol: 'json',
  schema: identitySchema,
}

/** Wire descriptors shared by the Host contribution and the Client mount. */
export const USAGE_DESCRIPTORS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-plugin-prune/report',
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method: 'report',
    invocation: { kind: 'direct' },
    parameters: [],
    result: identityCodec,
  },
  {
    id: 'dsh-plugin-prune/rate',
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method: 'rate',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: identityCodec,
    }],
    result: identityCodec,
  },
  {
    id: 'dsh-plugin-prune/reset',
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method: 'reset',
    invocation: { kind: 'direct' },
    parameters: [],
    result: identityCodec,
  },
]
