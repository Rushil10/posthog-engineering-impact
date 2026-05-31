# Engineering Impact Framework
## PostHog GitHub Analysis — Last 90 Days

---

## What is Impact?

> **Impact = shipping quality work + helping others ship + spotting real problems**

Someone who does all three consistently over 90 days is genuinely impactful.
Not someone who committed code every day or wrote the most lines.

### The Three Dimensions

| Dimension | Question | Weight |
|-----------|----------|--------|
| Delivery | Did you ship things that mattered? | 40% |
| Review Quality | Did you make teammates better? | 40% |
| Problem Spotting | Did you surface real problems? | 20% |

---

## Who Counts as a Core Engineer?

```
INCLUDE if:
  - 3+ PRs merged in 90 days  (consistent delivery)
  - OR 5+ reviews submitted   (consistent reviewing)
  - login does NOT end in [bot]

EXCLUDE:
  - Bots (dependabot, github-actions[bot], etc.)
  - One-off external contributors
  - Non-engineers (0 PRs merged, only comments)
```

---

## Pre-Processing: Auto-Generated File Exclusion

Before computing lines changed on any PR, strip auto-generated files.

**Step 1:** Fetch PostHog's `.gitattributes` once at the start.
Files marked `linguist-generated=true` are excluded automatically.

**Step 2:** Fall back to standard patterns for anything not covered:
```
*.lock, *-lock.json, *.min.js, *.min.css
dist/*, build/*, *_generated.*, *.pb.go, *.snap
```

This runs programmatically on every file in every PR — not manually per PR.

---

## Language-Relative Complexity (shared by D1 and D2)

Absolute line counts mean nothing without language context.
A 500-line Python PR where the average Python PR is 1000 lines is below average.

```
Step 1: Pull all merged PRs + their files
Step 2: Determine primary language per PR
        → language with the most FILES changed (not lines)
        → after excluding auto-generated files
Step 3: Compute per-language baseline
        → if language has < 10 PRs in 90 days, fall back to global baseline
Step 4: Log-transform before z-score
        → PR sizes follow a power-law, not a normal distribution
        → log-transform compresses the tail

z = (log1p(pr_lines) - log1p(lang_mean)) / log1p(lang_std)
```

| Z-Score         | Complexity Level | Multiplier (D1) | Bonus (D2) |
|-----------------|------------------|-----------------|------------|
| > 1.5           | Well above avg   | × 1.3           | + 0.3      |
| 0.5 – 1.5       | Above average    | × 1.2           | + 0.2      |
| -0.5 – 0.5      | Around average   | × 1.1           | + 0.1      |
| < -0.5          | Below average    | × 1.0           | + 0.0      |

---

## Dimension 1: Delivery — Did You Ship Things That Mattered?

### Formula

```
PR SCORE = BASE_WEIGHT × COMPLEXITY_MULTIPLIER × SPEED_MULTIPLIER

DELIVERY SCORE = Σ (PR SCORE) for all merged PRs in last 90 days
```

### BASE_WEIGHT (what kind of problem was it?)

Determined by labels first, then title prefix (`fix:`, `feat:`, `hotfix:`).
If multiple labels → take the max weight.
If no label and no prefix → default to 1.0.

| Label / Type       | Weight |
|--------------------|--------|
| hotfix / critical  | 3.0    |
| security           | 2.5    |
| regression         | 2.0    |
| bug fix            | 1.5    |
| feature            | 1.3    |
| performance        | 1.2    |
| refactor / default | 1.0    |
| test / docs        | 0.5    |
| chore / deps       | 0.2    |

### COMPLEXITY_MULTIPLIER

Language-relative z-score (see shared section above).

### SPEED_MULTIPLIER (created_at → merged_at)

Only applied if the PR has at least 1 reviewer approval.
A self-merged PR with 0 reviews gets no speed reward.

| Time to Merge | Multiplier |
|---------------|------------|
| < 1 day       | × 1.3      |
| 1–3 days      | × 1.1      |
| 3–7 days      | × 1.0      |
| 7+ days       | × 0.9      |

