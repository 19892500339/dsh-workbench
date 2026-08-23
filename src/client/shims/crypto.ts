/**
 * Browser shim for `crypto` / `node:crypto`.
 *
 * Some bundled dependencies (uuid@9's node entry) import the Node builtin
 * even though their browser build would be fine. Modern browsers provide
 * `crypto.randomUUID` natively; `randomBytes` is emulated on top of
 * `crypto.getRandomValues` so node-style callers keep working.
 */
const webCrypto = globalThis.crypto as Crypto & { randomBytes?: (size: number) => Uint8Array }

if (webCrypto && typeof webCrypto.randomBytes !== 'function') {
  webCrypto.randomBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size)
    webCrypto.getRandomValues(bytes)
    return bytes
  }
}

export default webCrypto as Crypto
