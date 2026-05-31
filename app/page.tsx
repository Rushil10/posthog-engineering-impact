"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

interface TopPR {
  number: number;
  title: string;
  base_weight: number;
  complexity_multiplier: number;
  speed_multiplier: number;
  pr_score: number;
  merged_at: string;
  label_type: string;
  lines_changed: number;
  hours_to_merge: number;
}

interface TopIssue {
  number: number;
  title: string;
  base_weight: number;
  fixer_signal: number;
  issue_score: number;
}

interface EngineerData {
  login: string;
  avatar_url: string;
  final_score: number;
  delivery: {
    score: number;
    normalized: number;
    pr_count: number;
    top_prs: TopPR[];
  };
  review: {
    score: number;
    normalized: number;
    review_count: number;
    changes_requested: number;
    avg_turnaround_hours: number;
    avg_depth_weight: number;
    avg_speed_mult: number;
    total_complexity_bonus: number;
  };
  problem: {
    score: number;
    normalized: number;
    issue_count: number;
    top_issues: TopIssue[];
  };
}

interface TeamP90 {
  delivery: number;
  review: number;
  problem: number;
  avg_lines_per_pr?: number;
}

interface APIResponse {
  engineers: EngineerData[];
  generated_at: string;
  window_days: number;
  total_engineers_analyzed: number;
  team_p90?: TeamP90;
  error?: string;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatTurnaround(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function labelTypeBadge(labelType: string): string {
  const map: Record<string, string> = {
    bug: "Bug fix",
    feature: "Feature",
    refactor: "Refactor",
    perf: "Performance",
    docs: "Docs",
    test: "Test",
    chore: "Chore",
  };
  return map[labelType?.toLowerCase()] ?? labelType ?? "PR";
}

function DimTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex items-center cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <svg className="w-3 h-3 ml-0.5 opacity-35 hover:opacity-60 transition-opacity shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {show && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 w-56 rounded-xl shadow-xl border text-xs p-3 leading-relaxed pointer-events-none"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          {text}
        </div>
      )}
    </span>
  );
}

const RANK_STYLES: Record<number, { badge: string; border: string; dot: string }> = {
  1: {
    badge: "text-[var(--rank-gold)] bg-amber-50 border border-amber-200",
    border: "border-[var(--rank-gold)]",
    dot: "bg-[var(--rank-gold)]",
  },
  2: {
    badge: "text-[var(--rank-silver)] bg-slate-50 border border-slate-200",
    border: "border-[var(--rank-silver)]",
    dot: "bg-[var(--rank-silver)]",
  },
  3: {
    badge: "text-[var(--rank-bronze)] bg-orange-50 border border-orange-200",
    border: "border-[var(--rank-bronze)]",
    dot: "bg-[var(--rank-bronze)]",
  },
};

