# Drawesome backend

Azure Functions backend for Drawesome's **optional** accounts: passwordless sign-in
(an emailed one-time code, Google, or Microsoft) and syncing drawings across devices.
The whiteboard works without it. When the site is built without `VITE_API_BASE_URL`,
the sign-in button stays hidden and drawings live only in the browser.

It follows the same Azure setup as Artha's backend: Cosmos DB (serverless), Blob
Storage, Azure Communication Services Email, and Key Vault, behind a pay-per-use
Function App.

## How sign-in works

There are no passwords anywhere.

- **Email code.** `POST /auth/email/start` emails a 6-digit code (valid for 10 minutes,
  single use). `POST /auth/email/verify` exchanges it for a session. The first
  successful sign-in creates the account, so there's no separate sign-up step. Codes
  are stored only as an HMAC. Each code allows 5 wrong guesses. Each address can get
  one code every 30 seconds and 5 per hour, and each caller IP can request 20 per hour.
- **Google / Microsoft.** The browser does a standard OpenID Connect request for an ID
  token, with a random `nonce` and `state`, in a popup (falling back to a full-page
  redirect if the popup is blocked). The provider returns to `auth-callback.html`.
  `POST /auth/oidc` verifies the token's signature against the provider's published
  keys, plus its audience, issuer, age and nonce. No client secret is needed.
