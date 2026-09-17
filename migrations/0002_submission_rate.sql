CREATE TABLE IF NOT EXISTS submission_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
