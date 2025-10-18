import { db } from '../server/db';
import { users, whatsappSessions } from '../shared/schema';
import { randomUUID } from 'crypto';

async function setupDatabase() {
  try {
    console.log('🚀 Setting up database with sample users...');
    
    // Create sample users for testing multi-user WhatsApp system
    const sampleUsers = [
      {
        id: randomUUID(),
        username: 'admin@clinic.com',
        name: 'Dr. Sarah Johnson',
        role: 'admin',
        clinic_name: 'Advanced Medical Center',
        contact_email: 'admin@clinic.com',
        contact_whatsapp: '+1234567890',
        whatsapp_integration_available: true,
        max_sessions: 3,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: randomUUID(),
        username: 'receptionist@clinic.com',
        name: 'Maria Garcia',
        role: 'receptionist',
        clinic_name: 'Advanced Medical Center',
        contact_email: 'receptionist@clinic.com',
        contact_whatsapp: '+1234567891',
        whatsapp_integration_available: true,
        max_sessions: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: randomUUID(),
        username: 'lab.tech@clinic.com',
        name: 'John Smith',
        role: 'technician',
        clinic_name: 'Advanced Medical Center',
        contact_email: 'lab.tech@clinic.com',
        contact_whatsapp: '+1234567892',
        whatsapp_integration_available: true,
        max_sessions: 2,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: randomUUID(),
        username: 'doctor@clinic2.com',
        name: 'Dr. Michael Chen',
        role: 'doctor',
        clinic_name: 'City Health Clinic',
        contact_email: 'doctor@clinic2.com',
        contact_whatsapp: '+1234567893',
        whatsapp_integration_available: true,
        max_sessions: 2,
        created_at: new Date(),
        updated_at: new Date(),
      }
    ];

    // Insert users
    for (const user of sampleUsers) {
      try {
        const result = await db.insert(users).values(user).returning();
        console.log(`✅ Created user: ${result[0].name} (${result[0].role})`);
      } catch (error) {
        console.log(`⚠️ User ${user.name} might already exist`);
      }
    }

    console.log('\n📋 User Summary:');
    const allUsers = await db.select().from(users);
    allUsers.forEach(user => {
      console.log(`- ${user.name} (${user.role}) - Max Sessions: ${user.max_sessions}`);
    });

    console.log('\n🔗 WhatsApp Session Status:');
    const sessions = await db.select().from(whatsappSessions);
    console.log(`Current active sessions: ${sessions.length}`);

    console.log('\n✨ Database setup completed!');
    console.log('\nNext steps:');
    console.log('1. Start the server: npm run dev');
    console.log('2. Test user session creation via API');
    console.log('3. Check multi-user WhatsApp functionality');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
  }
}

setupDatabase();