function ScoreTooltip({ engineer }: { engineer: EngineerData }) {
  const [show, setShow] = useState(false);
  const d = Math.round(engineer.delivery.normalized);
  const r = Math.round(engineer.review.normalized);
  const p = Math.round(engineer.problem.normalized);
  const computed = Math.round(d * 0.4 + r * 0.4 + p * 0.2);

  return (
    <div
      className="relative inline-flex flex-col items-end cursor-help select-none"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <div className="flex items-baseline gap-0.5">
        <span className="text-2xl font-bold leading-none" style={{ color: "var(--primary)" }}>
          {Math.round(engineer.final_score)}
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          /100
        </span>
      </div>
      <span className="text-[9px] leading-none mt-0.5 opacity-40" style={{ color: "var(--text-secondary)" }}>
        impact score ↑
      </span>
      {show && (
        <div
          className="absolute top-full right-0 mt-1 z-50 w-52 rounded-xl shadow-xl border text-xs p-3"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          <div className="font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
            How this score is calculated
          </div>
          <div className="space-y-1.5">
            {[
              { label: "Delivery × 40%", val: d, contribution: Math.round(d * 0.4), color: "var(--primary)" },
              { label: "Review × 40%", val: r, contribution: Math.round(r * 0.4), color: "#4A8FA0" },
              { label: "Problems × 20%", val: p, contribution: Math.round(p * 0.2), color: "var(--accent)" },
            ].map(({ label, val, contribution, color }) => (
              <div key={label} className="flex justify-between items-center gap-2">
                <span style={{ color }}>{label}</span>
                <span className="tabular-nums">
                  <span className="opacity-60">{val}</span>
                  <span className="font-semibold ml-1">→ {contribution}</span>
                </span>
              </div>
            ))}
            <div className="border-t pt-1.5 mt-1 flex justify-between font-bold" style={{ borderColor: "var(--border)" }}>
              <span>Final score</span>
              <span>{computed}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({
  label,
  value,
  color,
  weight,
  info,
}: {
  label: string;
  value: number;
  color: string;
  weight: string;
  info?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-sm">
        <span className="flex items-center" style={{ color: "var(--text-secondary)" }}>
          {label}{" "}
          <span className="text-xs" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
            ({weight})
          </span>
          {info && <DimTooltip text={info} />}
        </span>
        <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
          {pct}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "var(--surface-secondary)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function HighlightsModal({ engineer, rank, onClose }: { engineer: EngineerData; rank: number; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const topPRs = engineer.delivery.top_prs?.slice(0, 5) ?? [];
  const topIssues = engineer.problem.top_issues?.slice(0, 5) ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const rankColors: Record<number, string> = { 1: "var(--rank-gold)", 2: "var(--rank-silver)", 3: "var(--rank-bronze)" };
  const accentColor = rankColors[rank] ?? "var(--primary)";

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(28,28,26,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--surface)", border: `2px solid ${accentColor}` }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-full overflow-hidden border-2" style={{ borderColor: accentColor }}>
              {engineer.avatar_url
                ? <Image src={engineer.avatar_url} alt={engineer.login} fill className="object-cover" unoptimized />
                : <div className="w-full h-full flex items-center justify-center text-sm font-bold" style={{ background: "var(--surface-secondary)", color: "var(--primary)" }}>{engineer.login[0].toUpperCase()}</div>
              }
            </div>
            <div>
              <div className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>@{engineer.login}</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Top highlights · Last 90 days</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-secondary)] transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {topPRs.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--primary)" }}>
                Top Pull Requests
              </div>
              <div className="space-y-2.5">
                {topPRs.map((pr) => (
                  <a
                    key={pr.number}
                    href={`https://github.com/PostHog/posthog/pull/${pr.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl p-3.5 transition-colors hover:brightness-95"
                    style={{ background: "var(--surface-secondary)" }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
                        <span className="text-xs mr-1.5" style={{ color: "var(--text-secondary)" }}>#{pr.number}</span>
                        {pr.title}
                      </div>
                      <span className="text-xs font-bold shrink-0 tabular-nums" style={{ color: accentColor }}>
                        {pr.pr_score.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="px-2 py-0.5 rounded-md font-medium text-white" style={{ background: "var(--primary)" }}>
                        {labelTypeBadge(pr.label_type)}
                      </span>
                      {pr.complexity_multiplier > 1.1 && (
                        <span className="px-2 py-0.5 rounded-md" style={{ background: "#e8f4ea", color: "var(--primary)" }}>
                          {pr.complexity_multiplier.toFixed(1)}× complexity
                        </span>
                      )}
                      {pr.speed_multiplier > 1.0 && (
                        <span className="px-2 py-0.5 rounded-md" style={{ background: "#fef3e2", color: "var(--accent)" }}>
                          {pr.speed_multiplier.toFixed(1)}× speed
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {topIssues.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--accent)" }}>
                Issues Spotted
              </div>
              <div className="space-y-2.5">
                {topIssues.map((issue) => (
                  <a
                    key={issue.number}
                    href={`https://github.com/PostHog/posthog/issues/${issue.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl p-3.5 transition-colors hover:brightness-95"
                    style={{ background: "#fdf6ed" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
                        <span className="text-xs mr-1.5" style={{ color: "var(--text-secondary)" }}>#{issue.number}</span>
                        {issue.title}
                      </div>
                      <span className="text-xs font-bold shrink-0 tabular-nums" style={{ color: "var(--accent)" }}>
                        {issue.issue_score.toFixed(1)}
                      </span>
                    </div>
                    {issue.fixer_signal > 1.0 && (
                      <div className="mt-1.5 text-xs" style={{ color: "var(--primary)" }}>
                        ✓ Spotted in someone else&apos;s code
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {topPRs.length === 0 && topIssues.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: "var(--text-secondary)" }}>
              No highlights available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EngineerCard({
  engineer,
  rank,
  teamP90 = { delivery: 1, review: 1, problem: 1 },
}: {
  engineer: EngineerData;
  rank: number;
  teamP90?: TeamP90;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const rankStyle = RANK_STYLES[rank] ?? {
    badge: "text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border)]",
    border: "border-[var(--border)]",
    dot: "bg-[var(--text-secondary)]",
  };

  return (
    <div
      className={`rounded-2xl border-2 ${rankStyle.border} bg-[var(--surface)] shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col`}
    >
      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Row 1: rank badge + score */}
        <div className="flex items-center justify-between">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${rankStyle.badge}`}>
            #{rank}
          </span>
          <ScoreTooltip engineer={engineer} />
        </div>

        {/* Row 2: avatar + username */}
        <div className="flex items-center gap-2.5">
          <div
            className="relative w-10 h-10 rounded-full overflow-hidden border-2 shrink-0"
            style={{ borderColor: rank <= 3 ? `var(--rank-${rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze"})` : "var(--border)" }}
          >
            {engineer.avatar_url ? (
              <Image src={engineer.avatar_url} alt={engineer.login} fill className="object-cover" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm font-bold"
                style={{ background: "var(--surface-secondary)", color: "var(--primary)" }}>
                {engineer.login[0].toUpperCase()}
              </div>
            )}
          </div>
          <a
            href={`https://github.com/${engineer.login}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold hover:underline truncate"
            style={{ color: "var(--primary)" }}
          >
            @{engineer.login}
          </a>
        </div>

        <div className="space-y-2.5">
          <ProgressBar
            label="Delivery"
            value={engineer.delivery.normalized}
            color="var(--primary-light)"
            weight="40%"
            info="Weighted sum of merged PRs adjusted for code complexity (relative to team avg per language), merge speed, and type — bugs and features score higher. Normalized to 0–100 across the team."
          />
          <ProgressBar
            label="Review"
            value={engineer.review.normalized}
            color="#4A8FA0"
            weight="40%"
            info="Reviews given, weighted by depth (requesting changes signals deep engagement) and turnaround speed. Normalized to 0–100 across the team."
          />
          <ProgressBar
            label="Problems"
            value={engineer.problem.normalized}
            color="var(--accent)"
            weight="20%"
            info="Issues filed in the last 90 days. Earns a 1.5× fixer-signal bonus when the same engineer also helped close the issue in another person's PR — rewarding engineers who spot problems and follow through. Normalized to 0–100."
          />
        </div>

        <div
          className="grid grid-cols-3 gap-2 text-center rounded-xl p-3"
          style={{ background: "var(--surface-secondary)" }}
        >
          <div>
            <div className="text-lg font-bold" style={{ color: "var(--primary)" }}>
              {engineer.delivery.pr_count}
            </div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>PRs merged</div>
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: "#4A8FA0" }}>
              {engineer.review.review_count}
            </div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Reviews</div>
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>
              {engineer.problem.issue_count}
            </div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Issues filed</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          {engineer.review.changes_requested > 0 && (
            <span
              className="px-2 py-0.5 rounded-full border"
              style={{ borderColor: "var(--border)", background: "var(--surface-secondary)" }}
            >
              {engineer.review.changes_requested} changes requested
            </span>
          )}
          {engineer.review.avg_turnaround_hours > 0 && (
            <span
              className="px-2 py-0.5 rounded-full border"
              style={{ borderColor: "var(--border)", background: "var(--surface-secondary)" }}
            >
              avg {formatTurnaround(engineer.review.avg_turnaround_hours)} turnaround
            </span>
          )}
        </div>
      </div>

      <div className="border-t grid grid-cols-2 divide-x" style={{ borderColor: "var(--border)", borderRightColor: "var(--border)" } as React.CSSProperties}>
        <button
          onClick={() => setBreakdownOpen(true)}
          className="flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium transition-colors hover:bg-[var(--surface-secondary)] rounded-bl-2xl"
          style={{ color: "var(--text-secondary)" }}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Score breakdown
        </button>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium transition-colors hover:bg-[var(--surface-secondary)] rounded-br-2xl"
          style={{ color: "var(--text-secondary)", borderLeft: "1px solid var(--border)" }}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Highlights
        </button>
      </div>

      {modalOpen && (
        <HighlightsModal engineer={engineer} rank={rank} onClose={() => setModalOpen(false)} />
      )}
      {breakdownOpen && (
        <ScoreBreakdownModal engineer={engineer} rank={rank} teamP90={teamP90} onClose={() => setBreakdownOpen(false)} />
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-2xl border-2 p-5 space-y-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="skeleton-shimmer w-10 h-5 rounded-full" />
          <div className="skeleton-shimmer w-10 h-10 rounded-full" />
          <div className="skeleton-shimmer w-24 h-4 rounded" />
        </div>
        <div className="skeleton-shimmer w-12 h-10 rounded" />
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between">
              <div className="skeleton-shimmer w-24 h-3.5 rounded" />
              <div className="skeleton-shimmer w-6 h-3.5 rounded" />
            </div>
            <div className="skeleton-shimmer w-full h-2 rounded-full" />
          </div>
        ))}
      </div>
      <div className="skeleton-shimmer w-full h-16 rounded-xl" />
      <div className="flex gap-2">
        <div className="skeleton-shimmer w-28 h-5 rounded-full" />
        <div className="skeleton-shimmer w-32 h-5 rounded-full" />
      </div>
    </div>
  );
}

function AllEngineersModal({ engineers, teamP90 = { delivery: 1, review: 1, problem: 1 }, onClose }: {
  engineers: EngineerData[];
  teamP90?: TeamP90;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [detailsFor, setDetailsFor] = useState<{ engineer: EngineerData; rank: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(28,28,26,0.5)", backdropFilter: "blur(4px)" }}
        onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      >
        <div
          className="w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ background: "var(--surface)", border: "2px solid var(--border)" }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <div className="font-bold text-base" style={{ color: "var(--text-primary)" }}>All Engineers</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{engineers.length} PostHog org members · ranked by impact · Last 90 days</div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-secondary)] transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "var(--surface-secondary)" }}>
                <tr className="text-xs uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  <th className="px-4 py-3 text-left font-semibold w-10">#</th>
                  <th className="px-4 py-3 text-left font-semibold">Engineer</th>
                  <th className="px-4 py-3 text-right font-semibold">Score</th>
                  <th className="px-4 py-3 text-right font-semibold hidden sm:table-cell">Delivery</th>
                  <th className="px-4 py-3 text-right font-semibold hidden sm:table-cell">Review</th>
                  <th className="px-4 py-3 text-right font-semibold hidden sm:table-cell">Problems</th>
                  <th className="px-4 py-3 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {engineers.map((eng, i) => {
                  const rank = i + 1;
                  const rankColor = rank === 1 ? "var(--rank-gold)" : rank === 2 ? "var(--rank-silver)" : rank === 3 ? "var(--rank-bronze)" : "var(--text-secondary)";
                  return (
                    <tr
                      key={eng.login}
                      className="border-t transition-colors hover:bg-[var(--surface-secondary)]"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold tabular-nums" style={{ color: rankColor }}>
                          {rank <= 3 ? ["🥇","🥈","🥉"][rank - 1] : rank}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0 border" style={{ borderColor: "var(--border)" }}>
                            {eng.avatar_url
                              ? <Image src={eng.avatar_url} alt={eng.login} fill className="object-cover" unoptimized />
                              : <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--surface-secondary)", color: "var(--primary)" }}>{eng.login[0].toUpperCase()}</div>
                            }
                          </div>
                          <a
                            href={`https://github.com/${eng.login}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:underline truncate max-w-[120px]"
                            style={{ color: "var(--primary)" }}
                          >
                            @{eng.login}
                          </a>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                          {Math.round(eng.final_score)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell" style={{ color: "var(--primary)" }}>
                        {Math.round(eng.delivery.normalized)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell" style={{ color: "#4A8FA0" }}>
                        {Math.round(eng.review.normalized)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell" style={{ color: "var(--accent)" }}>
                        {Math.round(eng.problem.normalized)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setDetailsFor({ engineer: eng, rank })}
                          className="text-xs px-2.5 py-1 rounded-lg border transition-colors hover:bg-[var(--surface-secondary)]"
                          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {detailsFor && (
        <ScoreBreakdownModal
          engineer={detailsFor.engineer}
          rank={detailsFor.rank}
          teamP90={teamP90}
          onClose={() => setDetailsFor(null)}
        />
      )}
    </>
  );
}

function NormFormula({ raw, p90, color }: { raw: number; p90: number; color: string }) {
  const normalized = Math.round(Math.min(raw / p90, 1.0) * 100);
  return (
    <div className="rounded-xl p-4 text-xs" style={{ background: "var(--surface-secondary)" }}>
      <div className="font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
        How this score is calculated
      </div>
      <div className="font-mono leading-relaxed" style={{ color: "var(--text-primary)" }}>
        min(
        <span className="font-bold" style={{ color }}>raw&nbsp;{raw.toFixed(2)}</span>
        &nbsp;÷&nbsp;
        <span style={{ color: "var(--text-secondary)" }}>p90&nbsp;{p90.toFixed(2)}</span>
        ,&nbsp;1.0) × 100&nbsp;
        <span className="font-bold" style={{ color }}>= {normalized}</span>
      </div>
      <div className="font-sans mt-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        p90 is the 90th-percentile raw score across all engineers analyzed this period. Scores above p90 are capped at 100.
      </div>
    </div>
  );
}

function DeliveryBreakdown({ engineer, p90, avgLines }: { engineer: EngineerData; p90: number; avgLines: number }) {
  const { score, pr_count, top_prs } = engineer.delivery;
  return (
    <div className="space-y-4">
      <NormFormula raw={score} p90={p90} color="var(--primary)" />

      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        <strong style={{ color: "var(--text-primary)" }}>{pr_count} PRs merged</strong> in 90 days.
        Each PR score = <span style={{ color: "var(--primary)" }}>type weight</span> × <span style={{ color: "var(--primary)" }}>complexity</span> × <span style={{ color: "var(--primary)" }}>speed</span>.
        All scores are summed to get the raw delivery total.
      </p>

      {top_prs.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--text-secondary)" }}>
            Top PRs by contribution
          </div>
          <div className="space-y-2">
            {top_prs.map((pr) => {
              const hoursDisplay = pr.hours_to_merge < 24
                ? `${Math.round(pr.hours_to_merge)}h`
                : `${(pr.hours_to_merge / 24).toFixed(1)}d`;
              return (
                <a
                  key={pr.number}
                  href={`https://github.com/PostHog/posthog/pull/${pr.number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl p-3.5 transition-colors hover:brightness-95"
                  style={{ background: "var(--surface-secondary)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="text-xs font-medium leading-snug flex-1" style={{ color: "var(--text-primary)" }}>
                      <span className="mr-1" style={{ color: "var(--text-secondary)" }}>#{pr.number}</span>
                      {pr.title}
                    </div>
                    <span className="text-sm font-bold shrink-0 tabular-nums" style={{ color: "var(--primary)" }}>
                      {pr.pr_score.toFixed(2)} pts
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-20 shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>Type</span>
                      <span className="px-1.5 py-0.5 rounded text-white" style={{ background: "var(--primary)", fontSize: "10px" }}>
                        {labelTypeBadge(pr.label_type)}
                      </span>
                      <span className="font-mono font-bold" style={{ color: "var(--primary)" }}>{pr.base_weight.toFixed(1)}×</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-20 shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>Complexity</span>
                      <span style={{ color: "var(--text-primary)" }}>
                        {pr.lines_changed.toLocaleString()} lines changed
                      </span>
                      <span style={{ color: "var(--text-secondary)" }}>
                        (team avg: {avgLines > 0 ? avgLines.toLocaleString() : "—"})
                      </span>
                      <span className="font-mono font-bold ml-auto" style={{ color: "var(--primary)" }}>{pr.complexity_multiplier.toFixed(2)}×</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-20 shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>Speed</span>
                      <span style={{ color: "var(--text-primary)" }}>merged in {hoursDisplay}</span>
                      <span className="font-mono font-bold ml-auto" style={{ color: "var(--primary)" }}>{pr.speed_multiplier.toFixed(2)}×</span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
                      <span className="w-20 shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>Score</span>
                      <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                        {pr.base_weight.toFixed(1)} × {pr.complexity_multiplier.toFixed(2)} × {pr.speed_multiplier.toFixed(2)}
                      </span>
                      <span className="font-bold ml-auto" style={{ color: "var(--primary)" }}>= {pr.pr_score.toFixed(2)}</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
          {pr_count > top_prs.length && (
            <p className="text-xs mt-2 text-center" style={{ color: "var(--text-secondary)" }}>
              + {pr_count - top_prs.length} more PRs contributed to the raw score
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl p-4 space-y-3 text-xs" style={{ background: "var(--surface-secondary)" }}>
        <div className="font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
          How multipliers are assigned
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-medium mb-1.5" style={{ color: "var(--primary)" }}>Complexity</div>
            <p className="mb-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Lines changed (additions + deletions), compared to all 200 PRs in this window using a log-scale so large PRs don&apos;t dominate.
            </p>
            <ul className="space-y-0.5">
              {[
                { val: "1.3×", desc: "larger than ~93% of PRs" },
                { val: "1.2×", desc: "larger than ~69% of PRs" },
                { val: "1.1×", desc: "near the median" },
                { val: "1.0×", desc: "smaller than median" },
              ].map(({ val, desc }) => (
                <li key={val} className="flex gap-2">
                  <span className="font-mono font-bold w-9 shrink-0" style={{ color: "var(--primary)" }}>{val}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{desc}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium mb-1.5" style={{ color: "var(--primary)" }}>Speed</div>
            <p className="mb-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Hours from PR opened to merged. Only applies when ≥1 reviewer approved — draft/self-merges get 1.0×.
            </p>
            <ul className="space-y-0.5">
              {[
                { val: "1.3×", desc: "merged within 24 hours" },
                { val: "1.1×", desc: "merged within 3 days" },
                { val: "1.0×", desc: "merged within 7 days" },
                { val: "0.9×", desc: "took longer than 7 days" },
              ].map(({ val, desc }) => (
                <li key={val} className="flex gap-2">
                  <span className="font-mono font-bold w-9 shrink-0" style={{ color: "var(--primary)" }}>{val}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewBreakdown({ engineer, p90 }: { engineer: EngineerData; p90: number }) {
  const { score, review_count, changes_requested, avg_turnaround_hours,
          avg_depth_weight, avg_speed_mult, total_complexity_bonus } = engineer.review;
  const changesRequestedPct = review_count > 0 ? Math.round((changes_requested / review_count) * 100) : 0;
  const otherReviews = review_count - changes_requested;

  const formulaResult = review_count > 0
    ? (review_count * avg_depth_weight * avg_speed_mult + total_complexity_bonus).toFixed(2)
    : "0";

  return (
    <div className="space-y-4">
      <NormFormula raw={score} p90={p90} color="#4A8FA0" />

      {/* Exact math formula */}
      <div className="rounded-xl p-4 text-xs" style={{ background: "var(--surface-secondary)" }}>
        <div className="font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
          How raw score {score} was built
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-36 shrink-0" style={{ color: "var(--text-secondary)" }}>Reviews</span>
            <span className="font-mono font-bold" style={{ color: "#4A8FA0" }}>{review_count}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-36 shrink-0" style={{ color: "var(--text-secondary)" }}>× avg depth weight</span>
            <span className="font-mono font-bold" style={{ color: "#4A8FA0" }}>{avg_depth_weight.toFixed(3)}</span>
            <span className="italic" style={{ color: "var(--text-secondary)" }}>= verdict × substance, averaged across all reviews</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-36 shrink-0" style={{ color: "var(--text-secondary)" }}>× avg speed bonus</span>
            <span className="font-mono font-bold" style={{ color: "#4A8FA0" }}>{avg_speed_mult.toFixed(3)}</span>
            <span className="italic" style={{ color: "var(--text-secondary)" }}>weighted by review quality (avg {avg_turnaround_hours > 0 ? formatTurnaround(avg_turnaround_hours) : "—"} turnaround)</span>
          </div>
          {total_complexity_bonus > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-36 shrink-0" style={{ color: "var(--text-secondary)" }}>+ complexity bonus</span>
              <span className="font-mono font-bold" style={{ color: "#4A8FA0" }}>{total_complexity_bonus.toFixed(2)}</span>
              <span className="italic" style={{ color: "var(--text-secondary)" }}>for reviewing large/complex PRs</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-2 border-t font-bold" style={{ borderColor: "var(--border)" }}>
            <span className="w-36 shrink-0" style={{ color: "var(--text-secondary)" }}>= raw score</span>
            <span className="font-mono" style={{ color: "#4A8FA0" }}>{formulaResult}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Reviews given", val: String(review_count), color: "#4A8FA0" },
          { label: "Change requests", val: `${changes_requested} (${changesRequestedPct}%)`, color: "#4A8FA0" },
          { label: "Avg turnaround", val: avg_turnaround_hours > 0 ? formatTurnaround(avg_turnaround_hours) : "—", color: "#4A8FA0" },
        ].map(({ label, val, color }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: "var(--surface-secondary)" }}>
            <div className="font-bold text-sm tabular-nums leading-tight" style={{ color }}>{val}</div>
            <div className="text-xs mt-1 leading-tight" style={{ color: "var(--text-secondary)" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Reference table */}
      <div className="rounded-xl p-4 space-y-3 text-xs" style={{ background: "var(--surface-secondary)" }}>
        <div className="font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
          How depth weight is assigned per review
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-medium mb-1.5" style={{ color: "#4A8FA0" }}>Verdict (review outcome)</div>
            <ul className="space-y-1">
              {[
                { val: "1.5×", desc: `${changes_requested} change request${changes_requested !== 1 ? "s" : ""}`, note: "requested real changes to the code" },
                { val: "1.0×", desc: `${otherReviews} approval${otherReviews !== 1 ? "s" : ""} / comment${otherReviews !== 1 ? "s" : ""}`, note: "approved or left a comment" },
              ].map(({ val, desc, note }) => (
                <li key={val} className="flex items-start gap-2">
                  <span className="font-mono font-bold w-9 shrink-0 pt-0.5" style={{ color: "#4A8FA0" }}>{val}</span>
                  <div>
                    <span style={{ color: "var(--text-primary)" }}>{desc}</span>
                    <div className="italic" style={{ color: "var(--text-secondary)" }}>{note}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium mb-1.5" style={{ color: "#4A8FA0" }}>Substance × Speed</div>
            <p className="mb-1.5" style={{ color: "var(--text-secondary)" }}>Multiplied on top of verdict:</p>
            <ul className="space-y-0.5 mb-2">
              {[
                { val: "1.3×", desc: "review body > 200 chars" },
                { val: "1.1×", desc: "review body > 50 chars" },
                { val: "1.0×", desc: "bare approval" },
              ].map(({ val, desc }) => (
                <li key={val} className="flex gap-2">
                  <span className="font-mono font-bold w-9 shrink-0" style={{ color: "#4A8FA0" }}>{val}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{desc}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-0.5 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              {[
                { val: "1.2×", desc: "reviewed within 4h of PR open" },
                { val: "1.1×", desc: "reviewed within 24h" },
                { val: "1.0×", desc: "reviewed within 3 days" },
                { val: "0.9×", desc: "took over 3 days" },
              ].map(({ val, desc }) => (
                <li key={val} className="flex gap-2">
                  <span className="font-mono font-bold w-9 shrink-0" style={{ color: "#4A8FA0" }}>{val}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProblemsBreakdown({ engineer, p90 }: { engineer: EngineerData; p90: number }) {
  const { score, issue_count, top_issues } = engineer.problem;
  return (
    <div className="space-y-4">
      <NormFormula raw={score} p90={p90} color="var(--accent)" />

      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        <strong style={{ color: "var(--text-primary)" }}>{issue_count} issue{issue_count !== 1 ? "s" : ""} filed</strong> in 90 days.
        Each issue score = <span style={{ color: "var(--accent)" }}>severity weight</span> × <span style={{ color: "var(--accent)" }}>fixer signal</span>.
      </p>

      {top_issues.length > 0 ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--text-secondary)" }}>
            Top issues by contribution
          </div>
          <div className="space-y-2">
            {top_issues.map((issue) => (
              <a
                key={issue.number}
                href={`https://github.com/PostHog/posthog/issues/${issue.number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl p-3.5 transition-colors hover:brightness-95"
                style={{ background: "#fdf6ed" }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="text-xs font-medium leading-snug flex-1" style={{ color: "var(--text-primary)" }}>
                    <span className="mr-1" style={{ color: "var(--text-secondary)" }}>#{issue.number}</span>
                    {issue.title}
                  </div>
                  <span className="text-sm font-bold shrink-0 tabular-nums" style={{ color: "var(--accent)" }}>
                    {issue.issue_score.toFixed(2)} pts
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                  <span>severity {issue.base_weight.toFixed(1)}×</span>
                  {issue.fixer_signal > 1.0 && (
                    <>
                      <span>×</span>
                      <span className="px-1.5 py-0.5 rounded font-sans" style={{ background: "#e8f4ea", color: "var(--primary)" }}>
                        {issue.fixer_signal.toFixed(1)}× fixer signal
                      </span>
                    </>
                  )}
                  <span style={{ color: "var(--accent)" }}>= {issue.issue_score.toFixed(2)}</span>
                </div>
                {issue.fixer_signal > 1.0 && (
                  <div className="mt-1.5 text-xs" style={{ color: "var(--primary)" }}>
                    ✓ Also contributed to closing this issue
                  </div>
                )}
              </a>
            ))}
          </div>
          {issue_count > top_issues.length && (
            <p className="text-xs mt-2 text-center" style={{ color: "var(--text-secondary)" }}>
              + {issue_count - top_issues.length} more issues not shown
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-sm" style={{ color: "var(--text-secondary)" }}>
          No issues filed in this period
        </div>
      )}
    </div>
  );
}

function ScoreBreakdownModal({
  engineer, rank, teamP90 = { delivery: 1, review: 1, problem: 1 }, onClose,
}: {
  engineer: EngineerData; rank: number; teamP90?: TeamP90; onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"delivery" | "review" | "problems">("delivery");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const rankColors: Record<number, string> = { 1: "var(--rank-gold)", 2: "var(--rank-silver)", 3: "var(--rank-bronze)" };
  const accentColor = rankColors[rank] ?? "var(--primary)";

  const tabs = [
    { id: "delivery" as const, label: "Delivery", color: "var(--primary)", score: Math.round(engineer.delivery.normalized) },
    { id: "review" as const, label: "Review", color: "#4A8FA0", score: Math.round(engineer.review.normalized) },
    { id: "problems" as const, label: "Problems", color: "var(--accent)", score: Math.round(engineer.problem.normalized) },
  ];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(28,28,26,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--surface)", border: `2px solid ${accentColor}` }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-full overflow-hidden border-2 shrink-0" style={{ borderColor: accentColor }}>
              {engineer.avatar_url
                ? <Image src={engineer.avatar_url} alt={engineer.login} fill className="object-cover" unoptimized />
                : <div className="w-full h-full flex items-center justify-center text-sm font-bold" style={{ background: "var(--surface-secondary)", color: "var(--primary)" }}>{engineer.login[0].toUpperCase()}</div>
              }
            </div>
            <div>
              <div className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>@{engineer.login}</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Score breakdown · final {Math.round(engineer.final_score)}/100
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-secondary)] transition-colors shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          {tabs.map(({ id, label, color, score }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex-1 py-2.5 text-xs font-semibold transition-colors relative"
              style={{
                color: tab === id ? color : "var(--text-secondary)",
                background: tab === id ? "var(--surface-secondary)" : "transparent",
              }}
            >
              <div className="font-medium text-xs" style={{ opacity: tab === id ? 1 : 0.6 }}>{label}</div>
              <div className="text-xl font-bold tabular-nums leading-tight" style={{ color: tab === id ? color : "var(--text-secondary)", opacity: tab === id ? 1 : 0.4 }}>
                {score}
              </div>
              {tab === id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: color }} />
              )}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {tab === "delivery" && <DeliveryBreakdown engineer={engineer} p90={teamP90.delivery} avgLines={teamP90.avg_lines_per_pr ?? 0} />}
          {tab === "review" && <ReviewBreakdown engineer={engineer} p90={teamP90.review} />}
          {tab === "problems" && <ProblemsBreakdown engineer={engineer} p90={teamP90.problem} />}
        </div>
      </div>
    </div>
  );
}

function HowScoresWork() {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-[var(--surface-secondary)] flex items-center gap-1.5"
        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        How scores work
      </button>
      {open && createPortal(
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(28,28,26,0.5)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === overlayRef.current) setOpen(false); }}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: "var(--surface)", border: "2px solid var(--border)" }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="font-bold text-base" style={{ color: "var(--text-primary)" }}>How impact is measured</div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-secondary)] transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5 text-sm" style={{ color: "var(--text-primary)" }}>
              <p style={{ color: "var(--text-secondary)" }}>
                This dashboard identifies PostHog&apos;s most impactful engineers by analyzing 90 days of GitHub activity.
                &ldquo;Impact&rdquo; is intentionally broad — it rewards engineers who ship meaningful code, review others thoroughly, <em>and</em> proactively surface real problems.
              </p>

              <div className="rounded-xl p-4 text-sm font-mono" style={{ background: "var(--surface-secondary)", color: "var(--text-primary)" }}>
                <div className="text-xs font-sans font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Final score formula</div>
                <span style={{ color: "var(--primary)" }}>Delivery</span> × 0.40 + <span style={{ color: "#4A8FA0" }}>Review</span> × 0.40 + <span style={{ color: "var(--accent)" }}>Problems</span> × 0.20
                <div className="text-xs font-sans mt-2" style={{ color: "var(--text-secondary)" }}>
                  Each dimension is normalized 0–100 against the team&apos;s 90th-percentile performer. A score of 100 means top-10% of the team on that dimension.
                </div>
              </div>

              {[
                {
                  color: "var(--primary-light)",
                  label: "Delivery",
                  weight: "40%",
                  summary: "How much meaningful code did this engineer ship?",
                  detail: [
                    "Each merged PR is assigned a base weight by type: bug fix (1.5×), feature (1.3×), refactor/perf (1.1×), docs/test/chore (1.0×).",
                    "Complexity multiplier: compares this PR's changed-lines count to the team's average for that language. Larger-than-average PRs score up to 1.3×.",
                    "Speed multiplier: merging within 24h earns 1.3×, within 72h earns 1.1×, otherwise 1.0×. Slow merges (>7 days) get 0.9×.",
                    "Auto-generated files (lockfiles, migrations, snapshots) are excluded from line counts.",
                  ],
                },
                {
                  color: "#4A8FA0",
                  label: "Review Quality",
                  weight: "40%",
                  summary: "How deeply and quickly does this engineer review others' code?",
                  detail: [
                    "Each review earns a verdict weight: requesting changes = 1.5× (signals real scrutiny), approving/commenting = 1.0×.",
                    "Substance multiplier on top of verdict: review body >200 chars = 1.3×, >50 chars = 1.1×, bare approval = 1.0×.",
                    "Speed bonus: review within 4h earns 1.2×, within 24h earns 1.1×, within 3 days earns 1.0×, slower earns 0.9×.",
                    "Own PRs are excluded — only reviews of other engineers' work count.",
                  ],
                },
                {
                  color: "var(--accent)",
                  label: "Problem Spotting",
                  weight: "20%",
                  summary: "Does this engineer proactively surface real problems?",
                  detail: [
                    "Issues filed in the last 90 days are counted, weighted by severity label (critical/security = 3×, regression = 2×, bug = 1.5×, other = 0.5×).",
                    "Fixer-signal bonus (1.5×): if the same engineer who filed the issue also contributed to closing it via a merged PR, they earn extra credit — rewarding follow-through.",
                  ],
                },
              ].map(({ color, label, weight, summary, detail }) => (
                <div key={label} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1 self-stretch rounded-full" style={{ background: color }} />
                    <div>
                      <span className="font-semibold" style={{ color }}>{label}</span>
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-md" style={{ background: "var(--surface-secondary)", color: "var(--text-secondary)" }}>{weight} weight</span>
                    </div>
                  </div>
                  <p className="text-xs italic ml-3" style={{ color: "var(--text-secondary)" }}>{summary}</p>
                  <ul className="ml-3 space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {detail.map((d, i) => (
                      <li key={i} className="flex gap-1.5"><span className="mt-0.5 shrink-0" style={{ color }}>·</span>{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function Home() {
  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/engineers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: APIResponse = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const top5 = data?.engineers?.slice(0, 5) ?? [];
  const allEngineers = data?.engineers ?? [];
  const teamP90 = data?.team_p90 ?? { delivery: 1, review: 1, problem: 1 };

  return (
    <div className="flex-1 flex flex-col min-h-screen" style={{ background: "var(--background)" }}>
      <header
        className="border-b sticky top-0 z-30 backdrop-blur-sm"
        style={{
          background: "rgba(247, 244, 239, 0.92)",
          borderColor: "var(--border)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl select-none">🌿</span>
            <div>
              <h1 className="text-lg font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
                PostHog Engineering Impact
              </h1>
              <p className="text-xs leading-tight" style={{ color: "var(--text-secondary)" }}>
                {loading
                  ? "Loading…"
                  : data
                  ? `Top 5 most impactful engineers · ${data.total_engineers_analyzed} PostHog org members · Last ${data.window_days} days`
                  : "Top 5 most impactful engineers"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {data?.generated_at && (
              <span className="text-xs hidden sm:block" style={{ color: "var(--text-secondary)" }}>
                Updated {timeAgo(data.generated_at)}
              </span>
            )}
            <HowScoresWork />
            <button
              onClick={fetchData}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-[var(--surface-secondary)] flex items-center gap-1.5 disabled:opacity-50"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <svg
                className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "var(--surface-secondary)" }}
            >
              🌱
            </div>
            <div className="text-center">
              <div className="font-semibold text-lg mb-1" style={{ color: "var(--text-primary)" }}>
                Couldn&apos;t load data
              </div>
              <div className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                {error}
              </div>
              <button
                onClick={fetchData}
                className="px-5 py-2 rounded-full text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--primary)" }}
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            {!loading && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-6 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span>Impact = who ships meaningfully, reviews deeply, and spots real problems.</span>
                <span className="hidden sm:flex items-center gap-3">
                  {[
                    { dot: "var(--primary-light)", label: "Delivery — weighted PRs merged" },
                    { dot: "#4A8FA0", label: "Review — code review depth & speed" },
                    { dot: "var(--accent)", label: "Problems — issues filed & followed through" },
                  ].map(({ dot, label }) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full shrink-0 inline-block" style={{ background: dot }} />
                      {label}
                    </span>
                  ))}
                </span>
                <span className="opacity-60">Scores 0–100, relative to the team&apos;s top 10%.</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
              {loading
                ? [...Array(5)].map((_, i) => <SkeletonCard key={i} />)
                : top5.map((engineer, i) => (
                    <EngineerCard key={engineer.login} engineer={engineer} rank={i + 1} teamP90={teamP90} />
                  ))}
            </div>
            {!loading && allEngineers.length > 5 && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => setAllOpen(true)}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-full border text-sm font-medium transition-colors hover:bg-[var(--surface-secondary)]"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  View all {allEngineers.length} engineers
                </button>
              </div>
            )}
          </>
        )}
        {allOpen && allEngineers.length > 0 && (
          <AllEngineersModal engineers={allEngineers} teamP90={teamP90} onClose={() => setAllOpen(false)} />
        )}
      </main>

      <footer
        className="border-t py-4 text-center text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
      >
        Powered by Weave &mdash; engineering clarity, naturally
      </footer>
    </div>
  );
}
