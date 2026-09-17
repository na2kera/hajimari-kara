CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  start_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 300),
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_status_created ON events(status, created_at DESC);
