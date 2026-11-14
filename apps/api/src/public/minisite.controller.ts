import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import { Public } from '../common/auth';
import { notFound } from '../common/errors';
import { industry, INDUSTRIES } from '../common/industries';
import { PrismaService } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { env } from '../config';
import { storage } from '../media/storage';
import { renderMiniSite, salonHours } from './minisite';
import { timingSafeEqual } from 'node:crypto';
import { unsubscribeSig } from '../marketing/winback';

/** Метки источника для ссылок записи: салон видит в «Обзоре», откуда пришёл клиент */
export const SOURCES = ['yandex', '2gis', 'vk', 'telegram', 'max', 'instagram', 'whatsapp', 'avito', 'site', 'qr'] as const;
const SRC_RE = /^[a-z0-9_-]{1,32}$/;

@Public()
@Controller()
export class MiniSiteController {
  constructor(private readonly prisma: PrismaService) {}

  /** Отписка от рассылок салона по ссылке из сообщения (подпись HMAC — чужой id не подобрать) */
  @Get('unsubscribe/:id/:sig')
  async unsubscribe(@Param('id', ParseUUIDPipe) id: string, @Param('sig') sig: string, @Res() res: Response) {
    const page = (title: string, text: string) =>
      res.type('html').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center"><h1 style="font-size:24px">${title}</h1><p style="color:#555">${text}</p></body></html>`);
    if (sig.length !== unsubscribeSig(id).length || !timingSafeEqual(Buffer.from(sig), Buffer.from(unsubscribeSig(id)))) return page('Ссылка недействительна', 'Попросите салон отключить сообщения для вас.');
    const c = await this.prisma.system.customer.findUnique({ where: { id }, select: { id: true, tenantId: true } });
    if (c) {
      await this.prisma.system.customer.update({ where: { id }, data: { marketingConsent: false } });
      await this.prisma.system.auditLog.create({ data: { tenantId: c.tenantId, action: 'customer.unsubscribe', entityType: 'Customer', entityId: id } });
    }
    return page('Вы отписались', 'Больше не будем присылать предложения и поздравления. Напоминания о ваших записях будут приходить как обычно.');
  }

  /** Справочник отраслей для регистрации */
  @Get('public-meta/industries')
  industries() {
    return INDUSTRIES.map(({ code, label, group, terms }) => ({ code, label, group, terms }));
  }

  /**
   * HTML мини-сайта для поисковых роботов и превью ссылок. Nginx отдаёт его ботам по адресу /b/<slug>
   * (Яндекс, 2ГИС, Telegram, VK), людям — обычное приложение записи.
   */
  @Get('public/:slug/page')
  async page(@Param('slug') slug: string, @Res() res: Response) {
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null, blockedAt: null } });
    if (!t) throw notFound('Салон');
    const s = readSettings(t.settings);
    const ind = industry(s.industry);
    const { services, masters } = await this.prisma.withTenant(t.id, async (tx) => ({
      services: await tx.service.findMany({
        where: { deletedAt: null, isActive: true, isPublic: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, price: true, duration: true }, take: 200,
      }),
      masters: await tx.resource.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { name: true, position: true, schedule: true } }),
    }));
    const html = renderMiniSite({
      name: t.name, slug: t.slug, phone: t.phone, address: t.address, about: s.about,
      url: `${env.PUBLIC_WEB_URL}/b/${t.slug}`, ogImage: `${env.PUBLIC_WEB_URL}/og.png`,
      schemaType: ind.schemaType, industryLabel: ind.label,
      hours: salonHours(masters.map((m) => m.schedule), t.timezone), services, masters: masters.map(({ name, position }) => ({ name, position })), links: s.links ?? {},
    });
    res.set('Cache-Control', 'public, max-age=600').type('text/html; charset=utf-8').send(html);
  }

  /** Портфолио салона: опубликованные фото работ */
  @Get('public/:slug/portfolio')
  async portfolio(@Param('slug') slug: string) {
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null, blockedAt: null }, select: { id: true } });
    if (!t) throw notFound('Салон');
    return this.prisma.withTenant(t.id, async (tx) => {
      const rows = await tx.design.findMany({ where: { isPublic: true }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, title: true, tags: true, resourceId: true, serviceId: true, width: true, height: true } });
      const [res, svc] = await Promise.all([
        tx.resource.findMany({ where: { id: { in: rows.map((r) => r.resourceId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
        tx.service.findMany({ where: { id: { in: rows.map((r) => r.serviceId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      ]);
      return rows.map(({ resourceId, serviceId, ...r }) => ({ ...r, master: res.find((x) => x.id === resourceId)?.name ?? null, service: svc.find((x) => x.id === serviceId)?.name ?? null }));
    });
  }

  @Get('public/:slug/portfolio/:id/:size')
  async portfolioImage(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @Param('size') size: string, @Res() res: Response) {
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null, blockedAt: null }, select: { id: true } });
    if (!t) throw notFound('Салон');
    const d = await this.prisma.withTenant(t.id, (tx) => tx.design.findFirst({ where: { id, isPublic: true }, select: { fileKey: true, thumbKey: true } }));
    if (!d) throw notFound('Фото');
    const buf = await storage.get(size === 'thumb' ? d.thumbKey : d.fileKey);
    if (!buf) throw notFound('Фото');
    res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).type('image/jpeg').send(buf);
  }

  /** QR-код ссылки записи — для стойки администратора, визиток, наклейки на зеркало */
  @Get('public/:slug/qr.svg')
  qrSvg(@Param('slug') slug: string, @Query('src') src: string | undefined, @Res() res: Response) {
    return this.qr(slug, 'svg', src, res);
  }

  @Get('public/:slug/qr.png')
  qrPng(@Param('slug') slug: string, @Query('src') src: string | undefined, @Res() res: Response) {
    return this.qr(slug, 'png', src, res);
  }

  private async qr(slug: string, ext: 'svg' | 'png', src: string | undefined, res: Response) {
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null, blockedAt: null }, select: { slug: true } });
    if (!t) throw notFound('Салон');
    const tag = src && SRC_RE.test(src) ? src : 'qr';
    const url = `${env.PUBLIC_WEB_URL}/b/${t.slug}?src=${tag}`;
    const opts = { margin: 1, color: { dark: '#0E0F2B', light: '#FFFFFF' }, errorCorrectionLevel: 'M' as const };
    res.set('Cache-Control', 'public, max-age=86400');
    if (ext === 'png') res.type('image/png').send(await QRCode.toBuffer(url, { ...opts, width: 600 }));
    else res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  }
}
