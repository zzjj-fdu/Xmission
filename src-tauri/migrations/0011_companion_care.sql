CREATE TABLE companion_care_events (
 id TEXT PRIMARY KEY, day TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN('stroke','snack','brush','game')),
 moves INTEGER, affection_delta INTEGER NOT NULL CHECK(affection_delta BETWEEN 0 AND 8), created_at INTEGER NOT NULL
);
CREATE INDEX companion_care_day ON companion_care_events(day,action);
