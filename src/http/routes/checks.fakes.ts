export class FakeReadinessPostgres {
  available = true;
  async execute(_statement: unknown): Promise<unknown[]> {
    if (!this.available) throw new Error('PostgreSQL unavailable');
    return [];
  }
}

export class FakeReadinessRedis {
  available = true;
  async ping(): Promise<string> {
    if (!this.available) throw new Error('Redis unavailable');
    return 'PONG';
  }
}
