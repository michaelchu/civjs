-- Insert test user for development
-- This should be run in your Supabase SQL editor

INSERT INTO profiles (id, username, display_name, created_at, updated_at)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'testuser',
  'Test User',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  updated_at = NOW();
