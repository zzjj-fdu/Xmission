-- Preparations never change the user's task status or reward ledgers.
CREATE TABLE preparation_rules (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('writing','study','focus')),
 config_json TEXT NOT NULL, start_at TEXT NOT NULL, lead_min INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, needs_authorization INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(task_id,kind)
);
CREATE TABLE preparation_runs (
 id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, task_id TEXT NOT NULL,
 version INTEGER NOT NULL, action_at TEXT NOT NULL, due_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','running','ready','failed','cancelled','skipped','stale')),
 attempt INTEGER NOT NULL DEFAULT 0, lease_until TEXT, retry_at TEXT,
 output_dir TEXT, result_json TEXT, product_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(rule_id,version,action_at)
);
CREATE INDEX preparation_due ON preparation_runs(state,due_at);
CREATE TABLE preparation_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL,
 state TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE TRIGGER preparation_goal_changed AFTER UPDATE OF title,notes,deadline,planned_date,recurrence,recur_days,status,last_done_date ON tasks
WHEN OLD.title IS NOT NEW.title OR OLD.notes IS NOT NEW.notes OR OLD.deadline IS NOT NEW.deadline
 OR OLD.planned_date IS NOT NEW.planned_date OR OLD.recurrence IS NOT NEW.recurrence
 OR OLD.recur_days IS NOT NEW.recur_days OR OLD.status IS NOT NEW.status OR OLD.last_done_date IS NOT NEW.last_done_date
BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,
 error='目标或安排已变化，保留旧结果供检查',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE task_id=NEW.id AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1,
 config_json=CASE WHEN OLD.title IS NOT NEW.title THEN json_set(config_json,'$.topic',NEW.title) ELSE config_json END,
 start_at=CASE
  WHEN OLD.deadline IS NOT NEW.deadline AND NEW.deadline IS NOT NULL THEN
   CASE WHEN length(NEW.deadline)=10 THEN NEW.deadline||substr(start_at,11) ELSE NEW.deadline END
  WHEN OLD.planned_date IS NOT NEW.planned_date AND NEW.planned_date IS NOT NULL THEN NEW.planned_date||substr(start_at,11)
  ELSE start_at END,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE task_id=NEW.id;
END;
CREATE TRIGGER preparation_goal_deleted BEFORE DELETE ON tasks BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,
 error='原任务已删除，准备已停止',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE task_id=OLD.id AND state IN('queued','running','ready','failed');
 DELETE FROM preparation_rules WHERE task_id=OLD.id;
END;
CREATE TRIGGER preparation_course_changed AFTER UPDATE ON courses BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,
 error='课程变化，请检查学习范围',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_id IN(SELECT id FROM preparation_rules WHERE kind='study') AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1 WHERE kind='study';
END;
CREATE TRIGGER preparation_course_added AFTER INSERT ON courses BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error='课程变化，请检查学习范围' WHERE rule_id IN(SELECT id FROM preparation_rules WHERE kind='study') AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1 WHERE kind='study';
END;
CREATE TRIGGER preparation_course_deleted AFTER DELETE ON courses BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error='课程变化，请检查学习范围' WHERE rule_id IN(SELECT id FROM preparation_rules WHERE kind='study') AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1 WHERE kind='study';
END;
CREATE TRIGGER preparation_slot_changed AFTER UPDATE ON course_slots BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error='课时变化，请检查学习范围' WHERE rule_id IN(SELECT id FROM preparation_rules WHERE kind='study') AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1 WHERE kind='study';
END;
CREATE TRIGGER preparation_slot_added AFTER INSERT ON course_slots BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error='课时变化，请检查学习范围' WHERE rule_id IN(SELECT id FROM preparation_rules WHERE kind='study') AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1 WHERE kind='study';
END;
CREATE TRIGGER preparation_slot_deleted AFTER DELETE ON course_slots BEGIN
 UPDATE preparation_runs SET state=CASE WHEN state='ready' THEN 'stale' ELSE 'cancelled' END,error='课时变化，请检查学习范围' WHERE rule_id IN(SELECT id FROM preparation_rules WHERE kind='study') AND state IN('queued','running','ready','failed');
 UPDATE preparation_rules SET version=version+1 WHERE kind='study';
END;
CREATE TABLE companion_chapters (
 id TEXT PRIMARY KEY, theme TEXT NOT NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 node INTEGER NOT NULL DEFAULT 0 CHECK(node BETWEEN 0 AND 5), paused INTEGER NOT NULL DEFAULT 0,
 bag TEXT, route TEXT, discovery TEXT, game_best INTEGER, baseline TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_companion_chapter ON companion_chapters((1)) WHERE node<5;
CREATE TABLE companion_chapter_keepsakes (
 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL UNIQUE REFERENCES companion_chapters(id),
 theme TEXT NOT NULL, name TEXT NOT NULL, story TEXT NOT NULL, collected_at TEXT NOT NULL
);
