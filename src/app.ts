import { env } from '@/env';
import { fastifyCookie } from '@fastify/cookie';
import { fastifyCors } from '@fastify/cors';
import { fastifySensible } from '@fastify/sensible';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import { fastifyWebsocket } from '@fastify/websocket';
import {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
  fastify
} from 'fastify';
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import type { GameModules } from './composition/game-modules';
import { fastifyErrorHandler } from './http/error-handler';
import { installHttpObservability } from './http/request-observability';
import { authRoutes } from './http/routes/auth';
import { type ReadinessProbes, checkRoutes } from './http/routes/checks';
import { pingRoute } from './http/routes/ping';
import { roomRoutes } from './http/routes/room';
import { wsRoutes } from './http/routes/ws';
import { type SessionValidator, authPlugin } from './plugins/auth';
import type { IUserRepository } from './repositories/user/IUserRepository';
import type { IGameEventSubscriber } from './services/IGameEventSubscriber';
import type { AuthService } from './services/auth/AuthService';

// import { csrfPlugin } from './plugins/csrf';

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  ZodTypeProvider
>;

// Everything the routes call, built once by the caller and passed in as plugin
// options. Production builds it over Postgres + Redis (composition/production);
// specs build it over in-memory adapters (app.fakes). issue #26.
export type AppModules = GameModules & {
  subscriber: IGameEventSubscriber;
  sessions: SessionValidator;
  auth: AuthService;
  users: IUserRepository;
  readiness: ReadinessProbes;
  logger: Logger;
};

/**
 * The HTTP + WS app over the given modules. Controllers no longer build their
 * own dependencies, so a spec swaps an adapter without `vi.mock`.
 *
 * @example
 * const app = buildApp(modules);
 * await app.inject({ url: '/rooms/ABC123/players', headers });
 */
export function buildApp(modules: AppModules): App {
  const app = fastify({
    logger: modules.logger as FastifyBaseLogger,
    disableRequestLogging: true,
    // Do not accept arbitrary client request IDs as log properties.
    requestIdHeader: false
  }).withTypeProvider<ZodTypeProvider>();

  installHttpObservability(app);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(fastifyErrorHandler);
  registerDocs(app);
  registerPlugins(app, modules);
  registerRoutes(app, modules);
  return app;
}

function registerDocs(app: App): void {
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'CAHO API',
        description: 'Caho game API',
        version: '1.0.0'
      },
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            description: 'Session cookie (auto-set)',
            in: 'cookie',
            name: 'auth_session'
          },
          bearerAuth: {
            type: 'http',
            description: 'Bearer token',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      }
    },
    transform: jsonSchemaTransform
  });
  app.register(fastifySwaggerUi, {
    routePrefix: '/docs'
  });
}

function registerPlugins(app: App, modules: AppModules): void {
  app.register(fastifyCors, {
    origin:
      env.NODE_ENV === 'production'
        ? ['https://caho.com.br']
        : ['http://localhost:3000'],
    credentials: true
  });
  app.register(fastifyWebsocket);
  app.register(fastifySensible);
  app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
    parseOptions: {}
  });
  // app.register(csrfPlugin, {
  //   enabled: env.NODE_ENV === 'production'
  // });
  app.register(authPlugin, { sessions: modules.sessions });
}

function registerRoutes(app: App, modules: AppModules): void {
  app.register(authRoutes, { prefix: '/auth', ...modules });
  app.register(roomRoutes, { prefix: '/rooms', ...modules });
  app.register(checkRoutes, { probes: modules.readiness });
  app.register(pingRoute);
  app.register(wsRoutes, { prefix: '/ws', ...modules });
}
