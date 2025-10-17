import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../shared/schema.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }

    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql, { schema });

    // Create default organization
    const [defaultOrg] = await db.insert(schema.organizations)
      .values({
        name: 'LIMS Healthcare',
        subscriptionTier: 'premium',
        maxSessions: 10,
        maxUsersPerOrg: 50,
        isActive: true,
      })
      .returning();

    console.log('✅ Default organization created:', defaultOrg.name);

    // Create admin user (password will be hashed on first login)
    const [adminUser] = await db.insert(schema.users)
      .values({
        username: 'admin',
        email: 'admin@lims.local',
        passwordHash: '$2a$10$dummy.hash.will.be.replaced.on.first.login',
        role: 'admin',
        organizationId: defaultOrg.id,
        isActive: true,
        sessionPreferences: {
          defaultStrategy: 'always_on',
          autoReconnect: true,
          notifications: true,
        },
      })
      .returning();

    console.log('✅ Admin user created:', adminUser.username);

    // Create manager user
    const [managerUser] = await db.insert(schema.users)
      .values({
        username: 'manager',
        email: 'manager@lims.local',
        passwordHash: '$2a$10$dummy.hash.will.be.replaced.on.first.login',
        role: 'manager',
        organizationId: defaultOrg.id,
        isActive: true,
        sessionPreferences: {
          defaultStrategy: 'business_hours',
          autoReconnect: true,
          notifications: true,
        },
      })
      .returning();

    console.log('✅ Manager user created:', managerUser.username);

    // Create regular user
    const [regularUser] = await db.insert(schema.users)
      .values({
        username: 'testuser',
        email: 'user@lims.local',
        passwordHash: '$2a$10$dummy.hash.will.be.replaced.on.first.login',
        role: 'user',
        organizationId: defaultOrg.id,
        isActive: true,
        sessionPreferences: {
          defaultStrategy: 'on_demand',
          autoReconnect: false,
          notifications: true,
        },
      })
      .returning();

    console.log('✅ Regular user created:', regularUser.username);

    // Create initial system log
    await db.insert(schema.systemLogs).values({
      level: 'info',
      message: 'Database seeded successfully with default organization and users',
      service: 'database',
      metadata: {
        usersCreated: 3,
        organizationsCreated: 1,
        timestamp: new Date().toISOString(),
      },
    });

    console.log('✅ Database seeding completed successfully!');
    console.log('\n📋 Default Users Created:');
    console.log('🔑 Admin: admin (password will be set on first use)');
    console.log('🔑 Manager: manager (password will be set on first use)');
    console.log('🔑 User: testuser (password will be set on first use)');
    console.log('\n🔗 Database: Neon PostgreSQL');
    console.log('🏢 Organization: LIMS Healthcare');
    console.log('\n⚠️  Note: Set up proper passwords in production!');
    
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    throw error;
  }
}

seedDatabase()
  .then(() => {
    console.log('🎉 Database seeding complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Seeding failed:', error);
    process.exit(1);
  });