import { app } from '@azure/functions'
import { identitiesContainer, isNotFound, usersContainer } from '../lib/cosmos'
import { route } from '../lib/http'
import { publicUser, requireUser } from '../lib/accounts'
import { issueSession } from '../lib/session'
import { deleteAllScenes } from '../lib/scenes'

// GET /me: who is signed in, plus a fresh session token (sliding expiry).
app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: route('me', async (request) => {
    const user = await requireUser(request)
    return { status: 200, jsonBody: { user: publicUser(user), token: await issueSession(user.id) } }
  })
})

// DELETE /account: removes the user, every sign-in identity that points at it, and all
// saved drawings. Copies kept in the browser are left alone (the client decides).
app.http('accountDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'account',
  handler: route('accountDelete', async (request) => {
    const user = await requireUser(request)
    await deleteAllScenes(user.id)
    for (const id of user.identityIds) {
      await identitiesContainer()
        .item(id, id)
        .delete()
        .catch((err) => {
          if (!isNotFound(err)) throw err
        })
    }
    await usersContainer().item(user.id, user.id).delete()
    return { status: 200, jsonBody: { ok: true } }
  })
})
