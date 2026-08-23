/**
 * Document parsing for knowledge-base uploads (V3.1).
 * - .txt / .md are read as UTF-8 text;
 * - .pdf is parsed with pdf-parse (declared dependency) and its text is
 *   extracted for chunking/indexing.
 *
 * pdf-parse 1.1.1 runs a top-level debug branch when `module.parent` is
 * falsy — which is ALWAYS the case under ESM — and then tries to read its own
 * test fixture, throwing ENOENT. Loading it through createRequire (a real CJS
 * require) keeps `module.parent` set, so the debug branch is skipped.
 */
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

type PdfParseFn = (buffer: Buffer) => Promise<{ text: string }>

export async function extractDocumentText(fileName: string, buffer: Buffer): Promise<string> {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') {
    const pdfParse = nodeRequire('pdf-parse') as PdfParseFn
    const data = await pdfParse(buffer)
    return data.text ?? ''
  }
  // txt / md (and any other text-ish upload) → utf-8.
  return buffer.toString('utf8')
}
