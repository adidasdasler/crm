import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://salon_app:salon_app@localhost:5432/salon_test',
      SYSTEM_DATABASE_URL: process.env.TEST_SYSTEM_DATABASE_URL ?? 'postgresql://salon:salon@localhost:5432/salon_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_BOT_USERNAME: 'salon_test_bot',
      TELEGRAM_WEBHOOK_SECRET: 'tg-webhook-secret',
      MAX_BOT_TOKEN: 'max-test-token',
      MAX_BOT_USERNAME: 'mioflow_test_bot',
      MAX_WEBHOOK_SECRET: 'max-webhook-secret',
      VK_GROUP_TOKEN: 'vk-test-token',
      VK_GROUP_SCREEN_NAME: 'mioflow_test',
      VK_SECRET: 'vk-secret',
      VK_CONFIRMATION_CODE: 'vk-confirm-123',
      SMTP_URL: 'smtp://localhost:2525',
      PAYMENT_PROVIDER: 'mock',
      PUSH_ENABLED: 'true',
    },
  },
});
