# Circle Recommendations — Design

## What I built
A small Express API over SQLite: `GET /users/:id/recommendations` returns a ranked list of Circles, each with one member-facing sentence explaining why. Ranking is rules plus a weighted score, with no ML. The dataset has 40 Circles and no engagement outcomes to learn from, and a rules-based ranker is easy to explain, test and tune.

## The goal behind the ranking
Lean In's evidence is that *being in a Circle* is what moves careers. So the worst outcome isn't a slightly off-topic Circle. It's a new member joining a dead or full one and never coming back. That gave the order of operations:

1. **Hard filters first:** already joined, unlisted, full, inactive (no posts or no activity in 30 days). No amount of topic fit makes these a good first experience.
2. **Then score:** `0.6·topic + 0.25·activity + 0.1·open-join + 0.05·virtual/hybrid`.
   - *Topic* (primary 1.0, tag 0.5) is the member's own words, so it leads.
   - *Activity* = posts + chat/10 + post engagement/10 over 30 days, log-scaled. Posts are deliberate; chat and reactions are cheap.
   - *Open join* lowers friction for someone new.
   - *Virtual/hybrid*: Circles have no location, so these are the only formats we know a member can attend.
3. **Diversify:** one Circle per topic. Near-duplicates are interchangeable to a member, so the slot is better spent on her second interest.
4. **Explain** from the same signals: "Focused on Negotiation, one of your interests. 13 posts in the last 30 days, meets online and in person, open to join." Every clause is true and checkable. "Only 2 spots left" and "join by request" set expectations.

**Fallbacks:** no stated interests → use the topics of Circles she's in (29 users) → else cold start, ranked by activity and framed as "a great place to start" (user 42).

## Signals I chose not to use
Profile completeness, photo, bio, job title and industry have nothing on the Circle side to match against. Location: Circles have no location. Post text: generic. Leader profiles: valuable later ("led by a fellow engineering manager") but not needed for relevance here.

## Tradeoffs
- **Hand-tuned weights** instead of learned ones. Fine for 40 Circles; they'd be replaced once we log joins and 30-day retention.
- **One-per-topic diversity** is blunt. It hides a second good Circle on a topic she cares a lot about. A softer penalty (MMR) is the upgrade.
- **"Now" is pinned** to the dataset snapshot date so the scenarios are reproducible; production uses the real clock.
- **In-memory SQLite, rebuilt on boot**: zero setup for reviewers, not durable.
- **Template reasons, not an LLM**: deterministic, testable and free; an LLM could make them warmer but can say things that aren't true.

## Production scale (170k+ Circles, millions of members)
- **Postgres** with the same schema; activity aggregates refreshed by a scheduled job or from event streams, not computed per request.
- **Candidate generation before scoring:** pull Circles by the member's topics/tags via the existing indexes (plus a small "popular in region" pool), score a few hundred, never the whole catalog.
- **Precompute** lists for cold start and per topic; cache per-user results for minutes and invalidate on join/leave.
- **Location:** add a Circle location/timezone and match it for in-person Circles.
- **Measure:** log impressions, joins and 30-day retention per recommendation; A/B test weights; watch that small, newer Circles still get exposure.

## With more time
Learn weights from outcomes; give related topics partial credit (Confidence ↔ Imposter syndrome); use leader and member profiles (industry, seniority) for "people like you" signals; handle Circles with no topic (#27, #28) via tags or descriptions; an optional LLM pass to polish reasons, checked against the structured signals.

## How I used AI
I used Claude Code throughout. It summarized the brief and data, then profiled the dataset, which surfaced the pinned-date problem, unlisted Circles and one duplicated tag. It prototyped the scorer against the four planted users *before* any code was written. That prototype exposed that #1 and #5 are equally strong leadership Circles; I chose the "attendable format" signal to separate them because Circles have no location. Tests were written first and run against every user in the dataset, not just the planted ones. I reviewed and own every decision above.
