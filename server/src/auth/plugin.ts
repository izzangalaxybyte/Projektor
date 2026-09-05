import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AuthSession, type AuthUser } from './service.js';

declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthService;
    /** preHandler that rejects non-admin callers with 403. Routes are already authenticated. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
    session: AuthSession | null;
  }
  interface FastifyContextConfig {
    /** Set on routes that must be reachable without a token (health, setup, login). */
    public?: boolean;
  }
}

/**
 * Bearer-token authentication for everything under /api. Routes opt out with
 * `config: { public: true }`. Populates request.user and request.session.
 */
export const authPlugin = fp(
  async (app) => {
    const auth = new AuthService(app.db);
    app.decorate('auth', auth);
    app.decorateRequest('user', null);
    app.decorateRequest('session', null);

    app.addHook('onRequest', async (request, reply) => {
      if (request.routeOptions.config.public) return;
      if (!request.url.startsWith('/api/')) return;
      const header = request.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
      const resolved = token ? auth.authenticate(token) : null;
      if (!resolved) {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'A valid bearer token is required',
        });
      }
      request.user = resolved.user;
      request.session = resolved.session;
    });

    app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user?.isAdmin) {
        return reply
          .code(403)
          .send({ statusCode: 403, error: 'Forbidden', message: 'Admin access required' });
      }
    });
  },
  { name: 'auth', dependencies: [] },
);
