# PostHog Engineering Impact Dashboard

A take-home assignment for Weave — an engineering analytics dashboard that surfaces the most impactful contributors in the PostHog open-source repository over the last 90 days.

**Live demo:** https://dashboard-rose-psi-63.vercel.app

---

## What it measures

Each engineer is scored across three dimensions:

| Dimension | Weight | What it captures |
|-----------|--------|-----------------|
| **Delivery** | 40% | PR output adjusted for complexity (size) and speed (time to merge) |
| **Review Quality** | 40% | Review thoroughness — depth of feedback, quality of comments, turnaround speed |
| **Problem Spotting** | 20% | Issue reporting adjusted for severity and whether the reporter fixed it themselves |

All raw scores are normalized against the team's **p90** (90th percentile), so a score of 100 means top-decile performance relative to your peers — not an absolute ceiling.

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

- **Base type**: `1.0` for feature/fix, `0.7` for docs/chore, `0.5` for reverts
- **Complexity multiplier**: log-scale z-score of PR size (lines changed) relative to the team average. Larger PRs score higher, but with diminishing returns.
- **Speed multiplier**: time-to-merge relative to team p90. Merging in under 24h gives a `1.2×` bonus; taking over 2× the p90 gives a `0.8×` penalty.

---

## Review scoring

```
raw_score = count × avg_depth_weight × avg_speed_mult + complexity_bonus
```

- **Depth weight**: `1.5×` for `CHANGES_REQUESTED`, `1.0×` for `APPROVED` or `COMMENTED`; multiplied by substance signal (`1.3×` with body text, `1.1×` with inline comments, `1.0×` otherwise)
- **Speed multiplier**: how quickly the reviewer responded after the PR was opened
- **Complexity bonus**: extra credit for reviewing large, complex PRs

---

## Problem Spotting scoring

Each issue opened earns:

```
score = severity_weight × fixer_signal
```

- **Severity**: `2.0×` for bugs, `1.5×` for enhancements, `1.0×` for questions
- **Fixer signal**: `1.5×` if the reporter also submitted a fix PR, `1.0×` otherwise

---

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS v4**
- **GitHub REST API** — PRs, reviews, issues over a 90-day window
- **Vercel** — serverless deployment with static pre-computed data

---

## Running locally

```bash
# 1. Clone the repo
git clone <repo-url>
cd dashboard

# 2. Add your GitHub token
echo "GITHUB_TOKEN=ghp_..." > .env.local

# 3. Install and run
npm install
npm run dev
```

Then open http://localhost:3000.

> The first load fetches ~200 GitHub API requests and caches the result for 1 hour. Subsequent loads are instant.

---

## Project structure

```
app/
  page.tsx              # Dashboard UI — all components live here
  api/engineers/
    route.ts            # GitHub data fetching + scoring logic
public/
  engineers-data.json   # Pre-computed snapshot (used on Vercel to avoid cold-start rate limits)
```
