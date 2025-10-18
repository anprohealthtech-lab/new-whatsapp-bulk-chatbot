import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_HclN2sBL5OIF@ep-solitary-salad-a1alphes-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');

// Real users from external healthcare app
const externalUsers = [
  {
    "id": "3e1d877e-36b6-4ac4-b874-ba93c1eee1be",
    "auth_id": null,
    "username": "testsignup2@example.com",
    "password_hash": "7e6e0c3079a08c5cc6036789b57e951f65f82383913ba1a49ae992544f1b4b6e",
    "name": "Test User",
    "role": "receptionist",
    "clinic_name": "Test Business",
    "clinic_address": "123 Test Street",
    "gmb_link": "",
    "logo": "",
    "primary_color": "#3b82f6",
    "secondary_color": "#1e40af",
    "contact_phone": "+1234567890",
    "contact_email": "testsignup2@example.com",
    "contact_whatsapp": "+1234567890",
    "languages": {"en": {"name": "Test User", "address": "123 Test Street"}},
    "default_language": "en",
    "created_at": "2025-10-08 12:18:08.011693+00",
    "updated_at": "2025-10-08 12:18:08.011693+00",
    "google_sheet_id": "",
    "google_apps_script_url": "",
    "enabled_features": ["dashboard", "appointments", "reviews", "sequences", "creatives", "reports", "gmb"],
    "blueticks_api_key": "",
    "profile_types": ["service_provider"],
    "whatsapp_integration_available": true
  },
  {
    "id": "7bf20d4f-15ed-4c47-9a8a-180697d98b80",
    "auth_id": null,
    "username": "anprohealthtech@gmail.com",
    "password_hash": "oauth_google",
    "name": "ANPRO HEALTHTECH",
    "role": "receptionist",
    "clinic_name": "Anpro Health tech",
    "clinic_address": "ahmedabad",
    "gmb_link": "",
    "logo": "https://lh3.googleusercontent.com/a/ACg8ocJS1IoqXRclfOJKfmIcKiNiM6P3I6EmrwAmpJj7u6TZqOq20g=s96-c",
    "primary_color": "#3b82f6",
    "secondary_color": "#1e40af",
    "contact_phone": "9909249725",
    "contact_email": "anprohealthtech@gmail.com",
    "contact_whatsapp": "",
    "languages": {"en": {"name": "ANPRO HEALTHTECH", "address": ""}},
    "default_language": "en",
    "created_at": "2025-10-09 04:28:00.606789+00",
    "updated_at": "2025-10-09 04:28:00.606789+00",
    "google_sheet_id": "",
    "google_apps_script_url": "",
    "enabled_features": ["dashboard", "appointments", "reviews", "sequences", "creatives", "reports", "gmb"],
    "blueticks_api_key": "",
    "profile_types": ["service_provider"],
    "whatsapp_integration_available": true
  },
  {
    "id": "7ea97b04-3fc0-4cad-ba86-0e2f3f16d0bf",
    "auth_id": null,
    "username": "landinquiryfirm@gmail.com",
    "password_hash": "oauth_google",
    "name": "Anand P",
    "role": "receptionist",
    "clinic_name": "Sample clinic 1",
    "clinic_address": "ahmedabad",
    "gmb_link": "https://dr-jasdeep-kaur-skin-specialist.gmbreviewsystem.com/",
    "logo": "https://lh3.googleusercontent.com/a/ACg8ocLwEbYnWoyrbaY__QN9ixl9ugfisYscQgRPYWhKxg98b89xHA=s96-c",
    "primary_color": "#3b82f6",
    "secondary_color": "#1e40af",
    "contact_phone": "",
    "contact_email": "landinquiryfirm@gmail.com",
    "contact_whatsapp": "",
    "languages": {"en": {"name": "Anand P", "address": ""}},
    "default_language": "en",
    "created_at": "2025-10-08 17:28:39.604255+00",
    "updated_at": "2025-10-08 17:28:39.604255+00",
    "google_sheet_id": "",
    "google_apps_script_url": "",
    "enabled_features": ["dashboard", "appointments", "reviews", "sequences", "creatives", "reports", "gmb"],
    "blueticks_api_key": "",
    "profile_types": ["service_provider"],
    "whatsapp_integration_available": true
  },
  {
    "id": "97b3d102-3ac8-4915-869e-1c94fd2dfcac",
    "auth_id": "9b85218b-f2c1-4258-affe-9e3a8e9c9e06",
    "username": "articlepathlab20@gmail.com",
    "password_hash": "e5857b335afdf35ca81a110bc81f38682f8a89892cc597f5398dfef82d42b513",
    "name": "Article Pathology Laboratory",
    "role": "receptionist",
    "clinic_name": "Article Pathology Laboratory",
    "clinic_address": "Loft Garden, 105, near Eulogia Hotel Road, Gota, Ahmedabad, Gujarat 38248",
    "gmb_link": "https://dr-jasdeep-kaur-skin-specialist.gmbreviewsystem.com/",
    "logo": null,
    "primary_color": "#3849c7",
    "secondary_color": "#E5E7EB",
    "contact_phone": "81559 99404",
    "contact_email": "",
    "contact_whatsapp": "",
    "languages": {"en": {"name": "", "address": ""}},
    "default_language": "en",
    "created_at": "2025-06-26 10:31:38.894038+00",
    "updated_at": "2025-06-26 10:31:38.894038+00",
    "google_sheet_id": "11heX4aZIA_BtpGBiLwHOzTEsh1TFNW6v0889PdouhYE",
    "google_apps_script_url": "https://script.google.com/macros/s/AKfycbyjFKyO67OKQiPHobp-AreV2Zepp-cAtSHiak2YKOgWBHAIf68tWi_GmA-ySTyYlKQd-g/exec",
    "enabled_features": ["dashboard", "appointments", "reviews", "sequences", "creatives", "reports", "gmb"],
    "blueticks_api_key": "",
    "profile_types": [],
    "whatsapp_integration_available": true
  },
  {
    "id": "c1c2c4b6-e6f1-4bee-bac1-99facf4f0a4f",
    "auth_id": null,
    "username": "dranand@thedoctorpreneuracademy.com",
    "password_hash": "oauth_google",
    "name": "Dr Anand Priyadarshi",
    "role": "admin",
    "clinic_name": "DCP LABS",
    "clinic_address": "ahmedabad",
    "gmb_link": "https://directwaneon.netlify.app/login",
    "logo": "https://lh3.googleusercontent.com/a/ACg8ocIWFUkQuV2nWJIr_OmObXIzS1zbErAgJRzDFogoYlJtJ9Srmg=s96-c",
    "primary_color": "#4F46E5",
    "secondary_color": "#275fce",
    "contact_phone": "",
    "contact_email": "dranand@thedoctorpreneuracademy.com",
    "contact_whatsapp": "",
    "languages": {"en": {"name": "Dr Anand Priyadarshi", "address": ""}},
    "default_language": "en",
    "created_at": "2025-10-08 17:44:58.800655+00",
    "updated_at": "2025-10-08 17:44:58.800655+00",
    "google_sheet_id": "",
    "google_apps_script_url": "",
    "enabled_features": ["dashboard", "appointments", "reviews", "sequences", "creatives", "reports", "gmb"],
    "blueticks_api_key": "",
    "profile_types": ["service_provider"],
    "whatsapp_integration_available": true
  },
  {
    "id": "e522e9f3-e6da-4009-b5ad-110a9caa7e74",
    "auth_id": null,
    "username": "testsignup@example.com",
    "password_hash": "7e6e0c3079a08c5cc6036789b57e951f65f82383913ba1a49ae992544f1b4b6e",
    "name": "Test User",
    "role": "receptionist",
    "clinic_name": "Test Business",
    "clinic_address": "123 Test Street",
    "gmb_link": "",
    "logo": "",
    "primary_color": "#3b82f6",
    "secondary_color": "#1e40af",
    "contact_phone": "+1234567890",
    "contact_email": "testsignup@example.com",
    "contact_whatsapp": "+1234567890",
    "languages": {"en": {"name": "Test User", "address": "123 Test Street"}},
    "default_language": "en",
    "created_at": "2025-10-08 12:16:45.437939+00",
    "updated_at": "2025-10-08 12:16:45.437939+00",
    "google_sheet_id": "",
    "google_apps_script_url": "",
    "enabled_features": ["dashboard", "appointments", "reviews", "sequences", "creatives", "reports", "gmb"],
    "blueticks_api_key": "",
    "profile_types": ["service_provider"],
    "whatsapp_integration_available": true
  }
];

