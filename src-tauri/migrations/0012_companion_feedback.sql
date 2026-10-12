CREATE TABLE companion_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,entity_id TEXT NOT NULL,title TEXT NOT NULL,form TEXT NOT NULL,created_at INTEGER NOT NULL,delivered_at INTEGER);
CREATE INDEX companion_feedback_pending ON companion_feedback(delivered_at,id);
CREATE TABLE companion_notice_queue(event_key TEXT PRIMARY KEY,entity_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,queued_at INTEGER NOT NULL);
