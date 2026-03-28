export interface FuzzyMatchResult {
  indices: number[];
  score: number;
}

export function fuzzyMatch(query: string, label: string): FuzzyMatchResult | null {
  if (!query) return { indices: [], score: 0 };

  const qLower = query.toLowerCase();
  const lLower = label.toLowerCase();
  const matchedIndices: number[] = [];
  let qi = 0;

  for (let li = 0; li < lLower.length && qi < qLower.length; li++) {
    if (qLower[qi] === lLower[li]) {
      matchedIndices.push(li);
      qi++;
    }
  }

  if (qi !== qLower.length) return null;

  let score = 0;

  // Prefix bonus
  if (matchedIndices[0] === 0) score += 100;

  // Word boundary bonus
  for (const idx of matchedIndices) {
    if (idx === 0) continue; // already counted in prefix
    const prev = label[idx - 1]!;
    const cur = label[idx]!;
    if (prev === " " || prev === "-" || prev === "/" || prev === "." ||
        (prev === prev.toLowerCase() && cur !== cur.toLowerCase())) {
      score += 30;
    }
  }

  // Consecutive bonus
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1]! + 1) score += 20;
  }

  // Shorter label bonus
  score += Math.max(0, 50 - label.length);

  return { indices: matchedIndices, score };
}
