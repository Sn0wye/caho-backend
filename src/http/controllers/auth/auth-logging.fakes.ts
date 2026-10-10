export class FakeAuthLogService {
  signInError?: Error;
  signOutError?: Error;

  async signIn(_username: string, _password: string) {
    if (this.signInError) throw this.signInError;
    return {
      cookie: {
        name: 'auth_session',
        value: 'private-token',
        attributes: { httpOnly: true }
      },
      user: {
        id: 'user-1',
        username: 'user',
        name: null,
        email: null,
        avatarUrl: null
      }
    };
  }

  async signOut(_sessionId: string) {
    if (this.signOutError) throw this.signOutError;
    return { name: 'auth_session', value: '', attributes: { maxAge: 0 } };
  }
}

export const fakeAuthLogService = new FakeAuthLogService();
