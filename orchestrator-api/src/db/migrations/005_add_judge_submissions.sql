CREATE TABLE IF NOT EXISTS judge_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    language VARCHAR(20) NOT NULL,
    source_code TEXT NOT NULL,
    stdin TEXT,
    status VARCHAR(50) NOT NULL,
    stdout TEXT,
    stderr TEXT,
    exit_code INTEGER,
    time_used DECIMAL(10,6),
    wall_time_used DECIMAL(10,6),
    memory_used INTEGER,
    time_limit DECIMAL(10,3),
    memory_limit INTEGER,
    signal INTEGER,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_judge_submissions_user_id ON judge_submissions(user_id);
CREATE INDEX idx_judge_submissions_created_at ON judge_submissions(created_at DESC);
CREATE INDEX idx_judge_submissions_status ON judge_submissions(status);
