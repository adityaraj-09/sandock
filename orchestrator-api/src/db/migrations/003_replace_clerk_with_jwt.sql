-- Migration to replace Clerk authentication with JWT-based authentication
-- This migration removes clerk_user_id dependency and adds password_hash for local authentication

-- Add password_hash column (nullable for existing users, but required for new registrations)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Make clerk_user_id nullable (existing users can keep it temporarily)
ALTER TABLE users 
ALTER COLUMN clerk_user_id DROP NOT NULL;

-- Drop the unique constraint on clerk_user_id since we won't use it anymore
DROP INDEX IF EXISTS idx_users_clerk_id;

-- Add unique constraint on email instead (for JWT auth)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Note: Existing users with clerk_user_id will need to register/login with email/password
-- You may want to create a script to migrate existing Clerk users if needed

