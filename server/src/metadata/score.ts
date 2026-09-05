/** Title similarity for picking a search result: Sørensen–Dice over character bigrams, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  for (const [g, count] of ba) overlap += Math.min(count, bb.get(g) ?? 0);
  const total =
    [...ba.values()].reduce((s, n) => s + n, 0) + [...bb.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export interface Candidate {
  id: number;
  titles: string[];
  year: number | null;
  popularity: number;
}

export interface Scored<T extends Candidate> {
  candidate: T;
  score: number;
}

/**
 * Ranks candidates for a parsed title and optional year. Score is the best title similarity,
 * plus a bonus for a matching year (or a penalty for a clearly different one), with popularity
 * as a small tiebreaker.
 */
export function rankCandidates<T extends Candidate>(
  title: string,
  year: number | null,
  candidates: T[],
): Scored<T>[] {
  const maxPop = Math.max(1, ...candidates.map((c) => c.popularity));
  return candidates
    .map((candidate) => {
      const similarity = Math.max(0, ...candidate.titles.map((t) => titleSimilarity(title, t)));
      let score = similarity;
      if (year !== null && candidate.year !== null) {
        const diff = Math.abs(year - candidate.year);
        if (diff === 0) score += 0.15;
        else if (diff === 1) score += 0.05;
        else score -= 0.25;
      }
      score += 0.02 * (candidate.popularity / maxPop);
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Threshold below which a top result is treated as "needs review" rather than accepted. */
export const ACCEPT_THRESHOLD = 0.85;
