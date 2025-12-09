/**
 * Test script for WhatsApp message sending API
 * Tests the send-message endpoint with the connected user session
 */

const userId = '79be1730-8ed5-45f3-968a-37fac823d7fa'; // Anand (Administration)
const baseUrl = 'http://localhost:3001';

// Test configuration
const testConfig = {
  // Replace with a valid WhatsApp number to send test message to
  // Format: country code + number (e.g., '919909249725')
  targetPhone: '919909249725', // Update this with recipient number
  testMessage: 'Hello! This is a test message from WhatsApp LIMS system.',
  templateMessage: 'Dear [NAME], your test report is ready. Result: [RESULT]',
  templateData: {
    NAME: 'Anand',
    RESULT: 'Negative'
  }
};

async function testSendMessage() {
  console.log('🧪 WhatsApp Message Sending Test\n');
  console.log('User ID:', userId);
  console.log('Base URL:', baseUrl);
  console.log('Target Phone:', testConfig.targetPhone);
  console.log('─'.repeat(60));

  try {
    // Test 1: Check user session status
    console.log('\n1️⃣  Checking user session status...');
    const statusResponse = await fetch(`${baseUrl}/api/users/${userId}/whatsapp/status`);
    const statusData = await statusResponse.json();
    
    if (!statusData.success || statusData.data.status !== 'connected') {
      console.error('❌ User session not connected:', statusData);
      console.log('\n💡 Make sure the user is connected first:');
      console.log(`   POST ${baseUrl}/api/users/${userId}/whatsapp/connect`);
      return;
    }
    
    console.log('✅ User session active');
    console.log('   Phone:', statusData.data.phoneNumber);
    console.log('   Status:', statusData.data.status);

    // Test 2: Send simple text message
    console.log('\n2️⃣  Sending simple text message...');
    const simpleMessageResponse = await fetch(
      `${baseUrl}/api/users/${userId}/whatsapp/send-message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: testConfig.targetPhone,
          message: testConfig.testMessage,
        }),
      }
    );

    const simpleResult = await simpleMessageResponse.json();
    
    if (simpleResult.success) {
      console.log('✅ Message sent successfully!');
      console.log('   Message ID:', simpleResult.data.messageId);
      console.log('   Timestamp:', new Date().toISOString());
    } else {
      console.error('❌ Failed to send message:', simpleResult.error);
      return;
    }

    // Wait a bit before sending second message
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Send templated message
    console.log('\n3️⃣  Sending templated message...');
    const templateMessageResponse = await fetch(
      `${baseUrl}/api/users/${userId}/whatsapp/send-message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: testConfig.targetPhone,
          message: testConfig.templateMessage,
          templateData: testConfig.templateData,
        }),
      }
    );

    const templateResult = await templateMessageResponse.json();
    
    if (templateResult.success) {
      console.log('✅ Template message sent successfully!');
      console.log('   Message ID:', templateResult.data.messageId);
      console.log('   Template data:', testConfig.templateData);
    } else {
      console.error('❌ Failed to send template message:', templateResult.error);
    }

    // Test 4: Retrieve sent messages
    console.log('\n4️⃣  Retrieving sent messages...');
    const messagesResponse = await fetch(
      `${baseUrl}/api/users/${userId}/whatsapp/messages?limit=5`
    );
    const messagesData = await messagesResponse.json();
    
    if (messagesData.success) {
      console.log(`✅ Retrieved ${messagesData.data.length} recent messages`);
      messagesData.data.forEach((msg, idx) => {
        console.log(`   ${idx + 1}. To: ${msg.to} | ${msg.type} | ${new Date(msg.timestamp).toLocaleString()}`);
      });
    }

    console.log('\n' + '─'.repeat(60));
    console.log('✅ All tests completed successfully!');
    console.log('\n💡 Check your WhatsApp to confirm messages were received.');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.cause) {
      console.error('Cause:', error.cause);
    }
  }
}

// Run tests
console.log('Starting WhatsApp message sending tests...\n');
testSendMessage().catch(console.error);
