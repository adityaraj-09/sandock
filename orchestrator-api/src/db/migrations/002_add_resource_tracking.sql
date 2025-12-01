-- Add resource tracking and user tiers

-- Add tier column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS resource_limits JSONB DEFAULT '{}';

-- Add resource tracking to sandboxes table
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'free';
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS resource_usage JSONB DEFAULT '{}';
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create resource usage tracking table
CREATE TABLE IF NOT EXISTS resource_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    memory_usage_mb INTEGER,
    cpu_usage_percent DECIMAL(5,2),
    network_rx_bytes BIGINT DEFAULT 0,
    network_tx_bytes BIGINT DEFAULT 0,
    disk_usage_mb INTEGER DEFAULT 0
);

-- Create system metrics table
CREATE TABLE IF NOT EXISTS system_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_sandboxes INTEGER,
    total_memory_usage_mb BIGINT,
    total_cpu_usage_percent DECIMAL(5,2),
    active_users INTEGER,
    metrics_data JSONB DEFAULT '{}'
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sandboxes_tier ON sandboxes(tier);
CREATE INDEX IF NOT EXISTS idx_sandboxes_expires_at ON sandboxes(expires_at);
CREATE INDEX IF NOT EXISTS idx_sandboxes_last_activity ON sandboxes(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_resource_usage_logs_sandbox_id ON resource_usage_logs(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_resource_usage_logs_timestamp ON resource_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);

-- Add trigger to update last_activity_at
CREATE OR REPLACE FUNCTION update_sandbox_activity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_activity_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sandbox_activity_trigger
    BEFORE UPDATE ON sandboxes
    FOR EACH ROW
    EXECUTE FUNCTION update_sandbox_activity();

-- Add constraints
ALTER TABLE sandboxes ADD CONSTRAINT check_tier 
    CHECK (tier IN ('free', 'pro', 'enterprise'));

ALTER TABLE users ADD CONSTRAINT check_user_tier 
    CHECK (tier IN ('free', 'pro', 'enterprise'));

-- Create view for active sandboxes with resource info
CREATE OR REPLACE VIEW active_sandboxes_with_resources AS
SELECT 
    s.id,
    s.user_id,
    s.api_key_id,
    s.tier,
    s.status,
    s.created_at,
    s.expires_at,
    s.last_activity_at,
    s.metadata,
    s.resource_usage,
    u.email as user_email,
    u.tier as user_tier,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - s.created_at))/3600 as age_hours,
    CASE 
        WHEN s.expires_at < CURRENT_TIMESTAMP THEN true 
        ELSE false 
    END as is_expired
FROM sandboxes s
JOIN users u ON s.user_id = u.id
WHERE s.status = 'active';

-- Create function to cleanup expired sandboxes
CREATE OR REPLACE FUNCTION cleanup_expired_sandboxes()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE sandboxes 
    SET status = 'expired', destroyed_at = CURRENT_TIMESTAMP
    WHERE status = 'active' 
    AND expires_at < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    
    -- Log the cleanup
    INSERT INTO system_metrics (total_sandboxes, metrics_data)
    VALUES (
        (SELECT COUNT(*) FROM sandboxes WHERE status = 'active'),
        jsonb_build_object('cleanup_expired_count', expired_count)
    );
    
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;
