/**
 * Minimal type declaration for pdf-parse (1.1.1 ships no types).
 */
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    version: string
  }
  const pdfParse: (buffer: Buffer) => Promise<PdfParseResult>
  export default pdfParse
}
