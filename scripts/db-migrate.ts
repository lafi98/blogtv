import { getDb, migrate } from '../src/lib/db';
const ran = migrate(getDb());
console.log(ran.length ? `Applied migrations: ${ran.join(', ')}` : 'Database schema is up to date.');
