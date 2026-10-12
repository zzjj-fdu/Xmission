CREATE TABLE companion_play_sessions (
 id TEXT PRIMARY KEY,
 started_at INTEGER NOT NULL,
 completed_at INTEGER,
 day TEXT NOT NULL,
 catches INTEGER NOT NULL DEFAULT 0 CHECK(catches BETWEEN 0 AND 3)
);
CREATE INDEX companion_play_days ON companion_play_sessions(day,completed_at);
CREATE TABLE companion_ai_calls (
 id TEXT PRIMARY KEY,
 day TEXT NOT NULL,
 started_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN('reserved','complete','failed')),
 reserved_tokens INTEGER NOT NULL,
 input_tokens INTEGER,
 output_tokens INTEGER,
 model TEXT NOT NULL DEFAULT '',
 usage_known INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX companion_ai_days ON companion_ai_calls(day,started_at);
CREATE TABLE companion_help_drafts (
 id TEXT PRIMARY KEY,
 scenario TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN('ready','dismissed'))
);
