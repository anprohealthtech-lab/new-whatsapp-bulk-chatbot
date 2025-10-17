import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../shared/schema';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  console.log('🔄 Connecting to Neon PostgreSQL database...');
  
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  try {
    console.log('🔄 Creating tables and indexes...');

    // Create organizations table
    await sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        subscription_plan VARCHAR(50) DEFAULT 'basic',
        max_users INTEGER DEFAULT 10,
        max_sessions INTEGER DEFAULT 5,
        is_active BOOLEAN DEFAULT true,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // Create users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        last_login_at TIMESTAMP WITH TIME ZONE,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // Create whatsapp_sessions table
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20),
        is_authenticated BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT false,
        strategy VARCHAR(50) DEFAULT 'business_hours',
        last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        connection_attempts INTEGER DEFAULT 0,
        max_reconnection_attempts INTEGER DEFAULT 3,
        expires_at TIMESTAMP WITH TIME ZONE,
        session_data JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, session_name)
      )
    `;

    // Create messages table (enhanced)
    await sql`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone_number VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        message_type VARCHAR(50) DEFAULT 'text',
        status VARCHAR(50) DEFAULT 'pending',
        whatsapp_message_id VARCHAR(255),
        error_message TEXT,
        file_path VARCHAR(500),
        file_name VARCHAR(255),
        file_size BIGINT,
        template_data JSONB,
        scheduled_at TIMESTAMP WITH TIME ZONE,
        sent_at TIMESTAMP WITH TIME ZONE,
        delivered_at TIMESTAMP WITH TIME ZONE,
        read_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // Create usage_stats table
    await sql`
      CREATE TABLE IF NOT EXISTS usage_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        stat_type VARCHAR(100) NOT NULL,
        stat_value INTEGER NOT NULL,
        period_start TIMESTAMP WITH TIME ZONE NOT NULL,
        period_end TIMESTAMP WITH TIME ZONE NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // Create system_logs table (enhanced)
    await sql`
      CREATE TABLE IF NOT EXISTS system_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        level VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        source VARCHAR(100),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    // Create indexes for better performance
    await sql`CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user_id ON whatsapp_sessions(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_active ON whatsapp_sessions(is_active, is_authenticated)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_expires ON whatsapp_sessions(expires_at)`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_phone_number ON messages(phone_number)`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_stats_user_id ON usage_stats(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_stats_period ON usage_stats(period_start, period_end)`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON system_logs(user_id)`;

    // Create default organization
    await sql`
      INSERT INTO organizations (name, subscription_plan, max_users, max_sessions)
      VALUES ('Default Organization', 'basic', 50, 10)
      ON CONFLICT DO NOTHING
    `;

    // Get the default organization ID
    const [defaultOrg] = await sql`
      SELECT id FROM organizations WHERE name = 'Default Organization' LIMIT 1
    `;

    if (defaultOrg) {
      // Create default admin user
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);

      await sql`
        INSERT INTO users (username, email, password_hash, role, organization_id)
        VALUES ('admin', 'admin@example.com', ${hashedPassword}, 'admin', ${defaultOrg.id})
        ON CONFLICT (username) DO NOTHING
      `;

      console.log('✅ Default admin user created: admin / admin123');
    }

    console.log('✅ Database initialization completed successfully!');
    console.log('📊 Tables created:');
    console.log('   - organizations');
    console.log('   - users');
    console.log('   - whatsapp_sessions');
    console.log('   - messages');
    console.log('   - usage_stats');
    console.log('   - system_logs');
    console.log('🔗 Database URL:', process.env.DATABASE_URL?.split('@')[1]);

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Run initialization if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase()
    .then(() => {
      console.log('🎉 Database setup complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database setup failed:', error);
      process.exit(1);
    });
}

export { initializeDatabase };