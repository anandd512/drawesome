import { HttpHandler, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

/** Thrown anywhere inside a handler to send a specific status + message to the client. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

// Scenes can carry pasted images as data URLs, so allow a few MB. The browser's own
// localStorage quota (~5 MB) caps a scene well below this in practice.
export const MAX_BODY_BYTES = 8 * 1024 * 1024

export async function readJson<T>(request: HttpRequest): Promise<T> {
  const tooLarge = new HttpError(413, 'This drawing is too large to save to your account')
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw tooLarge
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw tooLarge
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object') throw new Error('not an object')
    return value as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

/** Wraps a handler so every function answers JSON errors the same way and never leaks internals. */
export function route(name: string, fn: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>): HttpHandler {
  return async (request, context) => {
    try {
      const res = await fn(request, context)
      return { ...res, headers: { 'Cache-Control': 'no-store', ...(res.headers as Record<string, string> | undefined) } }
    } catch (err) {
      if (err instanceof HttpError) {
        return { status: err.status, headers: { 'Cache-Control': 'no-store' }, jsonBody: { error: err.message, ...err.extra } }
      }
      context.error(`${name} failed`, err)
      return { status: 500, headers: { 'Cache-Control': 'no-store' }, jsonBody: { error: 'Something went wrong on our side. Please try again.' } }
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  return email
}

/** Best-effort caller IP. Azure's front end puts it first in X-Forwarded-For, sometimes with a port. */
export function clientIp(request: HttpRequest): string {
  const first = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  if (!first) return 'unknown'
  if (first.startsWith('[')) return first.slice(1, first.indexOf(']')) // "[v6]:port"
  const colons = first.split(':').length - 1
  return colons === 1 ? first.split(':')[0] : first // "v4:port" → v4; a bare v6 address stays as is
}
