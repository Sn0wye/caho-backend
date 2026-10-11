import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/migrate.ts'],
  // This private server has no declaration consumers; CI runs tsc separately.
  dts: false,
  // Keep app dependencies in lazy chunks so OTEL patches them before loading.
  splitting: true,
  clean: true,
  format: 'esm'
});
