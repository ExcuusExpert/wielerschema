-- Dit schema maakt de worker zelf aan bij het eerste verzoek. Dit bestand is alleen ter documentatie
-- (of om handmatig in de D1-console te plakken).
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL, consent_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS plans (user_id TEXT PRIMARY KEY, intake TEXT NOT NULL, answers TEXT NOT NULL, outline TEXT NOT NULL, summary TEXT NOT NULL, start_date TEXT NOT NULL, total_weeks INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS weeks (user_id TEXT NOT NULL, week_no INTEGER NOT NULL, detail TEXT NOT NULL, checkin TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, week_no));
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_counters_day ON counters(day);
