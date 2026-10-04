/**
 * Minimal transactional email adapter. Provider + API key come from env vars; with
 * EMAIL_PROVIDER=none, messages are logged to the server console (handy in development).
 */
import { config } from '../config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; error?: string }> {
  const { provider, apiKey, from } = config.email;
  try {
    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, reply_to: msg.replyTo }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true } : { ok: false, error: `Resend ${res.status}` };
    }
    if (provider === 'postmark') {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: from, To: msg.to, Subject: msg.subject, TextBody: msg.text, ReplyTo: msg.replyTo, MessageStream: 'outbound' }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true } : { ok: false, error: `Postmark ${res.status}` };
    }
    console.info(`[email:dev] To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
