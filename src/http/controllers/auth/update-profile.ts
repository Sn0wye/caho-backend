import type { App } from '@/app';
import { updateProfileRequest, updateProfileResponse } from '@/contracts';
import type { AuthModules } from '@/http/routes/auth';
import { ensureAuth } from '@/plugins/ensure-auth';
import { errorSchema } from '@/schemas';

export const updateProfileController = async (
  app: App,
  { users }: Pick<AuthModules, 'users'>
) => {
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
    async req => users.updateProfile(req.getUser().id, req.body)
  );
};
