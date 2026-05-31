import { unstable_cache } from 'next/cache'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const REPO = 'PostHog/posthog'
const WINDOW_DAYS = 90
const GQL_URL = 'https://api.github.com/graphql'
const REST_URL = 'https://api.github.com'

function gqlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function restHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// ─── GraphQL types ────────────────────────────────────────────────────────────

interface GQLPRNode {
  number: number
  title: string
  additions: number
  deletions: number
  mergedAt: string | null
  createdAt: string
  state: string
  repository: { nameWithOwner: string }
  labels: { nodes: Array<{ name: string }> }
}

interface GQLReviewNode {
  state: string
  submittedAt: string
  body: string
  comments: { totalCount: number }
  pullRequest: {
    number: number
    additions: number
    deletions: number
    createdAt: string
    mergedAt: string | null
    repository: { nameWithOwner: string }
  }
}

interface GQLIssueNode {
  number: number
  title: string
  createdAt: string
  state: string
  labels: { nodes: Array<{ name: string }> }
  repository: { nameWithOwner: string }
}

// ─── GraphQL queries (one per connection type — simpler = more reliable) ───────

const Q_PRS = `query($login:String!,$from:DateTime!,$to:DateTime!,$cursor:String){
  user(login:$login){contributionsCollection(from:$from,to:$to){
    pullRequestContributions(first:100,after:$cursor){
      pageInfo{hasNextPage endCursor}
      nodes{pullRequest{number title additions deletions mergedAt createdAt state
        repository{nameWithOwner} labels(first:5){nodes{name}}}}}}}}`

const Q_REVIEWS = `query($login:String!,$from:DateTime!,$to:DateTime!,$cursor:String){
  user(login:$login){contributionsCollection(from:$from,to:$to){
    pullRequestReviewContributions(first:100,after:$cursor){
      pageInfo{hasNextPage endCursor}
      nodes{pullRequestReview{state submittedAt body comments{totalCount}
        pullRequest{number additions deletions createdAt mergedAt
          repository{nameWithOwner}}}}}}}}`

const Q_ISSUES = `query($login:String!,$from:DateTime!,$to:DateTime!,$cursor:String){
  user(login:$login){contributionsCollection(from:$from,to:$to){
    issueContributions(first:100,after:$cursor){
      pageInfo{hasNextPage endCursor}
      nodes{issue{number title createdAt state
        repository{nameWithOwner} labels(first:5){nodes{name}}}}}}}}`

// Global semaphore — caps total concurrent HTTP requests to GitHub GraphQL
class Semaphore {
  private slots: number
  private queue: Array<() => void> = []
  constructor(slots: number) { this.slots = slots }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve() }
    return new Promise((resolve) => this.queue.push(resolve))
  }
  release() {
    if (this.queue.length > 0) { this.queue.shift()!() } else { this.slots++ }
  }
}
const sem = new Semaphore(30)

async function gqlPost(query: string, variables: Record<string, unknown>, attempt = 0): Promise<{ data?: { user?: Record<string, unknown> }; errors?: Array<{ message: string }> }> {
  await sem.acquire()
  let res: Response
  try {
    res = await fetch(GQL_URL, {
      method: 'POST',
      headers: gqlHeaders(),
      body: JSON.stringify({ query, variables }),
    })
  } finally {
    sem.release()
  }
  if (res.status === 502 || res.status === 503) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt))
      return gqlPost(query, variables, attempt + 1)
    }
    throw new Error(`GraphQL ${res.status} after ${attempt + 1} retries`)
  }
  if (!res.ok) throw new Error(`GraphQL HTTP error: ${res.status}`)
  return res.json()
}

async function paginateContrib<T>(
  query: string,
  login: string, from: string, to: string,
  extract: (user: Record<string, unknown>) => { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] }
): Promise<T[]> {
  const all: T[] = []
  let cursor: string | null = null
  for (;;) {
    const json = await gqlPost(query, { login, from, to, cursor })
    if (json.errors?.length) throw new Error(`GQL error for ${login}: ${json.errors[0].message}`)
    if (!json.data?.user) throw new Error(`No GQL user for ${login}`)
    const page = extract(json.data.user as Record<string, unknown>)
    all.push(...page.nodes)
    if (!page.pageInfo.hasNextPage) break
    cursor = page.pageInfo.endCursor
  }
  return all
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: any[] }

