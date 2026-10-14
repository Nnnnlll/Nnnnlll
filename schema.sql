-- nnnnlll 后端 D1 schema
-- 应用：wrangler d1 execute nnnnlll-db --local --file=./schema.sql
--       wrangler d1 execute nnnnlll-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,
  pass_hash  TEXT    NOT NULL,
  salt       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  game       TEXT    NOT NULL,
  score      REAL    NOT NULL,
  meta       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id, game, score DESC);