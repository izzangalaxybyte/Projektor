import { describe, expect, it } from 'vitest';
import { ACCEPT_THRESHOLD, rankCandidates, titleSimilarity } from './score.js';

describe('titleSimilarity', () => {
  it('is 1 for equal titles ignoring case, punctuation, and articles', () => {
    expect(titleSimilarity('The Matrix', 'matrix')).toBe(1);
    expect(titleSimilarity('Mr. Robot', 'Mr Robot')).toBe(1);
    expect(titleSimilarity('Léon', 'Leon')).toBe(1);
  });
  it('is low for unrelated titles', () => {
    expect(titleSimilarity('Heat', 'Inception')).toBeLessThan(0.3);
  });
  it('is high for near matches', () => {
    expect(
      titleSimilarity('Its Always Sunny in Philadelphia', "It's Always Sunny in Philadelphia"),
    ).toBeGreaterThan(0.9);
  });
});

describe('rankCandidates', () => {
  const heat = { id: 1, titles: ['Heat'], year: 1995, popularity: 50 };
  const heat23 = { id: 2, titles: ['Heat'], year: 2023, popularity: 5 };
  const heatwave = { id: 3, titles: ['Heatwave'], year: 1995, popularity: 5 };

  it('prefers the year match when titles tie', () => {
    expect(rankCandidates('Heat', 1995, [heat23, heat, heatwave])[0]?.candidate.id).toBe(1);
    expect(rankCandidates('Heat', 2023, [heat, heat23])[0]?.candidate.id).toBe(2);
  });
  it('accepts an exact title with matching year and rejects a weak one', () => {
    expect(rankCandidates('Heat', 1995, [heat])[0]!.score).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
    expect(rankCandidates('Some Random Download', 2021, [heat])[0]!.score).toBeLessThan(
      ACCEPT_THRESHOLD,
    );
  });
  it('accepts an exact title with no year information', () => {
    expect(rankCandidates('Heat', null, [heat])[0]!.score).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });
  it('uses popularity only as a tiebreaker', () => {
    const a = { id: 1, titles: ['Dune'], year: null, popularity: 1 };
    const b = { id: 2, titles: ['Dune'], year: null, popularity: 100 };
    expect(rankCandidates('Dune', null, [a, b])[0]?.candidate.id).toBe(2);
    const c = { id: 3, titles: ['Dune Part Two'], year: null, popularity: 1000 };
    expect(rankCandidates('Dune', null, [a, c])[0]?.candidate.id).toBe(1);
  });
});
