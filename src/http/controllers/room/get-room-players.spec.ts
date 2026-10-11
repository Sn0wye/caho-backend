import { fastifyErrorHandler } from '@/http/error-handler';
import { ROOM_CODE } from '@/services/room/RoomService.fixtures';
import { fastify } from 'fastify';
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
  JUDGE_ID,
  fakeRoomReadsCardService,
  roomReadsFixture
} from './room-reads.fakes';

// Resolved at call time, not in the factory: the fakes import RoomService, which
// imports CardServiceFactory, so an eager import here deadlocks module loading.
vi.mock('@/services/room/RoomServiceFactory', () => ({
  RoomServiceFactory: () => roomReadsFixture.service
}));
vi.mock('@/services/CardServiceFactory', () => ({
  CardServiceFactory: (roomCode: string) => fakeRoomReadsCardService(roomCode)
}));

// Signed in as the caller, a non-Judge Player. Replace with the full app via
// app.inject() once #26 lands.
function buildRoomReadsApp() {
  const app = fastify().withTypeProvider<ZodTypeProvider>();
  app.setSerializerCompiler(serializerCompiler);
  app.setValidatorCompiler(validatorCompiler);
  app.setErrorHandler(fastifyErrorHandler);
  app.addHook('onRequest', async request => {
    request.getUser = () => ({
      id: CALLER_ID,
      name: null,
      username: 'caller',
      email: null,
      avatarUrl: null,
      providerId: null,
      providerUserId: null
    });
    request.getSession = () => ({
      id: 'session-1',
      userId: CALLER_ID,
      expiresAt: new Date(),
      fresh: false
    });
  });
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
    expect(response.json()).toEqual([
      {
        id: CALLER_ID,
        username: 'caller',
        avatarUrl: null,
        isHost: false,
        isReady: false,
        isActive: true,
        score: 0
      },
      {
        id: JUDGE_ID,
        username: 'judge',
        avatarUrl: null,
        isHost: true,
        isReady: false,
        isActive: true,
        score: 2
      }
    ]);
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
