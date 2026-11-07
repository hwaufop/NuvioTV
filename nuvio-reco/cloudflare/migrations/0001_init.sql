CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  token_box TEXT NOT NULL,
  trakt_box TEXT,
  pending_device_box TEXT,
  watched_json TEXT NOT NULL DEFAULT '{"movie":[],"series":[]}',
  status TEXT NOT NULL DEFAULT 'unlinked',
  reason_title TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS catalogs (
  profile_id TEXT NOT NULL,
  type TEXT NOT NULL,
  lane TEXT NOT NULL,
  metas_json TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(profile_id, type, lane),
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS profiles_synced_idx ON profiles(synced_at);
