-- 统一任务表
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,            -- uuid
  title         TEXT NOT NULL,
  notes         TEXT,
  form          TEXT NOT NULL,               -- encounter | side_quest | main_quest
  importance    INTEGER NOT NULL DEFAULT 3,  -- 1~5
  urgency       INTEGER NOT NULL DEFAULT 3,  -- 1~5（用户标注）
  deadline      TEXT,                        -- ISO8601，可空
  estimated_min INTEGER,                     -- 预估耗时（分钟）
  status        TEXT NOT NULL DEFAULT 'open',-- open | doing | done | overdue | shelved
  parent_id     TEXT REFERENCES tasks(id),   -- 支线挂主线
  xp_value      INTEGER NOT NULL DEFAULT 10,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);

-- 步骤树（主线/支线的步骤）
CREATE TABLE task_steps (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_step_id TEXT REFERENCES task_steps(id),  -- 分支
  title         TEXT NOT NULL,
  order_index   INTEGER NOT NULL,
  deadline      TEXT,
  estimated_min INTEGER,
  surface_days  INTEGER,                     -- 提前几天浮现到今日（默认=预估天数）
  status        TEXT NOT NULL DEFAULT 'open',
  completed_at  TEXT
);
