import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(process.cwd(), 'test/support/vscode-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: { reporter: ['text', 'json-summary'] },
  },
})
