# PostHog Engineering Impact Dashboard

A take-home assignment for Weave — an engineering analytics dashboard that surfaces the most impactful contributors in the PostHog open-source repository over the last 90 days.

**Live demo:** https://dashboard-rose-psi-63.vercel.app

---

## What it measures

Each engineer is scored across three dimensions:

| Dimension | Weight | What it captures |
|-----------|--------|-----------------|
| **Delivery** | 40% | PR output adjusted for type, complexity (size), and merge speed |
| **Review Quality** | 40% | Review thoroughness — verdict depth, comment substance, turnaround speed |
| **Problem Spotting** | 20% | Issues filed, weighted by severity label |

All raw scores are normalized against the team's **p90** (90th percentile), so a score of 100 means top-decile performance relative to your peers.

### Score formula

```
normalized = min(raw / p90, 1.0) × 100

final = (delivery × 0.4) + (review × 0.4) + (problem_spotting × 0.2)
```

---

## Delivery scoring

Each merged PR earns points based on:

```
score = base_type × complexity_mult × speed_mult
```

**Base type** (from PR labels or title prefix):

| Type | Weight |
|------|--------|
| hotfix / critical | 3.0× |
| security | 2.5× |
| regression | 2.0× |
| bug / fix | 1.5× |
| feature / feat | 1.3× |
| performance / perf | 1.2× |
| refactor / default | 1.0× |
| test / docs | 0.5× |
| chore / deps | 0.2× |

**Complexity multiplier** — log-scale z-score of PR size (lines changed) vs. team average:

| z-score | Multiplier |
|---------|-----------|
| > 1.5 | 1.3× |
| > 0.5 | 1.2× |
| > −0.5 | 1.1× |
| ≤ −0.5 | 1.0× |

**Speed multiplier** — time from PR opened to merged:

| Time to merge | Multiplier |
|---------------|-----------|
| < 24 hours | 1.3× |
| < 72 hours | 1.1× |
| < 7 days | 1.0× |
| ≥ 7 days | 0.9× |

---

## Review scoring

```
raw_score = count × avg_depth_weight × avg_speed_mult + complexity_bonus
```

**Depth weight** — verdict × substance, averaged across all reviews:

| Verdict | Weight |
|---------|--------|
| CHANGES_REQUESTED | 1.5× |
| APPROVED / COMMENTED | 1.0× |

Substance multiplied on top of verdict:

| Review body length | Multiplier |
|--------------------|-----------|
| > 200 characters | 1.3× |
| > 50 characters | 1.1× |
| Bare approval | 1.0× |

**Speed multiplier** — time from PR opened to review submitted:

| Response time | Multiplier |
|---------------|-----------|
| < 4 hours | 1.2× |
| < 24 hours | 1.1× |
| < 72 hours | 1.0× |
| ≥ 72 hours | 0.9× |

**Complexity bonus** — flat bonus for reviewing large PRs (same z-score thresholds as delivery: +0.3 / +0.2 / +0.1 / 0).

---

## Problem Spotting scoring

Each issue opened earns:

```
score = severity_weight
```

| Label | Weight |
|-------|--------|
| critical / security | 3.0× |
| regression | 2.0× |
| bug | 1.5× |
| enhancement | 1.0× |
| no label / other | 0.5× |

---

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS v4**
- **GitHub GraphQL API** — `contributionsCollection` per engineer for PRs, reviews, and issues over a 90-day window; REST for org member list
- **Vercel** — serverless deployment with static pre-computed data

---

## Running locally

```bash
# 1. Clone the repo
git clone https://github.com/Rushil10/posthog-engineering-impact.git
cd posthog-engineering-impact

# 2. Add your GitHub token
echo "GITHUB_TOKEN=ghp_..." > .env.local

# 3. Install and run
npm install
npm run dev
```

Then open http://localhost:3000.

> The first load serves a pre-computed static snapshot instantly, then fires a background GraphQL recompute (~170 queries across 28 engineers) to warm the cache. Subsequent loads within the hour are instant.

---

## Project structure

```
app/
  page.tsx              # Dashboard UI — all components live here
  api/engineers/
    route.ts            # GitHub data fetching + scoring logic
public/
  engineers-data.json   # Pre-computed snapshot (served instantly on first load)
```
