/**
 * Test script for external user-based message sending API
 * Tests the new POST /api/external/messages/send-user endpoint
 */

const userId = '79be1730-8ed5-45f3-968a-37fac823d7fa'; // Anand (Administration)
const baseUrl = 'http://localhost:3001';
const apiKey = process.env.API_KEY || 'whatsapp-lims-api-key-2024';

// Test configuration
const testConfig = {
  targetPhone: '919909249725', // Update with recipient number
  simpleMessage: 'Hello! This is a test message from external API.',
  templateMessage: 'Dear [PatientName], your test result is [Result]. Report date: [Date]',
  templateData: {
    PatientName: 'Anand Kumar',
    Result: 'Negative',
    Date: new Date().toLocaleDateString()
  }
};

async function testExternalMessageSend() {
  console.log('🧪 External User-Based Message API Test\n');
  console.log('User ID:', userId);
  console.log('Base URL:', baseUrl);
  console.log('API Key:', apiKey.substring(0, 10) + '...');
  console.log('─'.repeat(60));

  try {
    // Test 1: Check user session status first
    console.log('\n1️⃣  Checking user session status...');
    const statusResponse = await fetch(`${baseUrl}/api/users/${userId}/whatsapp/status`);
    const statusData = await statusResponse.json();
    
    if (!statusData.success || statusData.data.status !== 'connected') {
      console.error('❌ User session not connected:', statusData);
      console.log('\n💡 Connect user first:');
      console.log(`   POST ${baseUrl}/api/users/${userId}/whatsapp/connect`);
      return;
    }
    
    console.log('✅ User session active');
    console.log('   Phone:', statusData.data.phoneNumber);
    console.log('   Status:', statusData.data.status);

    // Test 2: Send simple message via external API
    console.log('\n2️⃣  Sending simple message via external API...');
    const simpleResponse = await fetch(
      `${baseUrl}/api/external/messages/send-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          userId: userId,
          phoneNumber: testConfig.targetPhone,
          message: testConfig.simpleMessage,
        }),
      }
    );

    const simpleResult = await simpleResponse.json();
    
    if (simpleResult.success) {
      console.log('✅ Message sent successfully!');
      console.log('   Message ID:', simpleResult.data.messageId);
      console.log('   Session ID:', simpleResult.data.sessionId);
      console.log('   Auto-selected:', simpleResult.data.sessionWasAutoSelected);
    } else {
      console.error('❌ Failed to send message:', simpleResult);
      return;
    }

    // Wait before sending next message
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Send templated message
    console.log('\n3️⃣  Sending templated message...');
    const templateResponse = await fetch(
      `${baseUrl}/api/external/messages/send-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          userId: userId,
          phoneNumber: testConfig.targetPhone,
          message: testConfig.templateMessage,
          templateData: testConfig.templateData,
        }),
      }
    );

    const templateResult = await templateResponse.json();
    
    if (templateResult.success) {
      console.log('✅ Template message sent successfully!');
      console.log('   Message ID:', templateResult.data.messageId);
      console.log('   Template data:', testConfig.templateData);
    } else {
      console.error('❌ Failed to send template message:', templateResult);
    }

    console.log('\n' + '─'.repeat(60));
    console.log('✅ All external API tests completed!');
    console.log('\n💡 Check WhatsApp to verify messages were received.');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
  }
}

// Run tests
console.log('Starting external user-based message API tests...\n');
testExternalMessageSend().catch(console.error);
