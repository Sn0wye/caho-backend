// Replaces lucia's `Session` / `User` types. `SessionUser` mirrors the shape the
// old `getUserAttributes` returned so request handlers (`req.getUser()`) are
// unaffected by the migration.

export type SessionUser = {
  id: string;
  name: string | null;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  providerId: string | null;
  providerUserId: string | null;
};

export type Session = {
  id: string;
  userId: string;
  expiresAt: Date;
  fresh: boolean;
};

export type SessionValidationResult =
  | { session: Session; user: SessionUser }
  | { session: null; user: null };
