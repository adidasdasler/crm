import { Body, Controller, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { audit } from '../common/audit';
import { Auth, AuthCtx, Can, NoDemo, Public } from '../common/auth';
import { AppError } from '../common/errors';
import { Zod } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { seal } from '../common/secret-box';
import { isYookassaIp } from '../billing/providers';
import { salonPay, syncPayment } from './prepayment';

const settingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['percent', 'fixed']),
  /** percent: 1–100; fixed: копейки */
  value: z.number().int().min(1).max(100_000_000),
  shopId: z.string().trim().regex(/^(\d{3,12}|mock)$/, 'shopId — номер магазина из личного кабинета ЮKassa').optional(),
  /** Секретный ключ: передаётся только при смене, назад не отдаётся */
  secretKey: z.string().trim().min(10).max(200).optional(),
}).refine((v) => v.mode !== 'percent' || v.value <= 100, 'Процент — от 1 до 100');

@Controller()
export class PrepaymentController {
  constructor(private readonly prisma: PrismaService) {}

  @Can('settings.manage')
  @Get('prepayment/settings')
  async get(@Auth() a: AuthCtx) {
    const s = await this.prisma.withTenant(a.tenantId, (tx) => tx.tenantPaymentSettings.findUnique({ where: { tenantId: a.tenantId } }));
    return { enabled: !!s?.enabled, mode: s?.mode ?? 'percent', value: s?.value ?? 30, shopId: s?.shopId ?? null, hasSecret: !!s?.secretEnc };
  }

  @Can('settings.manage')
  @NoDemo()
  @Put('prepayment/settings')
  async put(@Auth() a: AuthCtx, @Body(new Zod(settingsSchema)) dto: z.infer<typeof settingsSchema>) {
    return this.prisma.withTenant(a.tenantId, async (tx) => {
      const prev = await tx.tenantPaymentSettings.findUnique({ where: { tenantId: a.tenantId } });
      const shopId = dto.shopId ?? prev?.shopId ?? null;
      const secretEnc = dto.secretKey ? seal(dto.secretKey) : prev?.secretEnc ?? null;
      if (dto.enabled && (!shopId || !secretEnc)) throw new AppError('VALIDATION_ERROR', 'Укажите shopId и секретный ключ магазина ЮKassa');
      // Новые ключи проверяем сразу — иначе клиенты увидят ошибку при оплате
      if (dto.secretKey || (dto.shopId && dto.shopId !== prev?.shopId)) {
        const ok = await salonPay.verify({ shopId: shopId!, secret: dto.secretKey ?? (await import('../common/secret-box')).open(secretEnc!) });
        if (!ok) throw new AppError('YOOKASSA_KEYS', 'ЮKassa не приняла shopId или секретный ключ. Проверьте их в личном кабинете ЮKassa → Интеграция → Ключи API', 422);
      }
      const data = { enabled: dto.enabled, mode: dto.mode, value: dto.value, shopId, secretEnc };
      await tx.tenantPaymentSettings.upsert({ where: { tenantId: a.tenantId }, update: data, create: { tenantId: a.tenantId, ...data } });
      await audit(tx, a, 'prepayment.settings', 'Tenant', a.tenantId, null, { enabled: dto.enabled, mode: dto.mode, value: dto.value, shopId, keyChanged: !!dto.secretKey });
      return { enabled: dto.enabled, mode: dto.mode, value: dto.value, shopId, hasSecret: !!secretEnc };
    });
  }

  /**
   * Уведомления ЮKassa о платежах салонов. Адрес https://<домен>/v1/webhooks/yookassa-salon салон указывает
   * в своём кабинете ЮKassa. Телу не доверяем: проверяем IP и перезапрашиваем статус с ключами салона.
   */
  @Public()
  @HttpCode(200)
  @Post('webhooks/yookassa-salon')
  async webhook(@Req() req: Request, @Body() body: { object?: { metadata?: { bookingPaymentId?: string } } }) {
    if (!isYookassaIp(req.ip ?? '')) throw new AppError('FORBIDDEN', 'forbidden', 403);
    const id = body.object?.metadata?.bookingPaymentId;
    if (id && /^[0-9a-f-]{36}$/.test(id)) await syncPayment(this.prisma.system, id).catch(() => null);
    return { ok: true };
  }
}
