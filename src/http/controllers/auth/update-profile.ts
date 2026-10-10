import type { App } from '@/app';
import { db } from '@/db';
import { users } from '@/db/schema';
import { BadRequestError } from '@/errors';
import { ensureAuth } from '@/plugins/ensure-auth';
import { updateProfileRequest, updateProfileResponse } from '@/contracts';
import { errorSchema } from '@/schemas';
import { eq } from 'drizzle-orm';

export const updateProfileController = async (app: App) => {
  app.register(ensureAuth).post(
    '/profile',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Update user profile',
        security: [{ cookieAuth: [], bearerAuth: [] }],
        body: updateProfileRequest,
        response: {
          200: updateProfileResponse,
          400: errorSchema,
          401: errorSchema,
          422: errorSchema
        }
      }
    },
    async req => {
      const user = req.getUser();

      const { username, email, avatarUrl } = req.body;

      const existingUser = await db.query.users.findFirst({
        where: (users, { and, eq, ne, or }) =>
          and(
            ne(users.id, user.id),
            email
              ? or(eq(users.username, username), eq(users.email, email))
              : eq(users.username, username)
          )
      });

      if (existingUser) {
        throw new BadRequestError(
          existingUser.username === username
            ? 'Esse nome de usuário já está em uso.'
            : 'Esse email já está em uso.'
        );
      }

      const updatedUser = (
        await db
          .update(users)
          .set({ email, avatarUrl, username })
          .where(eq(users.id, user.id))
          .returning({
            id: users.id,
            name: users.name,
            username: users.username,
            email: users.email,
            avatarUrl: users.avatarUrl
          })
      )[0];

      return updatedUser;
    }
  );
};
