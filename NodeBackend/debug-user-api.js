// Debug script to test user API issue
import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_HclN2sBL5OIF@ep-solitary-salad-a1alphes-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');

async function debugUserLookup() {
  const userId = '97b3d102-3ac8-4915-869e-1c94fd2dfcac';
  
  console.log('🔍 Debugging Article Pathology Lab user lookup...');
  console.log(`Target User ID: ${userId}`);
  
  try {
    // Check if user exists in database
    const users = await sql`SELECT id, name, clinic_name, role FROM users WHERE id = ${userId}`;
    
    console.log(`\n📋 Direct database lookup result:`);
    if (users.length > 0) {
      console.log('✅ User FOUND in database:');
      console.log(`  - ID: ${users[0].id}`);
      console.log(`  - Name: ${users[0].name}`);
      console.log(`  - Clinic: ${users[0].clinic_name}`);
      console.log(`  - Role: ${users[0].role}`);
    } else {
      console.log('❌ User NOT FOUND in database');
    }
    
    // Check all users to see what's in the database
    const allUsers = await sql`SELECT id, name, clinic_name FROM users ORDER BY name`;
    console.log(`\n📊 All users in database (${allUsers.length} total):`);
    allUsers.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.name} (${user.clinic_name})`);
      console.log(`     ID: ${user.id}`);
    });
    
    // Test the exact API flow that's failing
    console.log(`\n🔧 Testing API simulation:`);
    const testUser = allUsers.find(u => u.id === userId);
    if (testUser) {
      console.log('✅ User lookup in API would succeed');
      console.log(`  - Found: ${testUser.name}`);
    } else {
      console.log('❌ User lookup in API would fail - this is the issue!');
    }
    
  } catch (error) {
    console.error('❌ Database connection error:', error);
  }
}

debugUserLookup();