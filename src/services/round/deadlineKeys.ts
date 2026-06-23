// Redis key grammar for Round deadlines. The expired-key event carries only the
// key string, so encoding the Round id and which deadline fired *in the key* is
// how the subscriber routes the event back to a phase transition. See ADR-0003.

export type DeadlineKind = 'play' | 'judge';

export const playKey = (roundId: string): string => `round:${roundId}:play`;
export const judgeKey = (roundId: string): string => `round:${roundId}:judge`;

const DEADLINE_KEY = /^round:(?<roundId>[^:]+):(?<kind>play|judge)$/;

// Parse a deadline key back into its Round id and kind. Returns null for any key
// that is not one of ours so the expired-event handler can ignore unrelated keys
// sharing the keyspace. Example: `round:abc:play` -> { roundId: 'abc', kind: 'play' }.
export const parseDeadlineKey = (
  key: string
): { roundId: string; kind: DeadlineKind } | null => {
  const match = DEADLINE_KEY.exec(key);
  if (!match?.groups) {
    return null;
  }

  return {
    roundId: match.groups.roundId,
    kind: match.groups.kind as DeadlineKind
  };
};
