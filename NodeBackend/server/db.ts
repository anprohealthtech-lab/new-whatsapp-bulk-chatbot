import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '@shared/schema';

let db: any = null;
if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL);
  db = drizzle(sql, { schema });
} else {
  // Dummy db for non-database mode
  db = {
    query: async () => { throw new Error('Database not configured'); },
    // add more dummy methods if needed
  };
}
export { db };
export type Database = typeof db;