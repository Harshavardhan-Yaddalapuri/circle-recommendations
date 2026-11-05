import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const load = (name) => JSON.parse(read(`data/${name}.json`));

// ponytail: in-memory SQLite rebuilt from the JSON seed on every start (~1k rows, a few ms).
// Production: Postgres, loaded once, with the same schema.
export function openDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(read("db/schema.sql"));
  seed(db);
  return db;
}

function insertAll(db, sql, rows) {
  const stmt = db.prepare(sql);
  for (const row of rows) stmt.run(...row);
}

function seed(db) {
  const topics = load("topics");
  const users = load("users");
  const circles = load("circles");
  const memberships = load("memberships");
  const posts = load("activity");

  db.exec("BEGIN");
  insertAll(db, "INSERT INTO topics VALUES (?, ?, ?)",
    topics.map((t) => [t.id, t.slug, t.label]));
  insertAll(db, "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    users.map((u) => [u.id, u.first_name, u.last_name, u.has_photo ? 1 : 0, u.bio, u.job_title,
      u.company, u.industry, u.location, u.joined_at, u.profile_completeness]));
  insertAll(db, "INSERT INTO user_topic_interests VALUES (?, ?)",
    users.flatMap((u) => u.topic_interests.map((slug) => [u.id, slug])));
  insertAll(db, "INSERT INTO circles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    circles.map((c) => [c.id, c.name, c.slug, c.description, c.topic, c.cover_image_url, c.format,
      c.access, c.join_policy, c.max_members, c.member_count, c.created_at, c.last_activity_at,
      c.feed_posts_30d, c.chat_messages_30d]));
  // One Circle in the seed lists a tag twice; the Set drops the repeat.
  insertAll(db, "INSERT INTO circle_tags VALUES (?, ?)",
    circles.flatMap((c) => [...new Set(c.tags)].map((tag) => [c.id, tag])));
  insertAll(db, "INSERT INTO memberships VALUES (?, ?, ?, ?)",
    memberships.map((m) => [m.user_id, m.circle_id, m.role, m.joined_at]));
  insertAll(db, "INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    posts.map((p) => [p.id, p.circle_id, p.author_user_id, p.body, p.reaction_count,
      p.comment_count, p.save_count, p.created_at]));
  db.exec("COMMIT");
}
