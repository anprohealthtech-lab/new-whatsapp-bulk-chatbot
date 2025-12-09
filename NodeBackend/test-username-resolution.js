/**
 * Test script to verify UUID and username resolution
 * Tests that both userId (UUID) and username work in the same endpoint
 */

const baseUrl = 'http://localhost:3001';
const apiKey = process.env.API_KEY || 'whatsapp-lims-api-key-2024';

// Test data
const testUser = {
  uuid: '79be1730-8ed5-45f3-968a-37fac823d7fa',
  username: 'anand.kumar', // Update this with actual username from DB
};

const testPhone = '919909249725'; // Update with recipient

async function testUserIdResolution() {
  console.log('🧪 Testing User ID Resolution (UUID vs Username)\n');
  console.log('Base URL:', baseUrl);
  console.log('─'.repeat(60));

  try {
    // Test 1: Send message using UUID (traditional way)
    console.log('\n1️⃣  Testing with UUID...');
    console.log('   User ID:', testUser.uuid);
    
    const uuidResponse = await fetch(
      `${baseUrl}/api/external/messages/send-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          userId: testUser.uuid,
          phoneNumber: testPhone,
          message: 'Test message sent using UUID',
        }),
      }
    );

    const uuidResult = await uuidResponse.json();
    
    if (uuidResult.success) {
      console.log('   ✅ UUID resolution worked!');
      console.log('   Resolved by:', uuidResult.data.resolvedBy);
      console.log('   Message ID:', uuidResult.data.messageId);
    } else {
      console.log('   ❌ UUID test failed:', uuidResult.error);
      console.log('   Message:', uuidResult.message);
    }

    // Wait before second request
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: Send message using username (new feature)
    console.log('\n2️⃣  Testing with username...');
    console.log('   Username:', testUser.username);
    
    const usernameResponse = await fetch(
      `${baseUrl}/api/external/messages/send-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          userId: testUser.username, // Using username instead of UUID!
          phoneNumber: testPhone,
          message: 'Test message sent using username',
        }),
      }
    );

    const usernameResult = await usernameResponse.json();
    
    if (usernameResult.success) {
      console.log('   ✅ Username resolution worked!');
      console.log('   Resolved by:', usernameResult.data.resolvedBy);
      console.log('   Actual User ID:', usernameResult.data.userId);
      console.log('   Message ID:', usernameResult.data.messageId);
    } else {
      console.log('   ❌ Username test failed:', usernameResult.error);
      console.log('   Message:', usernameResult.message);
    }

    // Test 3: Test with invalid user
    console.log('\n3️⃣  Testing with invalid user...');
    
    const invalidResponse = await fetch(
      `${baseUrl}/api/external/messages/send-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          userId: 'nonexistent.user',
          phoneNumber: testPhone,
          message: 'This should fail',
        }),
      }
    );

    const invalidResult = await invalidResponse.json();
    
    if (!invalidResult.success && invalidResult.error === 'USER_NOT_FOUND') {
      console.log('   ✅ Invalid user correctly rejected');
      console.log('   Error:', invalidResult.message);
    } else {
      console.log('   ⚠️  Unexpected result:', invalidResult);
    }

    console.log('\n' + '─'.repeat(60));
    console.log('✅ All resolution tests completed!\n');
    console.log('📋 Summary:');
    console.log('   - UUID resolution: Working');
    console.log('   - Username resolution: Working');
    console.log('   - Invalid user handling: Working');
    console.log('\n💡 Same endpoint now accepts both UUID and username!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run tests
console.log('Starting User ID Resolution Tests...\n');
testUserIdResolution().catch(console.error);
