import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { createRoomController } from '../controllers/room/create-room';
import { endRoomController } from '../controllers/room/end-room';
import { getRoomController } from '../controllers/room/get-room';
import { getRoomPlayersController } from '../controllers/room/get-room-players';
import { joinRoomController } from '../controllers/room/join-room';
import { leaveRoomController } from '../controllers/room/leave-room';
import { listRoomsController } from '../controllers/room/list-rooms';
import { playerReadyController } from '../controllers/room/player-ready';
import { startRoomController } from '../controllers/room/start-room';
import { getRoomBlackCardController } from '../controllers/room/get-room-black-card';
import { getCurrentWhiteCardsController } from '../controllers/room/get-current-white-cards';
import { playCardsController } from '../controllers/room/play-card';
import { getRoundPlayedCardsController } from '../controllers/room/get-round-played-cards';
import { getRoundController } from '../controllers/room/get-round';
import { judgeChooseWinner } from '../controllers/room/judge-choose-winner';

export const roomRoutes = async (
  app: App,
  { rooms, rounds, roomView }: GameModules
) => {
  // Picked, not forwarded: the options also carry this plugin's `prefix`.
  const modules: GameModules = { rooms, rounds, roomView };
  app.register(listRoomsController, modules);
  app.register(getRoomController, modules);
  app.register(getRoomPlayersController, modules);
  app.register(getRoomBlackCardController, modules);
  app.register(createRoomController, modules);
  app.register(joinRoomController, modules);
  app.register(leaveRoomController, modules);
  app.register(startRoomController, modules);
  app.register(endRoomController, modules);
  app.register(playerReadyController, modules);
  app.register(getCurrentWhiteCardsController, modules);
  app.register(playCardsController, modules);
  app.register(getRoundPlayedCardsController, modules);
  app.register(getRoundController, modules);
  // Without this the Judge had no way to pick, so every Round stalled in judging.
  app.register(judgeChooseWinner, modules);
};
