import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { env } from './config';
import { AllExceptionsFilter, EnvelopeInterceptor } from './common/http';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  // За Nginx: доверяем одному прокси, чтобы req.ip был реальным IP клиента.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: any, res: any, next: () => void) => {
    const id = (req.headers['x-request-id'] as string)?.slice(0, 64) || randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('X-Request-ID', id);
    next();
  });
  const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID', 'X-Client'] });
  app.setGlobalPrefix('v1');
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
