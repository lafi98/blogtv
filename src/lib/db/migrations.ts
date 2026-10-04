/**
 * Ordered, append-only schema migrations. Never edit a migration that has shipped —
 * add a new one with the next version number instead.
 */
import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Optional data step run in the same transaction after `sql`. */
  run?: (db: Database.Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE categories (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  intro_md         TEXT NOT NULL DEFAULT '',
  seo_title        TEXT,
  meta_description TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE images (
  id            INTEGER PRIMARY KEY,
  file_key      TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL DEFAULT '',
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  alt           TEXT NOT NULL DEFAULT '',
  caption       TEXT NOT NULL DEFAULT '',
  credit        TEXT NOT NULL DEFAULT '',
  license       TEXT NOT NULL,
  source_url    TEXT NOT NULL DEFAULT '',
  variants_json TEXT NOT NULL DEFAULT '[]',
  og_file       TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE authors (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT '',
  bio             TEXT NOT NULL DEFAULT '',
  avatar_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  website_url     TEXT NOT NULL DEFAULT '',
  same_as_json    TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE articles (
  id                INTEGER PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  excerpt           TEXT NOT NULL DEFAULT '',
  content_md        TEXT NOT NULL DEFAULT '',
  category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  author_id         INTEGER REFERENCES authors(id) ON DELETE SET NULL,
  featured_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','review','scheduled','published','archived')),
  featured          INTEGER NOT NULL DEFAULT 0,
  published_at      TEXT,
  content_updated_at TEXT,
  scheduled_for     TEXT,
  seo_title         TEXT NOT NULL DEFAULT '',
  meta_description  TEXT NOT NULL DEFAULT '',
  canonical_url     TEXT NOT NULL DEFAULT '',
  noindex           INTEGER NOT NULL DEFAULT 0,
  tags_json         TEXT NOT NULL DEFAULT '[]',
  faq_json          TEXT NOT NULL DEFAULT '[]',
  related_json      TEXT NOT NULL DEFAULT '[]',
  sources_json      TEXT NOT NULL DEFAULT '[]',
  ai_assisted       INTEGER NOT NULL DEFAULT 0,
  reviewed_by       TEXT NOT NULL DEFAULT '',
  validation_json   TEXT,
  validation_status TEXT CHECK (validation_status IN ('pass','warn','fail')),
  word_count        INTEGER NOT NULL DEFAULT 0,
  reading_minutes   INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  modified_at       TEXT NOT NULL
);
CREATE INDEX idx_articles_public ON articles(status, published_at DESC);
CREATE INDEX idx_articles_category ON articles(category_id, status, published_at DESC);
CREATE INDEX idx_articles_scheduled ON articles(status, scheduled_for);

-- Full-text search (rowid = articles.id), maintained by the articles repository.
CREATE VIRTUAL TABLE articles_fts USING fts5(title, excerpt, body, tags, tokenize = 'porter unicode61');

CREATE TABLE topics (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT '',
  keywords      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  priority      INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','in_progress','used','rejected','failed')),
  article_id    INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE generation_runs (
  id          INTEGER PRIMARY KEY,
  run_date    TEXT NOT NULL,
  trigger     TEXT NOT NULL DEFAULT 'manual',
  topic_id    INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running','review','scheduled','draft','failed','skipped')),
  stage       TEXT NOT NULL DEFAULT 'start',
  log_json    TEXT NOT NULL DEFAULT '[]',
  usage_json  TEXT NOT NULL DEFAULT '{}',
  error       TEXT NOT NULL DEFAULT '',
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_runs_date ON generation_runs(run_date);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','editor')),
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE subscribers (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','unsubscribed')),
  token_hash      TEXT NOT NULL,
  consent_text    TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  confirmed_at    TEXT,
  unsubscribed_at TEXT
);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  INTEGER,
  details    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'keyword queue, AI run audit log, daily publication slots, SEO fields',
    sql: `
ALTER TABLE articles ADD COLUMN primary_keyword TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN related_keywords_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE articles ADD COLUMN og_title TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN og_description TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN ai_run_id INTEGER;

-- Keyword queue. One row per keyword; a keyword is "consumed" only when its article is
-- published or scheduled (status published/scheduled).
CREATE TABLE keywords (
  id          INTEGER PRIMARY KEY,
  keyword     TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'queue' CHECK (source IN ('queue','manual')),
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','generating','published','scheduled','draft','failed','skipped_duplicate')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  last_run_id INTEGER,
  last_error  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX idx_keywords_queue ON keywords(status, position);
CREATE UNIQUE INDEX idx_keywords_active ON keywords(normalized) WHERE status IN ('queued','generating');

-- Audit log: one row per AI run (manual or scheduled).
CREATE TABLE ai_runs (
  id                  INTEGER PRIMARY KEY,
  keyword_id          INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
  keyword             TEXT NOT NULL,
  trigger             TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('draft','publish')),
  status              TEXT NOT NULL CHECK (status IN
                        ('QUEUED','GENERATING','VALIDATING','DRAFT','SCHEDULED','PUBLISHED','FAILED','SKIPPED_DUPLICATE')),
  publish_day         TEXT,
  article_id          INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  claude_status       TEXT NOT NULL DEFAULT 'not_called',
  claude_detail       TEXT NOT NULL DEFAULT '',
  validation_status   TEXT,
  validation_errors   INTEGER,
  validation_warnings INTEGER,
  validation_json     TEXT,
  publication_result  TEXT NOT NULL DEFAULT 'not_attempted',
  duplicate_of_slug   TEXT,
  duplicate_reason    TEXT,
  error               TEXT NOT NULL DEFAULT '',
  log_json            TEXT NOT NULL DEFAULT '[]',
  usage_json          TEXT NOT NULL DEFAULT '{}',
  started_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX idx_ai_runs_started ON ai_runs(started_at DESC);

-- At most one AI publication per publishing day (PRIMARY KEY = day). This table is the
-- server-side source of truth for the daily limit and for cron idempotency.
CREATE TABLE ai_publication_slots (
  day         TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('claimed','published','scheduled','released')),
  run_id      INTEGER,
  article_id  INTEGER,
  keyword_id  INTEGER,
  attempts    INTEGER NOT NULL DEFAULT 0,
  claimed_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Mutual exclusion so two AI runs never execute at the same time.
CREATE TABLE ai_locks (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`,
  },
  {
    version: 3,
    name: 'drop legacy topic queue (replaced by keywords + ai_runs)',
    sql: `
DROP TABLE IF EXISTS generation_runs;
DROP TABLE IF EXISTS topics;
`,
  },
];