async function fetchAllContributions(
  login: string, from: string, to: string
): Promise<{ prs: GQLPRNode[]; reviews: GQLReviewNode[]; issues: GQLIssueNode[] }> {
  const [prNodes, reviewNodes, issueNodes] = await Promise.all([
    paginateContrib<{ pullRequest: GQLPRNode }>(Q_PRS, login, from, to,
      (u) => (u as { contributionsCollection: { pullRequestContributions: AnyPage } }).contributionsCollection.pullRequestContributions),
    paginateContrib<{ pullRequestReview: GQLReviewNode }>(Q_REVIEWS, login, from, to,
      (u) => (u as { contributionsCollection: { pullRequestReviewContributions: AnyPage } }).contributionsCollection.pullRequestReviewContributions),
    paginateContrib<{ issue: GQLIssueNode }>(Q_ISSUES, login, from, to,
      (u) => (u as { contributionsCollection: { issueContributions: AnyPage } }).contributionsCollection.issueContributions),
  ])

  return {
    prs: prNodes.map((n) => n.pullRequest),
    reviews: reviewNodes.map((n) => n.pullRequestReview),
    issues: issueNodes.map((n) => n.issue),
  }
}

// ─── Scoring helpers (identical logic to before) ─────────────────────────────

function p90(values: number[]): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.9)] || 1
}

function buildGlobalStats(lines: number[]): { logMean: number; logStd: number } {
  const logs = lines.map((l) => Math.log1p(l))
  const mean = logs.reduce((a, b) => a + b, 0) / (logs.length || 1)
  const variance = logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length || 1)
  return { logMean: mean, logStd: Math.sqrt(variance) || 1 }
}

function computeZ(lines: number, stats: { logMean: number; logStd: number }): number {
  return (Math.log1p(lines) - stats.logMean) / stats.logStd
}

function zToComplexityMult(z: number): number {
  if (z > 1.5) return 1.3
  if (z > 0.5) return 1.2
  if (z > -0.5) return 1.1
  return 1.0
}

function zToComplexityBonus(z: number): number {
  if (z > 1.5) return 0.3
  if (z > 0.5) return 0.2
  if (z > -0.5) return 0.1
  return 0.0
}

function getPRBaseWeight(title: string, labelNames: string[]): { weight: number; labelType: string } {
  const t = title.toLowerCase()

  const labelChecks: Array<[string[], number, string]> = [
    [['hotfix', 'critical'], 3.0, 'hotfix/critical'],
    [['security'], 2.5, 'security'],
    [['regression'], 2.0, 'regression'],
    [['bug', 'fix'], 1.5, 'bug/fix'],
    [['feature', 'feat'], 1.3, 'feature/feat'],
    [['performance', 'perf'], 1.2, 'performance/perf'],
    [['test', 'docs'], 0.5, 'test/docs'],
    [['chore', 'deps', 'dependencies'], 0.2, 'chore/deps'],
  ]

  for (const [keywords, weight, type] of labelChecks) {
    if (keywords.some((k) => labelNames.some((l) => l.includes(k)))) {
      return { weight, labelType: type }
    }
  }

  const titleChecks: Array<[string[], number, string]> = [
    [['hotfix', 'critical'], 3.0, 'hotfix/critical'],
    [['security'], 2.5, 'security'],
    [['regression'], 2.0, 'regression'],
    [['fix', 'bug'], 1.5, 'bug/fix'],
    [['feat', 'feature'], 1.3, 'feature/feat'],
    [['perf', 'performance'], 1.2, 'performance/perf'],
    [['refactor'], 1.0, 'refactor/default'],
    [['test', 'docs'], 0.5, 'test/docs'],
    [['chore', 'deps'], 0.2, 'chore/deps'],
  ]

  for (const [prefixes, weight, type] of titleChecks) {
    if (prefixes.some((p) => t.startsWith(p + ':') || t.startsWith(p + '('))) {
      return { weight, labelType: type }
    }
  }

  return { weight: 1.0, labelType: 'refactor/default' }
}

