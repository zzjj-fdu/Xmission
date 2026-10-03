CREATE TABLE pomodoro_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  started_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'running',   -- running | paused | done | abandoned
  remaining_secs INTEGER NOT NULL,          -- 暂停时冻结的剩余秒数；running 时也保持最新
  updated_at TEXT NOT NULL
);
CREATE TABLE xp_ledger (
  id TEXT PRIMARY KEY, delta INTEGER NOT NULL,
  reason TEXT NOT NULL, ref_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE coin_ledger (
  id TEXT PRIMARY KEY, delta INTEGER NOT NULL,
  reason TEXT NOT NULL, ref_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE rewards (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  price INTEGER NOT NULL, stock INTEGER,    -- NULL = 不限量
  created_at TEXT NOT NULL
);
CREATE TABLE reward_redemptions (
  id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES rewards(id),
  reward_title TEXT NOT NULL,               -- 冗余存标题，奖励删了记录也可读
  price_paid INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE streaks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,                    -- 'YYYY-MM-DD'，任务日（4:00 分界）
  frozen INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO streaks (id, current) VALUES (1, 0);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
