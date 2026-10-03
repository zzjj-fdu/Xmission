-- M3.5 改进轮：循环任务 + 任务分类图标 + LLM 默认模型迁移 + 商店预设奖励

-- 循环任务（recurring tasks）：
-- recurrence: none | daily | weekly；weekly 用 recur_days（逗号分隔 1-7，周一=1）；
-- last_done_date 记最近完成日（YYYY-MM-DD，任务日 4:00 分界）；streak 为连续应做日完成数。
-- 循环任务永不进入永久 done，status 恒为 open/doing。
ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN recur_days TEXT;
ALTER TABLE tasks ADD COLUMN last_done_date TEXT;
ALTER TABLE tasks ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;

-- 任务语义分类图标：'' = 默认卷轴；其余为 13 个分类 key
-- study/code/read/write/sport/health/chore/finance/shopping/meeting/art/social/food
ALTER TABLE tasks ADD COLUMN icon TEXT NOT NULL DEFAULT '';

-- moonshot-v1 全系已停止新用户使用并将于 2026-08-31 全平台下线，
-- 老用户配置里的失效模型自动换成当前默认可用模型 kimi-k3（支持图片输入）。
UPDATE settings SET value = 'kimi-k3' WHERE key = 'llm_model' AND value LIKE 'moonshot-v1%';

-- 奖励商店预设（INSERT OR IGNORE：用户删过也不会复活）
INSERT OR IGNORE INTO rewards (id, title, price, stock, created_at) VALUES
  ('preset_milk_tea',   '奶茶一杯',           100, NULL, '2026-02-01T00:00:00Z'),
  ('preset_episode',    '看一集剧/动漫',       80, NULL, '2026-02-01T00:00:01Z'),
  ('preset_game_30',    '打游戏 30 分钟',     120, NULL, '2026-02-01T00:00:02Z'),
  ('preset_snack',      '零食放纵一下',        60, NULL, '2026-02-01T00:00:03Z'),
  ('preset_small_thing','买一件想要的小东西',  300, NULL, '2026-02-01T00:00:04Z'),
  ('preset_feast',      '周末大餐一顿',       500, NULL, '2026-02-01T00:00:05Z');
