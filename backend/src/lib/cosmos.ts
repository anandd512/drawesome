import { Container, CosmosClient, Database } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'

// Cosmos DB (serverless) holds the small, point-read records: users, the sign-in
// identities that map to them, pending email codes and rate-limit counters. Every
// access is a point read/write by id, never a cross-partition query. Drawings are
// larger and live in Blob Storage instead (see scenes.ts).
//
// In Azure the Function App signs in with its managed identity (COSMOS_ENDPOINT, no
// key; infra/main.bicep grants it the built-in data contributor role). Locally a
// connection string is simpler, so COSMOS_CONNECTION_STRING wins when it is set.
let database: Database | null = null

function getDatabase(): Database {
  if (!database) {
    const connectionString = process.env.COSMOS_CONNECTION_STRING
    const endpoint = process.env.COSMOS_ENDPOINT
    let client: CosmosClient
    if (connectionString) client = new CosmosClient(connectionString)
    else if (endpoint) client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() })
    else throw new Error('COSMOS_ENDPOINT (or COSMOS_CONNECTION_STRING) is not configured')
    database = client.database(process.env.COSMOS_DATABASE ?? 'drawesome')
  }
  return database
}

export const usersContainer = (): Container => getDatabase().container('users')
export const identitiesContainer = (): Container => getDatabase().container('identities')
export const codesContainer = (): Container => getDatabase().container('codes')

export type Provider = 'email' | 'google' | 'microsoft'

export interface UserDoc {
  id: string // user id (uuid), also the partition key
  email?: string // a verified email address, if we have one
  name?: string
  providers: Provider[] // sign-in methods this user has used
  identityIds: string[] // ids of every IdentityDoc pointing here (so account deletion can remove them)
  createdAt: string
  lastSignInAt: string
}

/**
 * One document per way of proving who you are, pointing at a user:
 *   email:<address>                 proven by an emailed code, or by Google/Microsoft vouching for the address
 *   google:<sub>                    a Google account
 *   microsoft:<tenant id>:<oid>     a Microsoft personal, work or school account
 * Signing in with Google as alice@example.com therefore lands on the same user as
 * signing in with an emailed code to alice@example.com.
 */
export interface IdentityDoc {
  id: string // partition key
  userId: string
  createdAt: string
}

/** A pending one-time sign-in code (id = the email address). */
export interface CodeDoc {
  id: string
  codeHash: string | null // HMAC of the code; null once used, kept so the rate-limit counters survive
  expiresAt: number // ms epoch
  attempts: number // wrong guesses against the current code
  sends: number // codes sent in the current rate-limit window
  windowStart: number // ms epoch
  lastSentAt: number // ms epoch
  ttl: number // seconds; Cosmos deletes the document this long after its last write
}

export function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 404
}

export function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 409
}

export async function readDoc<T>(container: Container, id: string): Promise<T | undefined> {
  try {
    const { resource } = await container.item(id, id).read()
    return (resource as T | undefined) ?? undefined
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}
