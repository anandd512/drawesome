import { randomUUID } from 'crypto'
import { HttpRequest } from '@azure/functions'
import { identitiesContainer, IdentityDoc, isConflict, Provider, readDoc, UserDoc, usersContainer } from './cosmos'
import { HttpError } from './http'
import { requireUserId } from './session'

/** The signed-in user, checked against the database (so deleted accounts are rejected). */
export async function requireUser(request: HttpRequest): Promise<UserDoc> {
  const userId = await requireUserId(request)
  const user = await readDoc<UserDoc>(usersContainer(), userId)
  if (!user) throw new HttpError(401, 'This account no longer exists. Please sign in again.')
  return user
}

export interface PublicUser {
  id: string
  email: string | null
  name: string | null
  providers: Provider[]
}

export const publicUser = (u: UserDoc): PublicUser => ({
  id: u.id,
  email: u.email ?? null,
  name: u.name ?? null,
  providers: u.providers
})

export interface SignInClaims {
  provider: Provider
  identityId: string // email:<addr>, google:<sub>, microsoft:<tid>:<oid>
  email?: string // verified address, if any
  name?: string
}

async function linkIdentity(id: string, userId: string): Promise<string> {
  const doc: IdentityDoc = { id, userId, createdAt: new Date().toISOString() }
  try {
    await identitiesContainer().items.create(doc)
    return userId
  } catch (err) {
    // Someone (probably a second tab) linked it a moment ago. Use whichever user won.
    if (!isConflict(err)) throw err
    const existing = await readDoc<IdentityDoc>(identitiesContainer(), id)
    return existing?.userId ?? userId
  }
}

/**
 * Finds the user for this sign-in, or creates one. Lookup order: the provider identity
 * itself, then the verified email address, so Google, Microsoft and emailed codes for
 * the same address all reach the same drawings. Missing identity links are added.
 */
export async function signIn(claims: SignInClaims): Promise<UserDoc> {
  const identities = identitiesContainer()
  const emailId = claims.email ? `email:${claims.email}` : undefined

  let userId = (await readDoc<IdentityDoc>(identities, claims.identityId))?.userId
  if (!userId && emailId && emailId !== claims.identityId) userId = (await readDoc<IdentityDoc>(identities, emailId))?.userId

  const now = new Date().toISOString()
  let user = userId ? await readDoc<UserDoc>(usersContainer(), userId) : undefined
  if (!user) {
    // New user (or an identity left behind by a deleted account).
    user = {
      id: randomUUID(),
      email: claims.email,
      name: claims.name,
      providers: [],
      identityIds: [],
      createdAt: now,
      lastSignInAt: now
    }
  }

  for (const id of [claims.identityId, emailId]) {
    if (!id || user.identityIds.includes(id)) continue
    const existing = await readDoc<IdentityDoc>(identities, id)
    if (existing && existing.userId !== user.id) {
      const owner = await readDoc<UserDoc>(usersContainer(), existing.userId)
      if (owner) continue // belongs to another live account; leave it alone
      await identities.item(id, id).replace({ ...existing, userId: user.id })
    } else if (!existing) {
      const winner = await linkIdentity(id, user.id)
      if (winner !== user.id) continue
    }
    user.identityIds.push(id)
  }

  if (!user.providers.includes(claims.provider)) user.providers.push(claims.provider)
  if (!user.email && claims.email) user.email = claims.email
  if (!user.name && claims.name) user.name = claims.name
  user.lastSignInAt = now
  await usersContainer().items.upsert(user)
  return user
}
