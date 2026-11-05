# Circle Recommendations API

Recommends Lean In Circles for a member to join: a ranked list, each with a short reason written for the member.

## Setup

Requires **Node.js 22.5+** (uses Node's built-in SQLite, so there's nothing native to compile).

```bash
npm install
npm start        # http://localhost:3000
npm test         # 16 tests, including the four planted scenarios
```

The database is built in memory from `data/*.json` each time the server starts.

## ⚠️ "Now" is pinned to the dataset date: 2026-09-21

The seed data is a snapshot generated on **2026-09-21** (see `ANCHOR` in `generate.mjs`); its newest activity is 2026-09-20. The recommender filters out Circles with no activity in the last 30 days, so **if it used your computer's clock, every Circle would look inactive and every member would get an empty list.** A test (`with the real clock, every Circle is stale…`) proves exactly that.

So all "is this Circle active?" checks and "last 30 days" windows measure from `2026-09-21T00:00:00Z`, not today. To use a different date:

```bash
REC_NOW=2026-10-01T00:00:00Z npm start
```

In production this goes away: "now" is the real clock, and activity counts are refreshed continuously, so they're never weeks old.

## API

### `GET /users/:id/recommendations?limit=5`

| Param | Rules |
|---|---|
| `id` | positive integer, must exist (else 400 / 404) |
| `limit` | optional, 1–20, default 5 (else 400) |

```bash
curl -s localhost:3000/users/7/recommendations?limit=3
```

```json
{
  "user_id": 7,
  "basis": "stated",
  "recommendations": [
    {
      "circle_id": 5,
      "name": "Women Who Lead",
      "topic": "leadership-skills",
      "format": "hybrid",
      "join_policy": "open",
      "score": 0.974,
      "reason": "Focused on Leadership skills, one of your interests. 11 posts in the last 30 days, meets online and in person, open to join."
    },
    {
      "circle_id": 6,
      "name": "Speak Up Circle",
      "topic": "public-speaking",
      "format": "in_person",
      "join_policy": "open",
      "score": 0.901,
      "reason": "Focused on Public speaking, one of your interests. 8 posts in the last 30 days, meets in person, open to join."
    },
    {
      "circle_id": 31,
      "name": "Team Leads Circle",
      "topic": "managing-a-team",
      "format": "in_person",
      "join_policy": "open",
      "score": 0.623,
      "reason": "Also covers Public speaking, one of your interests. 10 posts in the last 30 days, meets in person, open to join."
    }
  ]
}
```

`basis` says what the list is based on: `stated` (the member's chosen topics), `inferred` (topics of Circles she's already in), or `none` (cold start, ranked by activity).

## The planted scenarios

| Scenario | Request | Result |
|---|---|---|
| Cold start | `/users/42/recommendations` | 5 active, open Circles on 5 different topics, each "A great place to start: an active Circle on …" |
| Obvious matches | `/users/7/recommendations` | #5 Women Who Lead, then #6 Speak Up Circle |
| Duplicate Circles | `/users/15/recommendations` | Only one of #10/#11/#12 (Negotiation), then #13 Confident Voices for her other interest |
| Full / inactive | `/users/23/recommendations` | #22 Level Up Collective first; #20 (full) and #21 (inactive) never appear |

## How it ranks

1. **Filter** out Circles that would be a bad first experience: already joined, unlisted (invite-only), full, or inactive (no posts or no activity in 30 days).
2. **Score**: 0.6 × topic match (primary topic 1.0, tag 0.5) + 0.25 × activity (posts, chat and post engagement over 30 days, log-scaled) + 0.1 × open to join + 0.05 × virtual/hybrid.
3. **Diversify**: at most one Circle per topic.
4. **Explain**: one sentence built from the signals that drove the pick.

"Now" is pinned to the dataset snapshot (`2026-09-21`; see the section above). See [DESIGN.md](DESIGN.md) for the reasoning and tradeoffs.

## Database schema

Full DDL with comments: [`db/schema.sql`](db/schema.sql).

```
topics (slug UNIQUE) ◄── user_topic_interests ──► users ◄── memberships ──► circles ◄── circle_tags
                    ◄──────────── circles.topic_slug                          ▲
                                                                     posts ───┘
```

| Table | Key / index | Why |
|---|---|---|
| `user_topic_interests` | PK `(user_id, topic_slug)` | Normalizes the JSON array; the PK also serves "interests for user X". |
| `memberships` | PK `(user_id, circle_id)` + index `(circle_id, role)` | PK blocks double-joins and answers "Circles user X is in" (the exclusion check). The index answers "members/leaders of Circle Y". |
| `circles` | index `topic_slug` | Candidate lookup by topic once the catalog is too big to scan. |
| `circle_tags` | PK `(circle_id, tag)` + index `tag` | Same, for secondary topics. No FK to topics: tags are free-form in the product. |
| `posts` | index `(circle_id, created_at)` | "Engagement in this Circle in the last 30 days" is a range scan. |

Activity aggregates (`feed_posts_30d`, `chat_messages_30d`, `last_activity_at`) stay denormalized on `circles`, as in the source data: every request reads them for every candidate, so they belong precomputed.

## Layout

```
src/db.js          load schema + seed into in-memory SQLite
src/recommend.js   filter → score → diversify → explain
src/server.js      Express route + validation
db/schema.sql      schema
test/              node:test suites
data/              provided seed dataset (see data/README.md)
DESIGN.md          one-page design doc
```
