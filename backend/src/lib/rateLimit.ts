import { codesContainer, readDoc } from './cosmos'
import { HttpError } from './http'

// Fixed-window counters, stored beside the sign-in codes (ids are prefixed so they can
// never collide with an email address) and swept by the same Cosmos TTL.
interface CounterDoc {
  id: string
  count: number
  windowStart: number // ms epoch
  ttl: number
}

/** Counts one hit against `key`; throws 429 once more than `max` land inside `windowMs`. */
export async function hitRateLimit(key: string, max: number, windowMs: number, message: string): Promise<void> {
  const id = `limit:${key}`
  const now = Date.now()
  const existing = await readDoc<CounterDoc>(codesContainer(), id)
  const fresh = !existing || now - existing.windowStart >= windowMs
  const doc: CounterDoc = {
    id,
    count: fresh ? 1 : existing.count + 1,
    windowStart: fresh ? now : existing.windowStart,
    ttl: Math.ceil(windowMs / 1000)
  }
  if (doc.count > max) {
    throw new HttpError(429, message, { retryAfter: Math.ceil((doc.windowStart + windowMs - now) / 1000) })
  }
  await codesContainer().items.upsert(doc)
}