### Worked Example

| PR                          | Base | Complexity | Speed | Score |
|-----------------------------|------|------------|-------|-------|
| hotfix: fix data loss       | 3.0  | × 1.3      | × 1.3 | 5.07  |
| fix: billing edge case      | 1.5  | × 1.2      | × 1.1 | 1.98  |
| feat: CSV export            | 1.3  | × 1.2      | × 1.0 | 1.56  |
| chore: bump deps            | 0.2  | × 1.0      | × 1.0 | 0.20  |
| refactor: clean auth module | 1.0  | × 1.0      | × 0.9 | 0.90  |
| **DELIVERY SCORE**          |      |            |       | **9.71** |

---

## Dimension 2: Review Quality — Did You Make Teammates Better?

### Formula

```
PER REVIEW SCORE = (VERDICT × SUBSTANCE × SPEED) + COMPLEXITY_BONUS

REVIEW SCORE = Σ (PER REVIEW SCORE) for all reviews in last 90 days
```

Excludes:
- Self-reviews (`reviewer_login == pr_author_login`)
- Reviews on PRs that never merged

### VERDICT

| Verdict           | Multiplier | Notes |
|-------------------|------------|-------|
| CHANGES_REQUESTED | × 1.5      | Caught a real issue |
| APPROVED          | × 1.0      | Signed off, unblocked |
| COMMENTED         | × 1.0      | Not penalized — substance handles value |

### SUBSTANCE (your own inline review comments)

| Your Inline Comments | Multiplier |
|----------------------|------------|
| 5+                   | × 1.3      |
| 2–4                  | × 1.1      |
| 0–1                  | × 1.0      |

### SPEED (PR created_at → review submitted_at)

| Review Turnaround | Multiplier |
|-------------------|------------|
| < 4 hours         | × 1.2      |
| 4–24 hours        | × 1.1      |
| 1–3 days          | × 1.0      |
| 3+ days           | × 0.9      |

### COMPLEXITY_BONUS (language-relative z-score of PR reviewed)

Additive — not multiplicative. Avoids rewarding rushed reviews on hard PRs.
Uses the same z-score as D1 (independent of review activity — no circular dependency).

| Z-Score     | Bonus |
|-------------|-------|
| > 1.5       | + 0.3 |
| 0.5 – 1.5   | + 0.2 |
| -0.5 – 0.5  | + 0.1 |
| < -0.5      | + 0.0 |

### Worked Example

| Review                                          | Verdict | Substance | Speed | Complexity | Score |
|-------------------------------------------------|---------|-----------|-------|------------|-------|
| CHANGES_REQUESTED, 6 comments, 3hrs, z=+1.8    | × 1.5   | × 1.3     | × 1.2 | + 0.3      | 3.81  |
| APPROVED, 0 comments, 2hrs, z=-0.3             | × 1.0   | × 1.0     | × 1.2 | + 0.1      | 1.30  |
| COMMENTED, 3 comments, 5hrs, z=+0.8            | × 1.0   | × 1.1     | × 1.1 | + 0.2      | 1.53  |
| APPROVED, 1 comment, 4 days, z=-0.6            | × 1.0   | × 1.0     | × 0.9 | + 0.0      | 0.90  |

### Key Properties
- LGTM-only reviewers score low even with high volume
- Catching real issues (CHANGES_REQUESTED) is rewarded
- Detailed COMMENTED reviews score equal to APPROVED
- Speed and complexity don't stack multiplicatively
- Complexity uses lines changed (independent of reviewer activity)

---

## Dimension 3: Problem Spotting — Did You Surface Real Problems?

### Formula

```
ISSUE SCORE = BASE_WEIGHT × FIXER_SIGNAL × ENGAGEMENT × TRIAGE_SPEED
              + REFERENCE_BONUS

PROBLEM SCORE = Σ (ISSUE SCORE) for all issues opened in last 90 days
```

