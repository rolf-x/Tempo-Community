/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { localClaudeBridge } from './server/claudeBridge.ts'
import { localGitHubApp } from './server/githubAppDev.ts'
import { localGitHubProxy } from './server/githubProxyDev.ts'
import { localMcp } from './server/mcpDev.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), localClaudeBridge(), localGitHubProxy(), localGitHubApp(), localMcp()],
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.mjs'] },
})
