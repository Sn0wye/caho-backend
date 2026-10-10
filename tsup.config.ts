import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/migrate.ts'],
  dts: true,
  format: 'esm'
});