async function injectUsers() {
  try {
    console.log('🚀 Injecting real users from external healthcare app...');
    let createdCount = 0;
    let existingCount = 0;

    for (const user of externalUsers) {
      try {
        // Set max_sessions based on role
        const maxSessions = user.role === 'admin' ? 5 : user.role === 'doctor' ? 3 : 2;
        
        const result = await sql`
          INSERT INTO users (
            id, 
            auth_id,
            username, 
            password_hash,
            name, 
            role, 
            clinic_name, 
            clinic_address,
            gmb_link,
            logo,
            primary_color,
            secondary_color,
            contact_phone,
            contact_email, 
            contact_whatsapp, 
            languages,
            default_language,
            enabled_features,
            profile_types,
            google_sheet_id,
            google_apps_script_url,
            blueticks_api_key,
            whatsapp_integration_available, 
            max_sessions,
            created_at,
            updated_at
          ) VALUES (
            ${user.id},
            ${user.auth_id},
            ${user.username},
            ${user.password_hash},
            ${user.name},
            ${user.role},
            ${user.clinic_name},
            ${user.clinic_address},
            ${user.gmb_link || ''},
            ${user.logo},
            ${user.primary_color},
            ${user.secondary_color},
            ${user.contact_phone || ''},
            ${user.contact_email || user.username},
            ${user.contact_whatsapp || ''},
            ${JSON.stringify(user.languages)},
            ${user.default_language},
            ${JSON.stringify(user.enabled_features)},
            ${JSON.stringify(user.profile_types)},
            ${user.google_sheet_id || ''},
            ${user.google_apps_script_url || ''},
            ${user.blueticks_api_key || ''},
            ${user.whatsapp_integration_available},
            ${maxSessions},
            ${user.created_at},
            ${user.updated_at}
          )
          ON CONFLICT (username) DO UPDATE SET
            name = EXCLUDED.name,
            role = EXCLUDED.role,
            clinic_name = EXCLUDED.clinic_name,
            whatsapp_integration_available = EXCLUDED.whatsapp_integration_available,
            max_sessions = EXCLUDED.max_sessions,
            updated_at = NOW()
          RETURNING id, name, role, clinic_name, max_sessions`;

        if (result.length > 0) {
          console.log(`✅ ${user.name} (${user.role}) - ${user.clinic_name}`);
          createdCount++;
        }
      } catch (error) {
        console.log(`⚠️ Issue with ${user.name}: ${error.message}`);
        existingCount++;
      }
    }

    // Display all users in the system
    console.log('\n📋 All Users in Multi-User WhatsApp LIMS System:');
    const allUsers = await sql`
      SELECT 
        id,
        name,
        role,
        clinic_name,
        contact_whatsapp,
        max_sessions,
        whatsapp_integration_available,
        created_at
      FROM users
      ORDER BY 
        CASE role 
          WHEN 'admin' THEN 1 
          WHEN 'doctor' THEN 2 
          WHEN 'technician' THEN 3 
          WHEN 'receptionist' THEN 4 
          ELSE 5 
        END,
        clinic_name,
        name`;

    allUsers.forEach((user, index) => {
      const sessionLimit = user.max_sessions;
      const whatsappStatus = user.whatsapp_integration_available ? '🟢' : '🔴';
      const whatsappNumber = user.contact_whatsapp || 'Not set';
      
      console.log(`\n${index + 1}. 👤 ${user.name}`);
      console.log(`   Role: ${user.role.toUpperCase()}`);
      console.log(`   Clinic: ${user.clinic_name}`);
      console.log(`   WhatsApp: ${whatsappStatus} ${whatsappNumber}`);
      console.log(`   Max Sessions: ${sessionLimit}`);
      console.log(`   User ID: ${user.id}`);
    });

    // Check current WhatsApp sessions
    const activeSessions = await sql`
      SELECT 
        ws.id,
        ws.user_id,
        ws.is_active,
        ws.is_authenticated,
        ws.phone_number,
        u.name,
        u.clinic_name
      FROM whatsapp_sessions ws
      JOIN users u ON ws.user_id = u.id
      WHERE ws.is_active = true`;

    console.log(`\n🔗 Active WhatsApp Sessions: ${activeSessions.length}`);
    activeSessions.forEach(session => {
      console.log(`  📱 ${session.name} (${session.clinic_name}) - ${session.phone_number || 'No phone'}`);
    });

    console.log('\n✨ Multi-User WhatsApp LIMS System Ready!');
    console.log('\n🚀 Next Steps:');
    console.log('1. Start the server: npm run dev');
    console.log('2. Users can create WhatsApp sessions via API or UI');
    console.log('3. Each user has session limits based on their role:');
    console.log('   - Admin: 5 sessions');
    console.log('   - Doctor: 3 sessions'); 
    console.log('   - Technician/Receptionist: 2 sessions');
    console.log('\n📊 Summary:');
    console.log(`- Total Users: ${allUsers.length}`);
    console.log(`- Active Sessions: ${activeSessions.length}`);
    console.log(`- Users with WhatsApp: ${allUsers.filter(u => u.whatsapp_integration_available).length}`);

  } catch (error) {
    console.error('❌ Error injecting users:', error);
  }
}

injectUsers();