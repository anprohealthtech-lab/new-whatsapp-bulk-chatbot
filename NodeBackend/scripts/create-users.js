import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_HclN2sBL5OIF@ep-solitary-salad-a1alphes-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');

async function createUsers() {
  try {
    console.log('🚀 Creating sample users for multi-user WhatsApp system...');

    // Insert sample users
    const users = await sql`
      INSERT INTO users (
        id, 
        username, 
        name, 
        role, 
        clinic_name, 
        contact_email, 
        contact_whatsapp, 
        whatsapp_integration_available, 
        max_sessions,
        created_at,
        updated_at
      ) VALUES 
        (
          'a1b2c3d4-e5f6-7890-1234-567890abcdef',
          'admin@clinic.com',
          'Dr. Sarah Johnson',
          'admin',
          'Advanced Medical Center',
          'admin@clinic.com',
          '+1234567890',
          true,
          3,
          NOW(),
          NOW()
        ),
        (
          'b2c3d4e5-f6g7-8901-2345-6789abcdef01',
          'receptionist@clinic.com',
          'Maria Garcia',
          'receptionist',
          'Advanced Medical Center',
          'receptionist@clinic.com',
          '+1234567891',
          true,
          1,
          NOW(),
          NOW()
        ),
        (
          'c3d4e5f6-g7h8-9012-3456-789abcdef012',
          'lab.tech@clinic.com',
          'John Smith',
          'technician',
          'Advanced Medical Center',
          'lab.tech@clinic.com',
          '+1234567892',
          true,
          2,
          NOW(),
          NOW()
        ),
        (
          'd4e5f6g7-h8i9-0123-4567-89abcdef0123',
          'doctor@clinic2.com',
          'Dr. Michael Chen',
          'doctor',
          'City Health Clinic',
          'doctor@clinic2.com',
          '+1234567893',
          true,
          2,
          NOW(),
          NOW()
        )
      ON CONFLICT (username) DO NOTHING
      RETURNING id, name, role, clinic_name, max_sessions`;

    if (users.length > 0) {
      console.log(`✅ Created ${users.length} users:`);
      users.forEach(user => {
        console.log(`  - ${user.name} (${user.role}) - Max Sessions: ${user.max_sessions}`);
      });
    } else {
      console.log('ℹ️ Users already exist, checking current data...');
    }

    // Display all users
    const allUsers = await sql`
      SELECT 
        id,
        name,
        role,
        clinic_name,
        max_sessions,
        whatsapp_integration_available,
        contact_whatsapp
      FROM users
      ORDER BY role, name`;

    console.log('\n📋 Current Users in Database:');
    allUsers.forEach(user => {
      console.log(`  📱 ${user.name} (${user.role})`);
      console.log(`     Clinic: ${user.clinic_name}`);
      console.log(`     WhatsApp: ${user.contact_whatsapp} | Max Sessions: ${user.max_sessions}`);
      console.log(`     Integration Available: ${user.whatsapp_integration_available ? '✅' : '❌'}`);
      console.log('');
    });

    // Check WhatsApp sessions
    const sessions = await sql`SELECT * FROM whatsapp_sessions`;
    console.log(`🔗 Current WhatsApp Sessions: ${sessions.length}`);

    console.log('\n✨ Multi-User WhatsApp System Setup Complete!');
    console.log('\nNext Steps:');
    console.log('1. Start the server: npm run dev');
    console.log('2. Create WhatsApp sessions for users via API');
    console.log('3. Test multi-user functionality');

  } catch (error) {
    console.error('❌ Error creating users:', error);
  }
}

createUsers();