CREATE TABLE companion_trips (
 id TEXT PRIMARY KEY, theme TEXT NOT NULL, route TEXT NOT NULL,
 duration_min INTEGER NOT NULL CHECK(duration_min IN (30,120,480)),
 started_at INTEGER NOT NULL, returns_at INTEGER NOT NULL CHECK(returns_at>started_at),
 state TEXT NOT NULL CHECK(state IN ('away','returned','claimed')),
 item_key TEXT NOT NULL,item_name TEXT NOT NULL,story TEXT NOT NULL
);
CREATE UNIQUE INDEX one_companion_journey ON companion_trips ((1)) WHERE state IN ('away','returned');
CREATE TABLE companion_collection (
 id TEXT PRIMARY KEY,trip_id TEXT NOT NULL UNIQUE REFERENCES companion_trips(id),
 theme TEXT NOT NULL,item_key TEXT NOT NULL,item_name TEXT NOT NULL,route TEXT NOT NULL,
 story TEXT NOT NULL,collected_at INTEGER NOT NULL
);
CREATE TABLE companion_reminders(event_key TEXT PRIMARY KEY,delivered_at INTEGER NOT NULL);
