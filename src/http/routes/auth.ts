import type { App } from '@/app';
import type { IUserRepository } from '@/repositories/user/IUserRepository';
import type { AuthService } from '@/services/auth/AuthService';
import { getProfileController } from '../controllers/auth/get-profile';
import { signInController } from '../controllers/auth/sign-in';
import { signInWithGithub } from '../controllers/auth/sign-in-with-github';
import { signInWithGoogle } from '../controllers/auth/sign-in-with-google';
import { signOutController } from '../controllers/auth/sign-out';
import { signUpController } from '../controllers/auth/sign-up';
import { updateProfileController } from '../controllers/auth/update-profile';

export type AuthModules = { auth: AuthService; users: IUserRepository };

export const authRoutes = async (app: App, { auth, users }: AuthModules) => {
  // Picked, not forwarded: the options also carry this plugin's `prefix`.
  const modules: AuthModules = { auth, users };
  app.register(signUpController, modules);
  app.register(signInController, modules);
  app.register(signInWithGithub, modules);
  app.register(signInWithGoogle, modules);
  app.register(getProfileController, modules);
  app.register(updateProfileController, modules);
  app.register(signOutController, modules);
};
