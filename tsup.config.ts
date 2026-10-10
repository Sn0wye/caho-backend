import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/migrate.ts'],
  // This private server has no declaration consumers; CI runs tsc separately.
  dts: false,
  format: 'esm'
});
