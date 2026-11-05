-- Topic taxonomy. Circles and members point at topics by slug, so slug is UNIQUE.
CREATE TABLE topics (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  has_photo            INTEGER NOT NULL CHECK (has_photo IN (0, 1)),
  bio                  TEXT,
  job_title            TEXT,
  company              TEXT,
  industry             TEXT,
  location             TEXT,
  joined_at            TEXT NOT NULL,
  profile_completeness REAL NOT NULL CHECK (profile_completeness BETWEEN 0 AND 1)
);

-- A member's stated interests: many-to-many users <-> topics.
-- PK (user_id, topic_slug) also serves "interests for user X" lookups.
CREATE TABLE user_topic_interests (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  topic_slug TEXT    NOT NULL REFERENCES topics(slug),
  PRIMARY KEY (user_id, topic_slug)
);

-- Activity aggregates (feed_posts_30d, chat_messages_30d, last_activity_at) are
-- denormalized onto the row: the recommender reads them for every candidate, and
-- in production they'd be refreshed by a job rather than computed per request.
CREATE TABLE circles (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  description       TEXT,
  topic_slug        TEXT REFERENCES topics(slug),  -- nullable: some Circles have no topic
  cover_image_url   TEXT,
  format            TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'hybrid')),
  access            TEXT NOT NULL CHECK (access IN ('public', 'unlisted')),
  join_policy       TEXT NOT NULL CHECK (join_policy IN ('open', 'request')),
  max_members       INTEGER,                        -- NULL = uncapped
  member_count      INTEGER NOT NULL,
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  feed_posts_30d    INTEGER NOT NULL,
  chat_messages_30d INTEGER NOT NULL
);
CREATE INDEX idx_circles_topic ON circles(topic_slug);

-- Tags are free-form in the product, so no FK to topics (today they happen to be topic slugs).
CREATE TABLE circle_tags (
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  tag       TEXT    NOT NULL,
  PRIMARY KEY (circle_id, tag)
);
CREATE INDEX idx_circle_tags_tag ON circle_tags(tag);

-- PK (user_id, circle_id) prevents double-joins and answers "which Circles is X in?".
-- The extra index answers the reverse: "who is in Circle Y?" (members, leaders).
CREATE TABLE memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  role      TEXT    NOT NULL CHECK (role IN ('member', 'leader')),
  joined_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, circle_id)
);
CREATE INDEX idx_memberships_circle ON memberships(circle_id, role);

-- Feed posts (activity.json). Indexed by (circle_id, created_at) for
-- "engagement in this Circle over the last 30 days".
CREATE TABLE posts (
  id             INTEGER PRIMARY KEY,
  circle_id      INTEGER NOT NULL REFERENCES circles(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT    NOT NULL,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  save_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL
);
CREATE INDEX idx_posts_circle_created ON posts(circle_id, created_at);
