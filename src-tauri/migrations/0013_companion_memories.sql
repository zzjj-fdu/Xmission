CREATE TABLE companion_memories (
 event_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN('focus','reading','writing','main','groom','trip','route','game')),
 entity_id TEXT NOT NULL,
 title TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 theme TEXT,
 day TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 reverted_at INTEGER,
 forgotten INTEGER NOT NULL DEFAULT 0 CHECK(forgotten IN(0,1))
);
CREATE INDEX companion_memory_recent ON companion_memories(forgotten,reverted_at,created_at DESC);
CREATE TABLE companion_goal_categories (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN('reading','writing')),
 confirmed_at INTEGER NOT NULL
);
ALTER TABLE companion_trips ADD COLUMN weather TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE companion_trips ADD COLUMN phase TEXT NOT NULL DEFAULT 'noon';

-- Only existing, factual records are carried forward. Reading/writing need explicit consent.
INSERT OR IGNORE INTO companion_memories(event_key,kind,entity_id,title,detail,day,created_at)
SELECT 'focus:'||id,'focus',id,'一起完成一段专注','这段专注已经记录在本机。',date(updated_at,'localtime'),CAST(strftime('%s',updated_at) AS INTEGER)*1000
FROM pomodoro_sessions WHERE state='done' AND date(updated_at) IS NOT NULL;
INSERT OR IGNORE INTO companion_memories(event_key,kind,entity_id,title,detail,day,created_at)
SELECT 'main:'||id,'main',id,'一起走完了「'||title||'」','这条已完成的主线，收进我们的共同经历。',date(completed_at,'localtime'),CAST(strftime('%s',completed_at) AS INTEGER)*1000
FROM tasks WHERE form='main_quest' AND status='done' AND recurrence='none' AND date(completed_at) IS NOT NULL;
INSERT OR IGNORE INTO companion_memories(event_key,kind,entity_id,title,detail,day,created_at)
SELECT 'groom:'||day,'groom',MIN(id),'尾巴又蓬松起来了','这一天已经在本机记录过梳毛。',day,MIN(created_at)
FROM companion_care_events WHERE action='brush' GROUP BY day;
INSERT OR IGNORE INTO companion_memories(event_key,kind,entity_id,title,detail,theme,day,created_at)
SELECT 'trip:'||trip_id,'trip',trip_id,'带回了'||item_name,story,theme,date(collected_at/1000,'unixepoch','localtime'),collected_at
FROM companion_collection;
INSERT OR IGNORE INTO companion_memories(event_key,kind,entity_id,title,detail,theme,day,created_at)
SELECT 'route:'||theme||':'||route,'route',MIN(trip_id),'第一次沿一条新路线回来','从背包里收好第一份沿途的小发现。',theme,date(MIN(collected_at)/1000,'unixepoch','localtime'),MIN(collected_at)
FROM companion_collection GROUP BY theme,route;
INSERT OR IGNORE INTO settings(key,value)
SELECT 'companion_keepsake',id FROM companion_collection ORDER BY collected_at DESC,id LIMIT 1;