- **One account per person.** Every sign-in method maps to the same user through
  `identities`. If Google or Microsoft vouch that the address is verified, signing in
  with them reaches the same drawings as an emailed code to that address.
  (A work or school account's `email` is only used when Microsoft marks it verified.)
- **Sessions** are 90-day HS256 tokens. Each visit calls `GET /me`, which hands back a
  fresh token, so regular users stay signed in.

## API

| Method & route | Auth | What it does |
| --- | --- | --- |
| `GET /auth/config` | – | Which sign-in options are on, plus the public Google/Microsoft client ids |
| `POST /auth/email/start` `{ email }` | – | Emails a sign-in code |
| `POST /auth/email/verify` `{ email, code }` | – | Code → `{ token, user }` |
| `POST /auth/oidc` `{ provider, idToken, nonce }` | – | Google/Microsoft ID token → `{ token, user }` |
| `GET /me` | ✓ | Current user + a refreshed token |
| `DELETE /account` | ✓ | Deletes the user, their sign-in identities and every saved drawing |
| `GET /scenes` | ✓ | `[{ id, name, updatedAt, deleted }]`, read from blob metadata (no downloads) |
| `GET /scenes/{id}` | ✓ | One drawing |
| `PUT /scenes/{id}` `{ name, updatedAt, elements }` | ✓ | Saves a drawing; `409 { remote }` if the stored copy is newer |
| `DELETE /scenes/{id}?deletedAt=` | ✓ | Replaces a drawing with a tombstone; `409` if it was edited later |

### Sync model

The browser is where editing happens (auto-save to `localStorage`, works offline);
the account is the backup and the bridge between devices. Each scene carries
`updatedAt`, the time of its last real edit (opening a scene doesn't change it).
Conflicts are last-write-wins per scene. An ETag condition on every write means two
devices saving at once can't both "win". Deletions leave a small tombstone, so
another device removes its copy instead of uploading it again. Tombstones are pruned
after 180 days.

The browser keeps the 10 most recently edited scenes. Older ones stay in the account
and are listed under **In your account** in the Recents panel. A scene that isn't
safely in the account is never dropped from the browser to make room. The client side
lives in `src/lib/cloud/sync.ts`.

### Data model

Cosmos DB, database `drawesome`. Every access is a point read by id:

- `users` (`/id`): `{ id, email?, name?, providers[], identityIds[], createdAt, lastSignInAt }`
- `identities` (`/id`): `{ id: "email:<addr>" | "google:<sub>" | "microsoft:<tid>:<oid>", userId }`
- `codes` (`/id`, TTL on): pending sign-in codes (`id` = email) and rate-limit counters
  (`id` = `limit:…`). Every document sets its own `ttl`, so Cosmos sweeps them itself.

Blob Storage, container `scenes`: one blob per drawing, `<userId>/<sceneId>.json`.
The name, edit time and deleted flag are stored as blob metadata.

## Setting up Google and Microsoft

Both are optional. Leave a client id empty and its button doesn't show. Register
these redirect URIs **exactly** (add or replace origins for your own deployment):

```
https://anandd512.github.io/drawesome/auth-callback.html
http://localhost:5173/auth-callback.html
```

**Google.** In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
go to **Create credentials → OAuth client ID → Web application**.

- *Authorized JavaScript origins:* `https://anandd512.github.io` and `http://localhost:5173`
- *Authorized redirect URIs:* the two URLs above
- Set up the OAuth consent screen with the `openid`, `email` and `profile` scopes
  (non-sensitive, so no verification review is needed). Publish it so anyone can sign in.
- Copy the **Client ID**. You don't need the client secret.

**Microsoft.** In the [Entra admin center](https://entra.microsoft.com), go to
**App registrations → New registration**.

- *Supported account types:* **Accounts in any organizational directory and personal
  Microsoft accounts**
- **Authentication → Add a platform → Web**: add the two redirect URIs, and under
  *Implicit grant and hybrid flows* tick **ID tokens**
- **Token configuration → Add optional claim → ID**: `email` and `xms_edov`. Work or
  school accounts then send the email address and whether the organisation verified it.
- Copy the **Application (client) ID**. You don't need a client secret.

## Deploying to Azure

Prerequisites: `az login`, and [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local).
The deploying account needs rights to create role assignments (Owner, or User Access
Administrator plus Contributor) on the resource group.

```bash
cd backend

# 1. Resource group. Pick a region close to your users.
az group create --name drawesome-rg --location centralindia

# 2. Everything else: Storage, Cosmos DB, ACS Email + managed domain, Key Vault,
#    App Insights, and a Flex Consumption Function App (Node 22) wired together with
#    managed identity. namePrefix: 3–14 letters/digits, globally unique-ish.
az deployment group create --resource-group drawesome-rg --template-file infra/main.bicep \
  --parameters namePrefix=drawesomead \
               googleClientId=<google client id> \
               microsoftClientId=<microsoft application id> \
               deployerPrincipalId=$(az ad signed-in-user show --query id -o tsv)

# 3. The one secret you set by hand: the session signing key. Changing it later
#    signs everyone out. (The ACS connection string is written by the template.)
az keyvault secret set --vault-name drawesomead-kv --name session-signing-key \
  --value "$(openssl rand -base64 48)"

# 4. Build and publish the code. (--javascript because the code is already compiled,
#    and Core Tools can't infer the runtime without a local.settings.json.)
npm ci && npm run build
func azure functionapp publish drawesomead-func --javascript

# 5. Point the site at the API, using the URL from the deployment output:
az deployment group show --resource-group drawesome-rg --name main --query properties.outputs.apiBaseUrl.value -o tsv
#    GitHub → Settings → Secrets and variables → Actions → Variables:
#    add DRAWESOME_API_URL = that URL, then re-run "Deploy to GitHub Pages".
```

Notes:

- `allowedOrigins` (a template parameter) controls CORS. It defaults to the GitHub
  Pages origin and `http://localhost:5173`.
- `siteConfig.appSettings` in the template **replaces** the whole app settings list
  on every deployment. Change settings in the template, not with
  `az functionapp config appsettings set`, or the next deployment will undo them.
  Flex Consumption keeps the code package in its own deployment container, so
  redeploying infra doesn't unpublish the functions the way it did on Artha's
  Linux Consumption plan.
- The sender address is `DoNotReply@<guid>.azurecomm.net` (Azure Managed Domain, no
  DNS setup). The template reads it from the domain resource. If a first deployment
  ever races the domain's provisioning and leaves `ACS_SENDER_ADDRESS` as
  `DoNotReply@`, run step 2 again.
- Rename or rotate the Google/Microsoft client ids by re-running step 2 with new values.

### Cost

At a personal app's scale everything stays inside free grants or costs cents:
Functions Flex Consumption (monthly free executions), Cosmos DB serverless
(pay per request, a handful of point reads per sign-in and sync), Storage (a few KB per
drawing), ACS Email (fractions of a cent per email), Key Vault (cents). Log Analytics
ingestion is the line to watch if you turn on verbose logging.

## Local development

1. Install Functions Core Tools v4 and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
   (`npm i -g azurite`, then run `azurite` in its own terminal).
2. Cosmos DB: use the [Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/emulator)
   or a real account. Create database `drawesome` with containers `users`, `identities`
   and `codes` (partition key `/id`, and TTL **on** for `codes`).
3. `cp local.settings.json.example local.settings.json` and fill it in.
   `DEV_LOG_CODES=true` writes sign-in codes to the terminal instead of emailing them,
   so you don't need ACS locally.
4. `npm install`, then `npm start`. The API serves at `http://localhost:7071/api`, with
   CORS allowed for the Vite dev server.
5. In the repo root, create `.env.local` with `VITE_API_BASE_URL=http://localhost:7071/api`
   and run `npm run dev`.

Google and Microsoft sign-in work locally once `http://localhost:5173/auth-callback.html`
is registered with them (see above).
