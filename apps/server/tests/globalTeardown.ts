export default async function globalTeardown() {
  console.log('🧹 Cleaning up test database...');

  // Any global cleanup can go here
  // For now, we'll let the individual test cleanup handle things

  console.log('✅ Test cleanup complete');
}
