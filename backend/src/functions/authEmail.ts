import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { app } from '@azure/functions'
import { CodeDoc, codesContainer, readDoc } from '../lib/cosmos'
import { devLogCodes, emailConfigured, sendSignInCode } from '../lib/email'
import { clientIp, HttpError, normalizeEmail, readJson, route } from '../lib/http'
import { hitRateLimit } from '../lib/rateLimit'
import { publicUser, signIn } from '../lib/accounts'
import { issueSession, signingKey } from '../lib/session'

// Passwordless email sign-in: POST /auth/email/start sends a 6-digit code, and
// POST /auth/email/verify exchanges it for a session. The first successful sign-in
// for an address creates the account, so there is no separate "register" step and
// no password anywhere.
const CODE_MINUTES = 10
const RESEND_AFTER_MS = 30_000 // at most one code per address every 30 seconds…
const WINDOW_MS = 60 * 60_000
const MAX_SENDS_PER_WINDOW = 5 // …five per address per hour…
const MAX_SENDS_PER_IP = 20 // …and twenty per caller per hour, so nobody can mail-bomb a list of strangers
const MAX_ATTEMPTS = 5 // wrong guesses before the code is thrown away
const DOC_TTL_SECONDS = 60 * 60 // Cosmos removes the record an hour after the last write

// Codes are stored as an HMAC keyed with the server secret, never in plain text.
function hashCode(email: string, code: string): string {
  return createHmac('sha256', signingKey()).update(`${email}:${code}`).digest('hex')
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && timingSafeEqual(x, y)
}

app.http('authEmailStart', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/email/start',
  handler: route('authEmailStart', async (request, context) => {
    if (!emailConfigured()) throw new HttpError(503, 'Email sign-in is not available right now')
    const body = await readJson<{ email?: unknown }>(request)
    const email = normalizeEmail(body.email)
    const now = Date.now()

    const existing = await readDoc<CodeDoc>(codesContainer(), email)
    let sends = 1
    let windowStart = now
    if (existing) {
      const wait = existing.lastSentAt + RESEND_AFTER_MS - now
      if (wait > 0) throw new HttpError(429, 'Please wait a few seconds before asking for another code', { retryAfter: Math.ceil(wait / 1000) })
      if (now - existing.windowStart < WINDOW_MS) {
        if (existing.sends >= MAX_SENDS_PER_WINDOW) {
          const retryAfter = Math.ceil((existing.windowStart + WINDOW_MS - now) / 1000)
          throw new HttpError(429, 'Too many codes requested for this address. Try again later.', { retryAfter })
        }
        sends = existing.sends + 1
        windowStart = existing.windowStart
      }
    }
    await hitRateLimit(`ip:${clientIp(request)}`, MAX_SENDS_PER_IP, WINDOW_MS, 'Too many codes requested from this network. Try again later.')

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const doc: CodeDoc = {
      id: email,
      codeHash: hashCode(email, code),
      expiresAt: now + CODE_MINUTES * 60_000,
      attempts: 0,
      sends,
      windowStart,
      lastSentAt: now,
      ttl: DOC_TTL_SECONDS
    }
    await codesContainer().items.upsert(doc)
    if (devLogCodes()) context.log(`[dev] sign-in code for ${email}: ${code}`)
    else await sendSignInCode(email, code, CODE_MINUTES)

    return { status: 200, jsonBody: { ok: true, expiresInMinutes: CODE_MINUTES, resendAfter: RESEND_AFTER_MS / 1000 } }
  })
})

app.http('authEmailVerify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/email/verify',
  handler: route('authEmailVerify', async (request) => {
    const body = await readJson<{ email?: unknown; code?: unknown }>(request)
    const email = normalizeEmail(body.email)
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
    if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code from the email')

    const container = codesContainer()
    const doc = await readDoc<CodeDoc>(container, email)
    // One message for "no code", "expired" and "used up", so the response reveals nothing extra.
    const invalid = new HttpError(401, 'That code has expired. Ask for a new one.')
    if (!doc || !doc.codeHash || doc.expiresAt < Date.now() || doc.attempts >= MAX_ATTEMPTS) throw invalid

    if (!sameHash(doc.codeHash, hashCode(email, code))) {
      const attempts = doc.attempts + 1
      const left = MAX_ATTEMPTS - attempts
      await container.items.upsert({ ...doc, attempts, codeHash: left > 0 ? doc.codeHash : null })
      if (left <= 0) throw invalid
      throw new HttpError(401, `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { attemptsLeft: left })
    }

    // Used: clear the code but keep the rate-limit counters until the TTL removes the record.
    await container.items.upsert({ ...doc, codeHash: null })
    const user = await signIn({ provider: 'email', identityId: `email:${email}`, email })
    return { status: 200, jsonBody: { token: await issueSession(user.id), user: publicUser(user) } }
  })
})
