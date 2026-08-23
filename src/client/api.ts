/**
 * Browser-side RPC client for the /workbench/api host surface.
 * Mirror of the wire pattern used by shipped hybrid plugins ({ok,value} envelope).
 */
export class WorkbenchApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function call<T>(method: string, payload: unknown = {}): Promise<T> {
  const response = await fetch(`/workbench/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const parsed: unknown = await response.json().catch(() => null)
  if (!response.ok || parsed === null || typeof parsed !== 'object' || (parsed as { ok?: boolean }).ok !== true) {
    const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error
    throw new WorkbenchApiError(err?.code ?? 'http', err?.message ?? `HTTP ${response.status}`)
  }
  return (parsed as { value: T }).value
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
