// Test environment variable loading
console.log('🔍 Testing environment variables...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL length:', process.env.DATABASE_URL?.length || 0);

if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL starts with:', process.env.DATABASE_URL.substring(0, 30) + '...');
} else {
  console.log('❌ DATABASE_URL is NOT SET - this is the problem!');
}