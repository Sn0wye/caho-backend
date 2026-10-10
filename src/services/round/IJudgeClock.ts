// The slice of RoundTimekeeper that RoomOrchestrator drives on a Judge departure
// (ISP): a drop arms the grace window (reconnect window before the Round aborts),
// an explicit Leave expires it now to abort+rotate immediately. RoundTimekeeper
// structurally satisfies this. See ADR-0002 / ADR-0004.
export interface IJudgeClock {
  armJudgeGrace(roundId: string): Promise<void>;
  onJudgeExpired(roundId: string): Promise<void>;
  // The dropped Judge reconnected: stop the grace from aborting their Round.
  onJudgeReturned(roundId: string): Promise<void>;
}

// RoomOrchestrator also starts the game, so it arms Round 1's play clock too.
export interface IRoomClock extends IJudgeClock {
  armPlayDeadline(roundId: string): Promise<void>;
}
