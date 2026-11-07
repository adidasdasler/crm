import {
  ArgumentsHost, CallHandler, Catch, ExceptionFilter, ExecutionContext,
  HttpException, Injectable, Logger, NestInterceptor, PipeTransform,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
import { ZodSchema } from 'zod';
import { AppError } from './errors';

/** Все успешные ответы: { success: true, data, meta? } */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((res) =>
        res && typeof res === 'object' && 'items' in res && 'meta' in res
          ? { success: true, data: res.items, meta: res.meta }
          : { success: true, data: res ?? null },
      ),
    );
  }
}

/** Все ошибки: { success: false, error: { code, message, details? } } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      const code =
        exception instanceof AppError
          ? exception.code
          : status === 429 ? 'RATE_LIMITED'
          : status === 404 ? 'NOT_FOUND'
          : status === 401 ? 'UNAUTHORIZED'
          : status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST';
      const message = typeof body === 'string' ? body : body?.message ?? exception.message;
      return res.status(status).json({
        success: false,
        error: { code, message: Array.isArray(message) ? message.join('; ') : message, details: body?.details },
      });
    }
    this.log.error({ err: exception, path: req.url, requestId: req.headers['x-request-id'] });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' },
    });
  }
}

/** Валидация тела/квери через zod: @Body(new Zod(schema)) */
export class Zod<T> implements PipeTransform {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly schema: ZodSchema<T, any, any>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new AppError('VALIDATION_ERROR', 'Проверьте введённые данные', 400, r.error.flatten());
    }
    return r.data;
  }
}

export type Paged<T> = { items: T[]; meta: { page: number; limit: number; total: number } };