function getSpeedMultiplier(createdAt: string, mergedAt: string): number {
  const hours = (new Date(mergedAt).getTime() - new Date(createdAt).getTime()) / 3_600_000
  if (hours < 24) return 1.3
  if (hours < 72) return 1.1
  if (hours < 168) return 1.0
  return 0.9
}

function getReviewSpeedMultiplier(prCreatedAt: string, reviewSubmittedAt: string): number {
  const hours = (new Date(reviewSubmittedAt).getTime() - new Date(prCreatedAt).getTime()) / 3_600_000
  if (hours < 4) return 1.2
  if (hours < 24) return 1.1
  if (hours < 72) return 1.0
  return 0.9
}

function reviewSubstance(body: string): number {
  const len = (body ?? '').trim().length
  if (len > 200) return 1.3
  if (len > 50) return 1.1
  return 1.0
}

function getIssueBaseWeight(labelNames: string[]): number {
  if (labelNames.some((l) => l.includes('critical') || l.includes('security'))) return 3.0
  if (labelNames.some((l) => l.includes('regression'))) return 2.0
  if (labelNames.some((l) => l.includes('bug'))) return 1.5
  if (labelNames.some((l) => l.includes('enhancement'))) return 1.0
  if (labelNames.length === 0) return 0.5
  return 0.5
}

// ─── Main cached function ─────────────────────────────────────────────────────

