/**
 * Browser shim for `crypto` / `node:crypto`.
 *
 * Some bundled dependencies (uuid@9's node entry) import the Node builtin
 * even though their browser build would be fine. Modern browsers provide
 * `crypto.randomUUID` natively; `randomBytes` is emulated on top of
 * `crypto.getRandomValues`. Both are re-wrapped in arrow functions so they
 * keep working when destructured (node-style callers do `const { randomUUID }
 * = crypto`), which would otherwise lose `this` and throw "Illegal invocation".
 */
const webCrypto = globalThis.crypto as Crypto & {
  randomBytes?: (size: number) => Uint8Array
  randomUUID?: () => string
}

if (webCrypto) {
  if (typeof webCrypto.randomBytes !== 'function') {
    webCrypto.randomBytes = (size: number): Uint8Array => {
      const bytes = new Uint8Array(size)
      webCrypto.getRandomValues(bytes)
      return bytes
    }
  }
  if (typeof webCrypto.randomUUID === 'function') {
    const nativeRandomUUID = webCrypto.randomUUID.bind(webCrypto)
    webCrypto.randomUUID = () => nativeRandomUUID()
  }
}

export default webCrypto as Crypto
