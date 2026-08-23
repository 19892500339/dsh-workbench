/**
 * Browser shim for `crypto` / `node:crypto`.
 *
 * Some bundled dependencies (uuid@9's node entry) import the Node builtin
 * even though their browser build would be fine. In every modern browser the
 * Web Crypto API provides `randomUUID`, which is all uuid needs here, so we
 * alias the specifier to this tiny module instead of fighting the resolver.
 */
export default globalThis.crypto as Crypto
