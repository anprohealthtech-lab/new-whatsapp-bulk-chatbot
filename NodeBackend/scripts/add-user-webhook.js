/**
 * Script to add a user to the WhatsApp system
 * Can be called via webhook from your external app
 * 
 * USAGE:
 * node scripts/add-user-webhook.js <user_id> <username> <email> [clinic_name]
 * 
 * OR use the HTTP endpoint:
 * POST /api/external/users/sync
 */

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

/**
 * Add a single user to the database
 * @param {Object} userData - User data
 * @param {string} userData.id - User UUID (from your external app)
 * @param {string} userData.username - Unique username
 * @param {string} userData.email - User email
 * @param {string} [userData.clinic_name] - Clinic/organization name (optional)
 * @param {string} [userData.contact_whatsapp] - WhatsApp contact number (optional)
 * @param {string} [userData.role] - User role: 'admin', 'manager', 'user' (default: 'user')
 * @param {boolean} [userData.is_active] - Is user active (default: true)
 * @param {boolean} [userData.whatsapp_enabled] - Enable WhatsApp for this user (default: true)
 */
async function addUser(userData) {
  try {
    console.log('🔍 Checking if user exists...', userData.id);

    // Check if user already exists
    const existing = await sql`
      SELECT id, username, email, clinic_name, is_active 
      FROM users 
      WHERE id = ${userData.id}
    `;

    if (existing.length > 0) {
      console.log('📝 User exists, updating...', existing[0].username);
      
      // Update existing user
      const updated = await sql`
        UPDATE users 
        SET 
          username = ${userData.username},
          email = ${userData.email},
          clinic_name = ${userData.clinic_name || existing[0].clinic_name},
          contact_whatsapp = ${userData.contact_whatsapp || null},
          role = ${userData.role || 'user'},
          is_active = ${userData.is_active !== undefined ? userData.is_active : true},
          whatsapp_integration_available = ${userData.whatsapp_enabled !== undefined ? userData.whatsapp_enabled : true},
          updated_at = NOW()
        WHERE id = ${userData.id}
        RETURNING id, username, email, clinic_name, role, is_active, created_at, updated_at
      `;

      console.log('✅ User updated successfully:', updated[0]);
      return { success: true, action: 'updated', user: updated[0] };
    } else {
      console.log('🆕 Creating new user...', userData.username);
      
      // Insert new user
      const created = await sql`
        INSERT INTO users (
          id,
          username,
          email,
          clinic_name,
          contact_whatsapp,
          role,
          is_active,
          whatsapp_integration_available,
          max_sessions,
          created_at,
          updated_at
        ) VALUES (
          ${userData.id},
          ${userData.username},
          ${userData.email},
          ${userData.clinic_name || userData.username},
          ${userData.contact_whatsapp || null},
          ${userData.role || 'user'},
          ${userData.is_active !== undefined ? userData.is_active : true},
          ${userData.whatsapp_enabled !== undefined ? userData.whatsapp_enabled : true},
          ${userData.max_sessions || 1},
          NOW(),
          NOW()
        )
        RETURNING id, username, email, clinic_name, role, is_active, created_at, updated_at
      `;

      console.log('✅ User created successfully:', created[0]);
      return { success: true, action: 'created', user: created[0] };
    }
  } catch (error) {
    console.error('❌ Error adding user:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk add users (useful for initial sync)
 */
async function addUsers(usersArray) {
  const results = [];
  
  for (const userData of usersArray) {
    const result = await addUser(userData);
    results.push({ ...result, userId: userData.id });
  }
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n📊 Summary: ${successful} successful, ${failed} failed`);
  return results;
}

// CLI usage
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log(`
Usage: node scripts/add-user-webhook.js <user_id> <username> <email> [clinic_name] [role] [whatsapp_number]

Example:
  node scripts/add-user-webhook.js \\
    "550e8400-e29b-41d4-a716-446655440000" \\
    "dr.smith" \\
    "dr.smith@clinic.com" \\
    "City Medical Center" \\
    "doctor" \\
    "+1234567890"

Required Fields (MUST be provided):
  - user_id:   UUID from your external app (used for mapping)
  - username:  Unique username
  - email:     User email address

Optional Fields:
  - clinic_name:      Organization/clinic name (defaults to username)
  - role:            'admin', 'manager', 'user' (defaults to 'user')
  - whatsapp_number: Contact WhatsApp number
    `);
    process.exit(1);
  }

  const [id, username, email, clinic_name, role, contact_whatsapp] = args;

  addUser({
    id,
    username,
    email,
    clinic_name,
    role,
    contact_whatsapp,
    is_active: true,
    whatsapp_enabled: true,
  }).then(result => {
    if (result.success) {
      console.log('\n✅ Success! User can now be accessed via:');
      console.log(`   - User ID: ${result.user.id}`);
      console.log(`   - Username: ${result.user.username}`);
      console.log(`   - API: POST /api/users/${result.user.id}/whatsapp/connect`);
    } else {
      console.error('\n❌ Failed:', result.error);
      process.exit(1);
    }
  });
}

export { addUser, addUsers };
