import { HttpRequest } from '@azure/functions'
import { SignJWT, jwtVerify } from 'jose'
import { HttpError } from './http'

// Sessions are signed tokens (HS256) holding only the user id. The browser keeps one in
// localStorage and sends it as a bearer token. GET /api/me hands back a fresh one, so
// anyone who opens Drawesome at least every SESSION_DAYS stays signed in.
const SESSION_DAYS = 90
const ISSUER = 'drawesome'

let key: Uint8Array | null = null
export function signingKey(): Uint8Array {
  if (!key) {
    const secret = process.env.SESSION_SIGNING_KEY
    if (!secret || secret.length < 32) throw new Error('SESSION_SIGNING_KEY is not configured (needs 32+ characters)')
    key = new TextEncoder().encode(secret)
  }
  return key
}

export async function issueSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(signingKey())
}

export async function requireUserId(request: HttpRequest): Promise<string> {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in')
  try {
    const { payload } = await jwtVerify(header.slice(7), signingKey(), { issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no subject')
    return payload.sub
  } catch {
    throw new HttpError(401, 'Your sign-in has expired. Please sign in again.')
  }
}
