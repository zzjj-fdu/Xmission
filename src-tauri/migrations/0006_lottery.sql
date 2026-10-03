CREATE TABLE IF NOT EXISTS lottery_draws (
  id TEXT PRIMARY KEY,
  prize_title TEXT NOT NULL,
  prize_kind TEXT NOT NULL,
  prize_amount INTEGER NOT NULL,
  cost_paid INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
