-- A mutation and its durable retry receipt commit in the same transaction.
-- Contains no access token or model credentials. Keep receipts across restarts.
CREATE TABLE agent_requests (
    request_id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX agent_requests_created ON agent_requests(created_at);
