import {
  type SessionCookie,
  createBlankSessionCookie,
  createSessionCookie
} from '@/auth/session-cookie';
import type { UserSchema } from '@/schemas';

export class FakeAuthLogService {
  signInError?: Error;
  signOutError?: Error;

  async signIn(
    _username: string,
    _password: string
  ): Promise<{ cookie: SessionCookie; user: UserSchema }> {
    if (this.signInError) throw this.signInError;
    return {
      cookie: createSessionCookie('private-token'),
      user: {
        id: 'user-1',
        username: 'user',
        name: null,
        email: null,
        password: 'private-hash',
        avatarUrl: null
      }
    };
  }

  async signOut(_sessionId: string): Promise<SessionCookie> {
    if (this.signOutError) throw this.signOutError;
    return createBlankSessionCookie();
  }
}
