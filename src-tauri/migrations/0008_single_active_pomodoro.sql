-- Repair legacy duplicate active sessions before enforcing the invariant.
-- Keep the newest session; retain the other records as abandoned history.
UPDATE pomodoro_sessions SET state = 'abandoned'
WHERE state IN ('running', 'paused') AND id != (
  SELECT id FROM pomodoro_sessions WHERE state IN ('running', 'paused')
  ORDER BY updated_at DESC, rowid DESC LIMIT 1
);
CREATE UNIQUE INDEX one_active_pomodoro ON pomodoro_sessions ((1))
WHERE state IN ('running', 'paused');
