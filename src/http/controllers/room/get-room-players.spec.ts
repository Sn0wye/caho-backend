import type { App } from '@/app';
import type { Session, SessionUser } from '@/auth/session-types';
import { fastifyErrorHandler } from '@/http/error-handler';
import { ROOM_CODE } from '@/services/room/RoomService.fixtures';
import { type FastifyRequest, fastify } from 'fastify';
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWhiteCardsController } from './get-current-white-cards';
import { getRoomPlayersController } from './get-room-players';
import {
  CALLER_HAND,
  CALLER_ID,
  EXPECTED_ROOM_PLAYERS,
  roomReadsFixture
} from './room-reads.fakes';

// Read at call time: vi.mock is hoisted above the fixture import.
vi.mock('@/services/room/RoomServiceFactory', () => ({
  RoomServiceFactory: () => roomReadsFixture.service
}));

const CALLER: SessionUser = {
  id: CALLER_ID,
  name: null,
  username: 'caller',
  email: null,
  avatarUrl: null,
  providerId: null,
  providerUserId: null
};

const CALLER_SESSION: Session = {
  id: 'session-1',
  userId: CALLER_ID,
  expiresAt: new Date(),
  fresh: false
};

// Signed in as the caller, a non-Judge Player.
async function signInAsCaller(request: FastifyRequest): Promise<void> {
  request.getUser = () => CALLER;
  request.getSession = () => CALLER_SESSION;
}

// Replace with the full app via app.inject() once #26 lands.
function buildRoomReadsApp(): App {
  const app = fastify().withTypeProvider<ZodTypeProvider>();
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  app.setErrorHandler(fastifyErrorHandler);
  app.addHook('onRequest', signInAsCaller);
  app.register(getRoomPlayersController);
  app.register(getCurrentWhiteCardsController);
  return app;
}

let app = buildRoomReadsApp();
afterEach(async () => {
  await app.close();
  app = buildRoomReadsApp();
});

describe('GET /:roomCode/players', () => {
  it('returns every Player as a RoomPlayer, without any Hand or isJudge flag', async () => {
    const response = await app.inject(`/${ROOM_CODE}/players`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(EXPECTED_ROOM_PLAYERS);
  });

  // Regression for #27: the raw Player rows exposed every Player's Hand.
  it('never exposes cardIds, not even the caller own', async () => {
    const response = await app.inject(`/${ROOM_CODE}/players`);

    expect(response.body).not.toContain('cardIds');
    expect(response.body).not.toContain('isJudge');
  });
});

describe('GET /:roomCode/white-cards', () => {
  it('still returns the caller own Hand', async () => {
    const response = await app.inject(`/${ROOM_CODE}/white-cards`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(CALLER_HAND);
  });
});
