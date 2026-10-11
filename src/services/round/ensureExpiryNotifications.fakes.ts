export class FakeExpiryRedisSettings {
  flags = '';
  denied = false;
  readonly changedFlags: string[] = [];

  async config(
    operation: string,
    setting: string,
    flags?: string
  ): Promise<string[] | 'OK'> {
    if (this.denied) throw new Error('CONFIG permission denied');
    if (operation === 'GET') return [setting, this.flags];
    this.changedFlags.push(flags ?? '');
    return 'OK';
  }
}
