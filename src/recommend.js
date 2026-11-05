// The seed data is a snapshot taken at 2026-09-21. Scoring against the real clock
// would make every Circle look stale, so "now" is pinned. Override with REC_NOW.
export const DATA_NOW = process.env.REC_NOW ?? "2026-09-21T00:00:00Z";
if (Number.isNaN(Date.parse(DATA_NOW))) throw new Error(`REC_NOW is not a valid date: ${DATA_NOW}`);

const DAY_MS = 86_400_000;
const ACTIVE_WINDOW_DAYS = 30;
const LOW_SPOTS = 3;

// ponytail: hand-tuned weights. Upgrade path: learn them from join/retention outcomes.
const WEIGHTS = { topic: 0.6, activity: 0.25, openJoin: 0.1, anyLocation: 0.05 };

const FORMAT_TEXT = {
  virtual: "meets virtually",
  hybrid: "meets online and in person",
  in_person: "meets in person",
};

export function recommend(db, userId, { limit = 5, now = DATA_NOW } = {}) {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  const nowMs = Date.parse(now);
  const { interests, basis } = interestsFor(db, userId);
  const labels = new Map(db.prepare("SELECT slug, label FROM topics").all().map((t) => [t.slug, t.label]));
  const circles = loadCircles(db, userId, nowMs);

  // Normalize activity against the busiest Circle so it lands in 0..1.
  const maxActivity = Math.max(...circles.map(activityRaw));

  const scored = circles
    .filter((c) => isEligible(c, nowMs))
    .map((c) => {
      const match = topicMatch(c, interests);
      const activity = Math.log1p(activityRaw(c)) / Math.log1p(maxActivity);
      const score =
        WEIGHTS.topic * match.strength +
        WEIGHTS.activity * activity +
        WEIGHTS.openJoin * (c.join_policy === "open" ? 1 : 0) +
        WEIGHTS.anyLocation * (c.format === "in_person" ? 0 : 1);
      return { circle: c, match, score };
    })
    .sort((a, b) => b.score - a.score || a.circle.id - b.circle.id);

  return {
    user_id: user.id,
    basis,
    recommendations: diversify(scored, limit).map(({ circle, match, score }) => ({
      circle_id: circle.id,
      name: circle.name,
      topic: circle.topic_slug,
      format: circle.format,
      join_policy: circle.join_policy,
      score: Math.round(score * 1000) / 1000,
      reason: explain(circle, match, basis, labels),
    })),
  };
}

// Stated interests first; if none, infer from the topics of Circles the member already joined.
function interestsFor(db, userId) {
  const stated = db
    .prepare("SELECT topic_slug FROM user_topic_interests WHERE user_id = ?")
    .all(userId)
    .map((r) => r.topic_slug);
  if (stated.length) return { interests: new Set(stated), basis: "stated" };

  const inferred = db
    .prepare(
      `SELECT DISTINCT c.topic_slug FROM memberships m JOIN circles c ON c.id = m.circle_id
       WHERE m.user_id = ? AND c.topic_slug IS NOT NULL`,
    )
    .all(userId)
    .map((r) => r.topic_slug);
  return { interests: new Set(inferred), basis: inferred.length ? "inferred" : "none" };
}

function loadCircles(db, userId, nowMs) {
  const since = new Date(nowMs - ACTIVE_WINDOW_DAYS * DAY_MS).toISOString();
  return db
    .prepare(
      `SELECT c.*,
         COALESCE(e.engagement, 0) AS engagement_30d,
         (SELECT json_group_array(tag) FROM circle_tags t WHERE t.circle_id = c.id) AS tags_json,
         EXISTS (SELECT 1 FROM memberships m WHERE m.circle_id = c.id AND m.user_id = ?) AS is_member
       FROM circles c
       LEFT JOIN (
         SELECT circle_id, SUM(reaction_count + comment_count + save_count) AS engagement
         FROM posts WHERE created_at >= ? GROUP BY circle_id
       ) e ON e.circle_id = c.id`,
    )
    .all(userId, since)
    .map((c) => ({ ...c, tags: JSON.parse(c.tags_json) }));
}

// Hard filters: things that make a Circle a bad first experience no matter how well it matches.
export function isEligible(c, nowMs) {
  if (c.is_member) return false;
  if (c.access !== "public") return false; // unlisted = invite-only
  if (c.max_members !== null && c.member_count >= c.max_members) return false; // full
  const quietDays = (nowMs - Date.parse(c.last_activity_at)) / DAY_MS;
  if (c.feed_posts_30d === 0 || quietDays > ACTIVE_WINDOW_DAYS) return false; // inactive
  return true;
}

// Posts are the strongest signal; chat messages and reactions are cheap, so they count 1/10.
function activityRaw(c) {
  return c.feed_posts_30d + c.chat_messages_30d / 10 + c.engagement_30d / 10;
}

// Primary topic match = 1, secondary (tag) match = 0.5, none = 0.
function topicMatch(c, interests) {
  if (c.topic_slug && interests.has(c.topic_slug)) return { strength: 1, slug: c.topic_slug };
  const tag = c.tags.find((t) => interests.has(t));
  return tag ? { strength: 0.5, slug: tag } : { strength: 0, slug: null };
}

// One Circle per topic, so near-duplicates (three Negotiation Circles) don't crowd the list.
function diversify(scored, limit) {
  const seen = new Set();
  const out = [];
  for (const item of scored) {
    if (out.length >= limit) break;
    const key = item.circle.topic_slug ?? `circle:${item.circle.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function explain(c, match, basis, labels) {
  const label = labels.get(match.slug);
  const because = basis === "inferred" ? "like a Circle you're already in" : "one of your interests";
  let fit;
  if (match.strength === 1) fit = `Focused on ${label}, ${because}`;
  else if (match.strength > 0) fit = `Also covers ${label}, ${because}`;
  else {
    const opener = basis === "none" ? "A great place to start" : "Something new to explore";
    const what = c.topic_slug
      ? `an active Circle on ${labels.get(c.topic_slug)}`
      : "one of the most active Circles right now";
    fit = `${opener}: ${what}`;
  }

  const details = [`${c.feed_posts_30d} posts in the last 30 days`, FORMAT_TEXT[c.format]];
  if (c.max_members !== null) {
    const spots = c.max_members - c.member_count;
    if (spots <= LOW_SPOTS) details.push(`only ${spots} ${spots === 1 ? "spot" : "spots"} left`);
  }
  details.push(c.join_policy === "open" ? "open to join" : "join by request");

  const sentence = details.join(", ");
  return `${fit}. ${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}
