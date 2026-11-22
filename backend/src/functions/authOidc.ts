import { app } from '@azure/functions'
import { HttpError, readJson, route } from '../lib/http'
import { googleClientId, microsoftClientId, verifyGoogle, verifyMicrosoft } from '../lib/idp'
import { emailConfigured } from '../lib/email'
import { publicUser, signIn } from '../lib/accounts'
import { issueSession } from '../lib/session'

// GET /auth/config tells the page which sign-in options to show and which client ids to
// use. Client ids are public by design; serving them from here means the static site
// only needs to know the API address.
app.http('authConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/config',
  handler: route('authConfig', async () => ({
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=300' },
    jsonBody: { email: emailConfigured(), google: googleClientId() ?? null, microsoft: microsoftClientId() ?? null }
  }))
})

// POST /auth/oidc { provider, idToken, nonce } exchanges a Google or Microsoft ID token
// (obtained by the browser from the provider's sign-in page) for a Drawesome session.
app.http('authOidc', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/oidc',
  handler: route('authOidc', async (request) => {
    const body = await readJson<{ provider?: unknown; idToken?: unknown; nonce?: unknown }>(request)
    const idToken = typeof body.idToken === 'string' ? body.idToken : ''
    const nonce = typeof body.nonce === 'string' ? body.nonce : ''
    if (!idToken || idToken.length > 16_000) throw new HttpError(400, 'Missing sign-in token')

    const provider = body.provider
    if (provider !== 'google' && provider !== 'microsoft') throw new HttpError(400, 'Unknown sign-in provider')
    const verified = provider === 'google' ? await verifyGoogle(idToken, nonce) : await verifyMicrosoft(idToken, nonce)

    const user = await signIn({ provider, ...verified })
    return { status: 200, jsonBody: { token: await issueSession(user.id), user: publicUser(user) } }
  })
})
