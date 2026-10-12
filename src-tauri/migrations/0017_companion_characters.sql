-- Existing factual records belong to the original fox. User task rewards and
-- AI budgets remain shared. Names/outfits/keepsakes are saved in settings profiles.
ALTER TABLE companion_trips ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
ALTER TABLE companion_collection ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
ALTER TABLE companion_care_events ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
ALTER TABLE companion_play_sessions ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
ALTER TABLE companion_help_drafts ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
ALTER TABLE companion_chapters ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
ALTER TABLE companion_chapter_keepsakes ADD COLUMN character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'));
DROP INDEX one_companion_chapter;
CREATE UNIQUE INDEX one_companion_chapter ON companion_chapters(character) WHERE node<5;
CREATE INDEX companion_collection_character ON companion_collection(character,collected_at DESC);
CREATE INDEX companion_care_character ON companion_care_events(character,day,action);
CREATE INDEX companion_play_character ON companion_play_sessions(character,day,completed_at);

CREATE TABLE companion_memories_new (
 character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda')),
 event_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('focus','reading','writing','main','groom','trip','route','game')),
 entity_id TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',theme TEXT,
 day TEXT NOT NULL,created_at INTEGER NOT NULL,reverted_at INTEGER,
 forgotten INTEGER NOT NULL DEFAULT 0 CHECK(forgotten IN(0,1)),
 PRIMARY KEY(character,event_key)
);
INSERT INTO companion_memories_new(event_key,kind,entity_id,title,detail,theme,day,created_at,reverted_at,forgotten)
 SELECT event_key,kind,entity_id,title,detail,theme,day,created_at,reverted_at,forgotten FROM companion_memories;
DROP TABLE companion_memories;
ALTER TABLE companion_memories_new RENAME TO companion_memories;
CREATE INDEX companion_memory_recent ON companion_memories(character,forgotten,reverted_at,created_at DESC);

CREATE TABLE companion_goal_categories_new (
 character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda')),
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN('reading','writing')),confirmed_at INTEGER NOT NULL,
 PRIMARY KEY(character,task_id)
);
INSERT INTO companion_goal_categories_new(task_id,category,confirmed_at)
 SELECT task_id,category,confirmed_at FROM companion_goal_categories;
DROP TABLE companion_goal_categories;
ALTER TABLE companion_goal_categories_new RENAME TO companion_goal_categories;

-- Journey retries must retain their original owner, even after switching.
CREATE TABLE companion_journey_requests (
 request_id TEXT PRIMARY KEY REFERENCES agent_requests(request_id) ON DELETE CASCADE,
 character TEXT NOT NULL DEFAULT 'fox' CHECK(character IN('fox','red-panda'))
);
INSERT INTO companion_journey_requests(request_id) SELECT request_id FROM agent_requests WHERE tool='journey_action';
