import { EmailClient } from '@azure/communication-email'

// Azure Communication Services Email with the free Azure Managed Domain sender
// (DoNotReply@<guid>.azurecomm.net): no domain purchase or DNS setup. Same set-up as Artha.
let client: EmailClient | null = null

function getClient(): EmailClient {
  if (!client) {
    const connectionString = process.env.ACS_CONNECTION_STRING
    if (!connectionString) throw new Error('ACS_CONNECTION_STRING is not configured')
    client = new EmailClient(connectionString)
  }
  return client
}

/** Local development: write codes to the Functions log instead of emailing them. */
export function devLogCodes(): boolean {
  return process.env.DEV_LOG_CODES === 'true'
}

/** Whether codes can be delivered at all (ACS is set up, or dev logging is on). */
export function emailConfigured(): boolean {
  return devLogCodes() || Boolean(process.env.ACS_CONNECTION_STRING && process.env.ACS_SENDER_ADDRESS)
}

export async function sendSignInCode(email: string, code: string, minutes: number): Promise<void> {
  const sender = process.env.ACS_SENDER_ADDRESS
  if (!sender) throw new Error('ACS_SENDER_ADDRESS is not configured')
  const poller = await getClient().beginSend({
    senderAddress: sender,
    content: {
      subject: `${code} is your Drawesome sign-in code`,
      plainText:
        `Your Drawesome sign-in code is ${code}\n\n` +
        `Enter it in Drawesome to sign in. It expires in ${minutes} minutes and works once.\n\n` +
        `If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.`,
      html:
        `<div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1f2937;max-width:480px">` +
        `<p style="font-size:15px">Your Drawesome sign-in code is</p>` +
        `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${code}</p>` +
        `<p style="font-size:15px">Enter it in Drawesome to sign in. It expires in ${minutes} minutes and works once.</p>` +
        `<p style="color:#6b7280;font-size:13px;margin-top:24px">If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.</p>` +
        `</div>`
    },
    recipients: { to: [{ address: email }] }
  })
  await poller.pollUntilDone()
}
