import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'
import { HttpError } from './http'

// Verifies the ID token Google or Microsoft returned to the browser. The browser gets
// it with a standard OpenID Connect redirect (response_type=id_token + a nonce), so no
// client secret is needed anywhere. We check the signature against the provider's
// published keys, the audience (our client id), the issuer, freshness and the nonce.

export interface VerifiedIdentity {
  identityId: string // e.g. google:<sub>
  email?: string // only when the provider vouches that the address is verified
  name?: string
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const MICROSOFT_JWKS = createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'))
// The tenant id that personal Microsoft accounts (outlook.com, hotmail.com, live.com …) sign in under.
const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TOKEN_AGE = '10m'

export const googleClientId = (): string | undefined => process.env.GOOGLE_CLIENT_ID || undefined
export const microsoftClientId = (): string | undefined => process.env.MICROSOFT_CLIENT_ID || undefined

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function checkNonce(payload: JWTPayload, nonce: string): void {
  if (!nonce || payload.nonce !== nonce) throw new HttpError(401, 'Sign-in could not be verified. Please try again.')
}

export async function verifyGoogle(idToken: string, nonce: string): Promise<VerifiedIdentity> {
  const audience = googleClientId()
  if (!audience) throw new HttpError(400, 'Google sign-in is not set up')
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      audience,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      maxTokenAge: MAX_TOKEN_AGE
    }))
  } catch {
    throw new HttpError(401, 'Google sign-in could not be verified. Please try again.')
  }
  checkNonce(payload, nonce)
  const sub = str(payload.sub)
  if (!sub) throw new HttpError(401, 'Google sign-in could not be verified. Please try again.')
  const email = payload.email_verified === true ? str(payload.email)?.toLowerCase() : undefined
  return { identityId: `google:${sub}`, email, name: str(payload.name) }
}

export async function verifyMicrosoft(idToken: string, nonce: string): Promise<VerifiedIdentity> {
  const audience = microsoftClientId()
  if (!audience) throw new HttpError(400, 'Microsoft sign-in is not set up')
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(idToken, MICROSOFT_JWKS, { audience, maxTokenAge: MAX_TOKEN_AGE }))
  } catch {
    throw new HttpError(401, 'Microsoft sign-in could not be verified. Please try again.')
  }
  // The /common endpoint serves every tenant, so the issuer has to match the token's own tenant.
  const tid = str(payload.tid)
  if (!tid || !GUID_RE.test(tid) || payload.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
    throw new HttpError(401, 'Microsoft sign-in could not be verified. Please try again.')
  }
  checkNonce(payload, nonce)
  const oid = str(payload.oid) ?? str(payload.sub)
  if (!oid) throw new HttpError(401, 'Microsoft sign-in could not be verified. Please try again.')

  // Work and school tenants can put any address in `email` without proving it, so only
  // use it to link accounts when Microsoft says it is verified: always for personal
  // accounts, and for organisations when the optional `xms_edov` claim is true.
  // Otherwise the Microsoft account still works; it just isn't linked by email.
  const rawEmail = str(payload.email)?.toLowerCase()
  const verified = tid === MICROSOFT_CONSUMER_TENANT || payload.xms_edov === true || payload.xms_edov === 'true'
  return { identityId: `microsoft:${tid}:${oid}`, email: verified ? rawEmail : undefined, name: str(payload.name) }
}
