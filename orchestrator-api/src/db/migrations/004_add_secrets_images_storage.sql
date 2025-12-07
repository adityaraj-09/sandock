CREATE TABLE IF NOT EXISTS secrets (
    id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON secrets(user_id);

CREATE TABLE IF NOT EXISTS custom_images (
    id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    tag VARCHAR(255) NOT NULL,
    full_name VARCHAR(512) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    base_image VARCHAR(255),
    size BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, full_name)
);

CREATE INDEX IF NOT EXISTS idx_custom_images_user_id ON custom_images(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_images_public ON custom_images(is_public) WHERE is_public = TRUE;

CREATE TABLE IF NOT EXISTS persistent_volumes (
    id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    volume_name VARCHAR(255) NOT NULL UNIQUE,
    size_mb INTEGER DEFAULT 1024,
    mount_path VARCHAR(512) DEFAULT '/data',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_persistent_volumes_user_id ON persistent_volumes(user_id);
