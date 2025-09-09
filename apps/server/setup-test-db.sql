-- Create test database for integration tests
-- This assumes you already have the 'civjs' user created with 'civjs_secret' password
-- (same user as for development, but separate database)

-- Create test database
CREATE DATABASE civjs_test OWNER civjs;

-- Grant all privileges to the civjs user on test database
GRANT ALL PRIVILEGES ON DATABASE civjs_test TO civjs;

-- Connect to the test database and grant schema permissions
\c civjs_test;
GRANT ALL ON SCHEMA public TO civjs;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO civjs;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO civjs;
