import { getDb, nowIso } from '../db';

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  subject: string;
  body: string;
  status: 'new' | 'read' | 'archived';
  createdAt: string;
}

export function insertMessage(m: { name: string; email: string; subject: string; body: string }): number {
  const res = getDb()
    .prepare('INSERT INTO messages (name, email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(m.name, m.email, m.subject, m.body, nowIso());
  return Number(res.lastInsertRowid);
}

export function listMessages(): ContactMessage[] {
  return (getDb().prepare("SELECT * FROM messages WHERE status != 'archived' ORDER BY id DESC LIMIT 500").all() as {
    id: number;
    name: string;
    email: string;
    subject: string;
    body: string;
    status: ContactMessage['status'];
    created_at: string;
  }[]).map((r) => ({ ...r, createdAt: r.created_at }));
}

export function setMessageStatus(id: number, status: ContactMessage['status']) {
  getDb().prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
}

export function deleteMessage(id: number) {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
}

export function countNewMessages(): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE status = 'new'").get() as { n: number }).n;
}