### BASE_WEIGHT (severity of what you spotted)

| Label               | Weight |
|---------------------|--------|
| critical / security | 3.0    |
| regression          | 2.0    |
| bug                 | 1.5    |
| enhancement         | 1.0    |
| no label            | 0.5    |
| never closed        | 0.0    |

### FIXER_SIGNAL (who fixed it?)

Checks closing PR author vs issue author. Prevents double-counting with D1.

| Situation                  | Multiplier | Why |
|----------------------------|------------|-----|
| Fixed by someone else      | × 1.4      | Pure cross-codebase spotting — no D1 overlap |
| Fixed by the filer         | × 0.8      | D1 already credits the fix PR |
| Closed without a PR        | × 1.0      | Resolved another way, neutral |
| Never closed               | × 0.0      | Not confirmed real — excluded |

### ENGAGEMENT (did the filer stay involved?)

Only counts filer's own comments after the initial filing.

| Filer's Follow-up Comments | Multiplier |
|----------------------------|------------|
| 2+                         | × 1.2      |
| 1                          | × 1.1      |
| 0                          | × 1.0      |

### TRIAGE_SPEED (how fast did a peer validate it?)

How quickly did another engineer (not the filer) label or respond.
This is peer validation — not fix speed (which is outside the filer's control).

| First Peer Response | Multiplier |
|---------------------|------------|
| Within 24 hours     | × 1.2      |
| Within 1 week       | × 1.1      |
| Longer or never     | × 1.0      |

### REFERENCE_BONUS

```python
if issue_number in pr_body:  # "fixes #123", "closes #456"
    score += 0.2
```

Strongest signal the issue was well-documented — a developer fixing it explicitly linked it.

### Worked Example

| Issue                                        | Base | Fixer | Engagement | Triage | Ref  | Score |
|----------------------------------------------|------|-------|------------|--------|------|-------|
| "Ingestion drops data under load" (critical, fixed by other, 3 follow-ups, triaged <24h, referenced) | 3.0 | ×1.4 | ×1.2 | ×1.2 | +0.2 | 7.25 |
| "Dashboard crashes Safari" (bug, fixed by self, 0 follow-ups, triaged <1wk) | 1.5 | ×0.8 | ×1.0 | ×1.1 | +0.0 | 1.32 |
| "Add dark mode" (enhancement, never closed)  | 1.0  | ×0.0  | —          | —      | —    | 0.00  |
| **PROBLEM SCORE**                            |      |       |            |        |      | **8.57** |

---

## Final Combined Score

### Normalization

Raw scores across dimensions are not comparable in scale.
Normalize each relative to the **90th percentile** (not max) to prevent one outlier collapsing everyone else.

```python
NORMALIZED_DELIVERY = min(delivery / p90_delivery, 1.0) × 100
NORMALIZED_REVIEW   = min(review   / p90_review,   1.0) × 100
NORMALIZED_PROBLEM  = min(problem  / p90_problem,  1.0) × 100
```

### Final Score

```
FINAL SCORE = (NORMALIZED_DELIVERY × 0.40)
            + (NORMALIZED_REVIEW   × 0.40)
            + (NORMALIZED_PROBLEM  × 0.20)
```

### Why p90 Not Max

- One hyperactive engineer with 10× the score of #2 collapses everyone into bottom 10%
- p90 means the top ~10% of engineers all score near 100 in that dimension
- Rankings 2nd through 5th remain meaningful and distinguishable

---

## Known Limitations

- **CHANGES_REQUESTED gaming**: engineers aware of the formula could click it on every PR for ×1.5. Acceptable for now.
- **Seniority inversion**: senior engineers write smaller, surgical PRs (lower z-score). Log-transform reduces but doesn't eliminate this.
- **PR splitting**: 1 feature as 5 small PRs scores more entries than 1 large PR. Affects everyone equally.
- **Recency**: 90 days weights all days equally. An engineer on vacation 3 weeks appears less impactful.
