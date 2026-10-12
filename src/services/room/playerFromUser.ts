import type { SessionUser } from '@/auth/session-types';
import type { Player } from '@/schemas';

// The slice of a signed-in User a Player is built from.
export type PlayerProfile = Pick<SessionUser, 'id' | 'username' | 'avatarUrl'>;

/**
 * A fresh Player for a User entering a Room: no score, not ready, active, empty
 * Hand. Create-room and join-room each built this nine-field shape by hand;
 * now both go through here so a Player starts the same way on either path.
 * `isJudge` stays false: the Judge comes from the Room's judgeId (ADR-0005).
 * issue #26.
 *
 * @example
 * const host = playerFromUser(req.getUser(), true);
 */
export function playerFromUser(user: PlayerProfile, isHost: boolean): Player {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    score: 0,
    isReady: false,
    isHost,
    isJudge: false,
    isActive: true,
    cardIds: []
  };
}
