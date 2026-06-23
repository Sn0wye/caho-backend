// The single Judge-rotation path the timer engine reuses. An aborted Round
// rotates the Judge by starting the next one — the same machinery a normal
// Judge pick uses — so rotation lives in exactly one place. RoomService
// structurally satisfies this via its existing startNextRound. See issue #4.
export interface IRoundRotator {
  startNextRound(roomCode: string, currentRound: number): Promise<unknown>;
}
