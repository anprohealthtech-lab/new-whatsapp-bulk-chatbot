import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../shared/schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  try {
    console.log('🔄 Testing Neon PostgreSQL connection...');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }

    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql, { schema });

    // Test basic connection
    const result = await sql`SELECT NOW() as current_time, version() as postgres_version`;
    console.log('✅ Database connection successful!');
    console.log('📅 Current time:', result[0].current_time);
    console.log('🗄️ PostgreSQL version:', result[0].postgres_version);

    // Test table existence
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `;
    
    console.log('\n📋 Available tables:');
    tables.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });

    // Test organizations table
    const orgCount = await db.select().from(schema.organizations);
    console.log(`\n🏢 Organizations count: ${orgCount.length}`);

    // Test users table
    const userCount = await db.select().from(schema.users);
    console.log(`👥 Users count: ${userCount.length}`);

    console.log('\n🎉 Database is ready for multi-user WhatsApp LIMS!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

testConnection()
  .then(() => {
    console.log('✅ Connection test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Connection test failed:', error);
    process.exit(1);
  });