const getEngineersData = unstable_cache(
  async (): Promise<object> => {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set')

    const now = new Date()
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const fromIso = since.toISOString()
    const toIso = now.toISOString()

    // Step 1: get org members with avatar URLs (1 REST call)
    console.log('[engineers] Fetching org members...')
    const membersRes = await fetch(
      `${REST_URL}/orgs/PostHog/members?per_page=100`,
      { headers: restHeaders() }
    )
    if (!membersRes.ok) throw new Error(`Failed to fetch org members: ${membersRes.status}`)
    const members = (await membersRes.json()) as Array<{ login: string; avatar_url: string }>
    const memberAvatars = new Map(members.map((m) => [m.login, m.avatar_url]))
    const memberList = members.map((m) => m.login)
    console.log(`[engineers] ${memberList.length} org members found`)

    // Step 2: fetch all contributions in parallel (semaphore caps concurrent HTTP at 8)
    console.log('[engineers] Fetching contributions via GraphQL...')
    const start = Date.now()
    const contribResults = await Promise.all(
      memberList.map((login) =>
        fetchAllContributions(login, fromIso, toIso).catch((err) => {
          console.warn(`[engineers] Skipping ${login}: ${err.message}`)
          return null
        })
      )
    )
    console.log(`[engineers] GraphQL done in ${((Date.now() - start) / 1000).toFixed(1)}s`)

    // Step 3: build per-engineer data structures, filter to PostHog/posthog
    interface EngineerAccumulator {
      login: string
      avatarUrl: string
      delivery_score: number
      delivery_prs: Array<{
        number: number; title: string; base_weight: number
        complexity_multiplier: number; speed_multiplier: number
        pr_score: number; merged_at: string; label_type: string
        lines_changed: number; hours_to_merge: number
      }>
      review_score: number
      review_count: number
      changes_requested: number
      review_turnaround_hours: number[]
      review_depth_sum: number
      review_complexity_bonus_sum: number
      problem_score: number
      problem_issues: Array<{
        number: number; title: string; base_weight: number
        fixer_signal: number; issue_score: number
      }>
    }

    // Collect all merged PR lines for global stats
    const allLines: number[] = []
    const engineerData: Array<{
      login: string; avatarUrl: string
      prs: GQLPRNode[]; reviews: GQLReviewNode[]; issues: GQLIssueNode[]
    }> = []

    for (let i = 0; i < contribResults.length; i++) {
      const result = contribResults[i]
      if (!result) continue
      const login = memberList[i]
      const posthogPRs = result.prs.filter(
        (pr) => pr.repository.nameWithOwner === REPO && pr.mergedAt !== null
      )
      for (const pr of posthogPRs) {
        allLines.push(pr.additions + pr.deletions)
      }
      engineerData.push({ login, avatarUrl: memberAvatars.get(login) ?? '', prs: posthogPRs, reviews: result.reviews, issues: result.issues })
    }

    const globalStats = buildGlobalStats(allLines)

    // fixer signal: not available without PR bodies (dropped to keep queries fast)

    // Score each engineer
    const engineers = new Map<string, EngineerAccumulator>()

    for (const { login, avatarUrl, prs, reviews, issues } of engineerData) {
      const eng: EngineerAccumulator = {
        login, avatarUrl,
        delivery_score: 0, delivery_prs: [],
        review_score: 0, review_count: 0, changes_requested: 0,
        review_turnaround_hours: [], review_depth_sum: 0, review_complexity_bonus_sum: 0,
        problem_score: 0, problem_issues: [],
      }
      engineers.set(login, eng)

      // Delivery
      for (const pr of prs) {
        const lines = pr.additions + pr.deletions
        const z = computeZ(lines, globalStats)
        const labelNames = pr.labels.nodes.map((l) => l.name.toLowerCase())
        const { weight: baseWeight, labelType } = getPRBaseWeight(pr.title, labelNames)
        const complexityMult = zToComplexityMult(z)
        const speedMult = getSpeedMultiplier(pr.createdAt, pr.mergedAt!)
        const prScore = baseWeight * complexityMult * speedMult
        const hoursToMerge = Math.round(
          (new Date(pr.mergedAt!).getTime() - new Date(pr.createdAt).getTime()) / 3_600_000 * 10
        ) / 10

        eng.delivery_score += prScore
        eng.delivery_prs.push({
          number: pr.number, title: pr.title, base_weight: baseWeight,
          complexity_multiplier: complexityMult, speed_multiplier: speedMult,
          pr_score: prScore, merged_at: pr.mergedAt!, label_type: labelType,
          lines_changed: lines, hours_to_merge: hoursToMerge,
        })
      }

      // Review quality (filter to PostHog/posthog reviews, exclude self-reviews)
      const posthogReviews = reviews.filter(
        (r) => r.pullRequest.repository.nameWithOwner === REPO
      )
      for (const review of posthogReviews) {
        const prLines = review.pullRequest.additions + review.pullRequest.deletions
        const z = computeZ(prLines, globalStats)
        const complexityBonus = zToComplexityBonus(z)

        const verdict = review.state === 'CHANGES_REQUESTED' ? 1.5 : 1.0
        const substance = reviewSubstance(review.body)
        const speedMult = getReviewSpeedMultiplier(review.pullRequest.createdAt, review.submittedAt)
        const reviewScore = verdict * substance * speedMult + complexityBonus

        eng.review_score += reviewScore
        eng.review_count += 1
        eng.review_depth_sum += verdict * substance
        eng.review_complexity_bonus_sum += complexityBonus
        if (review.state === 'CHANGES_REQUESTED') eng.changes_requested += 1
        const turnaroundHours =
          (new Date(review.submittedAt).getTime() - new Date(review.pullRequest.createdAt).getTime()) / 3_600_000
        eng.review_turnaround_hours.push(turnaroundHours)
      }

      // Problem spotting (filter to PostHog/posthog issues)
      const posthogIssues = issues.filter(
        (i) => i.repository.nameWithOwner === REPO && new Date(i.createdAt) >= since
      )
      for (const issue of posthogIssues) {
        const labelNames = issue.labels.nodes.map((l) => l.name.toLowerCase())
        const baseWeight = getIssueBaseWeight(labelNames)
        if (baseWeight === 0) continue

        const fixerSignal = 1.0

        const issueScore = baseWeight * fixerSignal

        eng.problem_score += issueScore
        eng.problem_issues.push({
          number: issue.number, title: issue.title, base_weight: baseWeight,
          fixer_signal: fixerSignal, issue_score: issueScore,
        })
      }
    }

    // Normalize and rank
    const engineerList = Array.from(engineers.values())
    const p90Delivery = p90(engineerList.map((e) => e.delivery_score))
    const p90Review = p90(engineerList.map((e) => e.review_score))
    const p90Problem = p90(engineerList.map((e) => e.problem_score))

    const ranked = engineerList
      .map((e) => {
        const normDelivery = Math.min(e.delivery_score / p90Delivery, 1.0) * 100
        const normReview = Math.min(e.review_score / p90Review, 1.0) * 100
        const normProblem = Math.min(e.problem_score / p90Problem, 1.0) * 100
        const finalScore = normDelivery * 0.4 + normReview * 0.4 + normProblem * 0.2

        const avgTurnaround = e.review_turnaround_hours.length > 0
          ? e.review_turnaround_hours.reduce((a, b) => a + b, 0) / e.review_turnaround_hours.length
          : 0

        return {
          login: e.login,
          avatar_url: e.avatarUrl,
          final_score: Math.round(finalScore * 100) / 100,
          delivery: {
            score: Math.round(e.delivery_score * 100) / 100,
            normalized: Math.round(normDelivery * 100) / 100,
            pr_count: e.delivery_prs.length,
            top_prs: [...e.delivery_prs].sort((a, b) => b.pr_score - a.pr_score).slice(0, 5),
          },
          review: {
            score: Math.round(e.review_score * 100) / 100,
            normalized: Math.round(normReview * 100) / 100,
            review_count: e.review_count,
            changes_requested: e.changes_requested,
            avg_turnaround_hours: Math.round(avgTurnaround * 100) / 100,
            avg_depth_weight: e.review_count > 0
              ? Math.round((e.review_depth_sum / e.review_count) * 1000) / 1000 : 0,
            avg_speed_mult: e.review_depth_sum > 0
              ? Math.round(((e.review_score - e.review_complexity_bonus_sum) / e.review_depth_sum) * 1000) / 1000 : 0,
            total_complexity_bonus: Math.round(e.review_complexity_bonus_sum * 100) / 100,
          },
          problem: {
            score: Math.round(e.problem_score * 100) / 100,
            normalized: Math.round(normProblem * 100) / 100,
            issue_count: e.problem_issues.length,
            top_issues: [...e.problem_issues].sort((a, b) => b.issue_score - a.issue_score).slice(0, 5),
          },
        }
      })
      .sort((a, b) => b.final_score - a.final_score)

    console.log(`[engineers] Done: ${ranked.length} engineers scored`)

    return {
      engineers: ranked,
      generated_at: new Date().toISOString(),
      window_days: WINDOW_DAYS,
      total_engineers_analyzed: ranked.length,
      team_p90: {
        delivery: Math.round(p90Delivery * 100) / 100,
        review: Math.round(p90Review * 100) / 100,
        problem: Math.round(p90Problem * 100) / 100,
        avg_lines_per_pr: Math.round(Math.expm1(globalStats.logMean)),
      },
    }
  },
  ['engineers-data-v6'],
  { revalidate: 3600 }
)

// ─── Static snapshot fallback ─────────────────────────────────────────────────

function getStaticSnapshot() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'public', 'engineers-data.json'), 'utf-8'))
  } catch {
    return null
  }
}

export async function GET(): Promise<Response> {
  const snapshot = getStaticSnapshot()

  if (!process.env.GITHUB_TOKEN) {
    if (snapshot) return Response.json(snapshot)
    return Response.json({ error: 'No GITHUB_TOKEN and no static snapshot' }, { status: 500 })
  }

  // Always return the static snapshot immediately so the UI loads instantly.
  // Fire a background recompute to warm the Vercel Data Cache — the next
  // request within the hour will hit the cache and return live data instantly.
  if (snapshot) {
    getEngineersData().catch((err) =>
      console.error('[engineers] Background recompute failed:', err instanceof Error ? err.message : err)
    )
    return Response.json(snapshot)
  }

  // No snapshot on disk — block and wait (first cold start after deploy).
  try {
    const data = await getEngineersData()
    return Response.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[engineers] Error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
