/**
 * Create an admin user. Credentials come from flags or environment variables — never from code.
 *   npm run admin:create -- --email you@example.com --name "Your Name"
 * The password is read from ADMIN_PASSWORD or prompted for (input hidden).
 */
import readline from 'node:readline';
import { createUser } from '../src/lib/auth/session';
import { getDb } from '../src/lib/db';
import { arg } from './_bootstrap';

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => {
    if (s.includes(question)) out.output.write(s);
  };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); }));
}

const email = arg('email') || process.env.ADMIN_EMAIL;
const name = arg('name') || process.env.ADMIN_NAME || 'Admin';
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run admin:create -- --email you@example.com [--name "Your Name"]  (password via ADMIN_PASSWORD or prompt)');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD || (await promptHidden('Password (12+ characters): '));
const exists = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (exists) {
  console.error(`A user with email ${email} already exists.`);
  process.exit(1);
}
try {
  const id = createUser(email, name, password, 'admin');
  console.log(`Created admin user #${id} (${email}). Sign in at /admin/login.`);
} catch (err) {
  console.error('Could not create user:', (err as Error).message);
  process.exit(1);
}
