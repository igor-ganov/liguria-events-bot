import type { CandidatePair } from './dedupe-candidates.ts';

/**
 * The confirmed pairs as groups of one event each: two pairs that share a
 * record are one group. A show sold date by date leaves one pair per date with
 * the record its series landed on; merged pair by pair, whichever of each pair
 * was older stayed, and a group could split into several survivors or lose
 * the record that held the programme.
 */
export const duplicateClusters = (pairs: readonly CandidatePair[]): readonly (readonly string[])[] => {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;
    return up === id ? id : root(up);
  };
  pairs.forEach(({ a, b }) => {
    const [ra, rb] = [root(a.id), root(b.id)];
    if (ra !== rb) parent.set(rb, ra);
  });
  const ids = [...new Set(pairs.flatMap(({ a, b }) => [a.id, b.id]))];
  const groups = new Map<string, readonly string[]>();
  ids.forEach((id) => groups.set(root(id), [...(groups.get(root(id)) ?? []), id]));
  return [...groups.values()];
};
