import { HttpException, HttpStatus } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Объект') =>
  new AppError('NOT_FOUND', `${what} не найден`, HttpStatus.NOT_FOUND);
export const forbidden = (message = 'Недостаточно прав') =>
  new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const conflict = (code: string, message: string) =>
  new AppError(code, message, HttpStatus.CONFLICT);

/** Ошибка PostgreSQL exclusion_violation (23P01) — пересечение записей. */
export function isOverlapError(e: unknown): boolean {
  const s = String((e as any)?.message ?? '') + JSON.stringify((e as any)?.meta ?? {});
  return s.includes('23P01') || s.includes('booking_no_overlap');
}

/** Нарушение уникальности Prisma (P2002) или PostgreSQL 23505. */
export function isUniqueError(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === 'P2002' || String((e as any)?.message ?? '').includes('23505');
}
