-- M3：课表 + 日历 + 节假日 + AI 建议历史

CREATE TABLE IF NOT EXISTS courses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  teacher     TEXT,
  location    TEXT,
  color       TEXT,
  weeks_mask  TEXT NOT NULL DEFAULT '1-16',   -- 周次范围，如 "1-16"、"1-8,10-16"
  week_parity TEXT NOT NULL DEFAULT 'all',    -- all | odd | even
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_slots (
  id            TEXT PRIMARY KEY,
  course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday       INTEGER NOT NULL,             -- 1~7（周一~周日）
  start_time    TEXT NOT NULL,                -- "HH:MM"
  end_time      TEXT NOT NULL,
  override_week INTEGER                       -- 调课覆盖：仅某周生效（可空）
);

CREATE TABLE IF NOT EXISTS holidays (
  date    TEXT PRIMARY KEY,                   -- YYYY-MM-DD
  name    TEXT NOT NULL,
  is_off  INTEGER NOT NULL                    -- 1=放假，0=调休上班
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                -- parse_task | decompose | suggest_now | plan_week | schedule_ocr | external_agent
  input_summary TEXT,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  created_at    TEXT NOT NULL
);

-- 2026 年法定节假日（国务院办公厅《关于2026年部分节假日安排的通知》国办发明电〔2025〕7 号）
-- is_off=1 放假；is_off=0 调休上班日
INSERT OR IGNORE INTO holidays (date, name, is_off) VALUES
  -- 元旦：1月1日至3日放假调休，1月4日（周日）上班
  ('2026-01-01', '元旦', 1),
  ('2026-01-02', '元旦', 1),
  ('2026-01-03', '元旦', 1),
  ('2026-01-04', '元旦调休上班', 0),
  -- 春节：2月15日至23日放假调休，2月14日、2月28日上班
  ('2026-02-14', '春节调休上班', 0),
  ('2026-02-15', '春节', 1),
  ('2026-02-16', '春节', 1),
  ('2026-02-17', '春节', 1),
  ('2026-02-18', '春节', 1),
  ('2026-02-19', '春节', 1),
  ('2026-02-20', '春节', 1),
  ('2026-02-21', '春节', 1),
  ('2026-02-22', '春节', 1),
  ('2026-02-23', '春节', 1),
  ('2026-02-28', '春节调休上班', 0),
  -- 清明节：4月4日至6日放假
  ('2026-04-04', '清明节', 1),
  ('2026-04-05', '清明节', 1),
  ('2026-04-06', '清明节', 1),
  -- 劳动节：5月1日至5日放假调休，5月9日上班
  ('2026-05-01', '劳动节', 1),
  ('2026-05-02', '劳动节', 1),
  ('2026-05-03', '劳动节', 1),
  ('2026-05-04', '劳动节', 1),
  ('2026-05-05', '劳动节', 1),
  ('2026-05-09', '劳动节调休上班', 0),
  -- 端午节：6月19日至21日放假
  ('2026-06-19', '端午节', 1),
  ('2026-06-20', '端午节', 1),
  ('2026-06-21', '端午节', 1),
  -- 中秋节：9月25日至27日放假
  ('2026-09-25', '中秋节', 1),
  ('2026-09-26', '中秋节', 1),
  ('2026-09-27', '中秋节', 1),
  -- 国庆节：10月1日至7日放假调休，9月20日、10月10日上班
  ('2026-09-20', '国庆节调休上班', 0),
  ('2026-10-01', '国庆节', 1),
  ('2026-10-02', '国庆节', 1),
  ('2026-10-03', '国庆节', 1),
  ('2026-10-04', '国庆节', 1),
  ('2026-10-05', '国庆节', 1),
  ('2026-10-06', '国庆节', 1),
  ('2026-10-07', '国庆节', 1),
  ('2026-10-10', '国庆节调休上班', 0);
