// Test the exact user lookup that the API is doing
import { DatabaseStorage } from './server/storage/DatabaseStorage.js';

async function testUserLookup() {
  console.log('🧪 Testing exact API user lookup flow...');
  
  const storage = new DatabaseStorage();
  const userId = '97b3d102-3ac8-4915-869e-1c94fd2dfcac';
  
  try {
    console.log(`\n1. Testing getUsers() method...`);
    const users = await storage.getUsers();
    console.log(`✅ Found ${users.length} users`);
    
    console.log(`\n2. Testing user.find() logic...`);
    const user = users.find(u => u.id === userId);
    if (user) {
      console.log(`✅ User found via find(): ${user.name}`);
    } else {
      console.log(`❌ User NOT found via find()`);
    }
    
    console.log(`\n3. Testing direct getUser() method...`);
    const directUser = await storage.getUser(userId);
    if (directUser) {
      console.log(`✅ User found via getUser(): ${directUser.name}`);
    } else {
      console.log(`❌ User NOT found via getUser()`);
    }
    
    console.log('\n4. Testing user ID comparison...');
    users.forEach((u, index) => {
      if (u.name.includes('Article')) {
        console.log(`  Article user found at index ${index}:`);
        console.log(`    - ID from DB: "${u.id}"`);
        console.log(`    - Target ID:  "${userId}"`);
        console.log(`    - IDs match: ${u.id === userId}`);
        console.log(`    - ID length: DB=${u.id.length}, Target=${userId.length}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Error in user lookup test:', error);
  }
}

testUserLookup();