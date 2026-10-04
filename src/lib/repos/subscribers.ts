import { getDb, nowIso } from '../db';

export interface Subscriber {
  id: number;
  email: string;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  createdAt: string;
  confirmedAt: string | null;
}

export function findSubscriber(email: string) {
  return getDb().prepare('SELECT id, email, status FROM subscribers WHERE email = ?').get(email) as
    | { id: number; email: string; status: Subscriber['status'] }
    | undefined;
}

export function upsertPendingSubscriber(email: string, tokenHash: string, consentText: string) {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO subscribers (email, status, token_hash, consent_text, created_at) VALUES (?, 'pending', ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'pending' END,
         token_hash = excluded.token_hash, consent_text = excluded.consent_text`,
    )
    .run(email, tokenHash, consentText, now);
}

export function confirmSubscriber(tokenHash: string): boolean {
  const res = getDb()
    .prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE token_hash = ? AND status = 'pending'")
    .run(nowIso(), tokenHash);
  return res.changes > 0;
}

export function unsubscribe(tokenHash: string): boolean {
  const res = getDb()
    .prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE token_hash = ? AND status != 'unsubscribed'")
    .run(nowIso(), tokenHash);
  return res.changes > 0;
}

export function listSubscribers(): Subscriber[] {
  return (getDb()
    .prepare('SELECT id, email, status, created_at, confirmed_at FROM subscribers ORDER BY id DESC LIMIT 1000')
    .all() as { id: number; email: string; status: Subscriber['status']; created_at: string; confirmed_at: string | null }[]).map((r) => ({
    id: r.id,
    email: r.email,
    status: r.status,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  }));
}

export function deleteSubscriber(id: number) {
  getDb().prepare('DELETE FROM subscribers WHERE id = ?').run(id);
}
