import type { IRoomService } from '@/services/room/IRoomService';
import type { RoundTimekeeper } from '@/services/round/RoundTimekeeper';

// A departing Judge is handled by departure mode (ADR-0002 / issue #4). A drop
// holds the Round and arms the judge-grace timer, giving the Judge a window to
// reconnect before the Round aborts; an explicit Leave aborts and rotates
// immediately. Either way nothing happens unless the departing Player actually
// holds the Judge role in an in-progress Round. Shared by the WebSocket drop path
// and the REST Leave path, mirroring broadcastHostLoss (issue #3).
export type JudgeLossMode = 'drop' | 'leave';

export const handleJudgeLoss = async (
  roomService: IRoomService,
  timekeeper: RoundTimekeeper,
  roomCode: string,
  departingPlayerId: string,
  mode: JudgeLossMode
): Promise<void> => {
  const room = await roomService.getRoom(roomCode);

  if (room.status !== 'IN_PROGRESS' || room.judgeId !== departingPlayerId) {
    return;
  }

  const round = await roomService.getActiveRound(roomCode);
  if (!round) {
    return;
  }

  if (mode === 'drop') {
    await timekeeper.armJudgeGrace(round.id);
    return;
  }

  await timekeeper.onJudgeExpired(round.id);
};
