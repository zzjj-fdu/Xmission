CREATE TABLE goal_preferences (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 focused INTEGER NOT NULL DEFAULT 0 CHECK(focused IN(0,1)),
 stage_ack TEXT,
 manual_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_focused_goal ON goal_preferences(focused) WHERE focused=1;
CREATE TABLE planning_schedule (
 entity_key TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 step_id TEXT REFERENCES task_steps(id) ON DELETE CASCADE,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 signature TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE deleted_items (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('task','step')),
 entity_id TEXT NOT NULL, title TEXT NOT NULL, snapshot TEXT NOT NULL,
 deleted_at TEXT NOT NULL, restored_at TEXT
);
CREATE INDEX deleted_items_recent ON deleted_items(deleted_at);
CREATE TABLE planning_previews (
 id TEXT PRIMARY KEY, signature TEXT NOT NULL, payload TEXT NOT NULL,
 created_at TEXT NOT NULL, applied_at TEXT
);
CREATE TRIGGER planning_task_changed AFTER UPDATE OF title,deadline,estimated_min,status,planned_date,recurrence,recur_days ON tasks BEGIN
 DELETE FROM planning_schedule WHERE task_id=NEW.id;
END;
CREATE TRIGGER planning_step_changed AFTER UPDATE OF title,deadline,estimated_min,surface_days,status,parent_step_id,order_index ON task_steps BEGIN
 DELETE FROM planning_schedule WHERE step_id=NEW.id;
END;
CREATE TRIGGER planning_course_changed AFTER UPDATE ON courses BEGIN DELETE FROM planning_schedule; END;
CREATE TRIGGER planning_course_deleted AFTER DELETE ON courses BEGIN DELETE FROM planning_schedule; END;
CREATE TRIGGER planning_slot_added AFTER INSERT ON course_slots BEGIN DELETE FROM planning_schedule; END;
CREATE TRIGGER planning_slot_changed AFTER UPDATE ON course_slots BEGIN DELETE FROM planning_schedule; END;
CREATE TRIGGER planning_slot_deleted AFTER DELETE ON course_slots BEGIN DELETE FROM planning_schedule; END;
