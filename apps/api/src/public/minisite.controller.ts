import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import { Public } from '../common/auth';
import { notFound } from '../common/errors';
import { industry, INDUSTRIES } from '../common/industries';
import { PrismaService } from '../common/prisma.service';
import { readSettings } from '../common/tenant-settings';
import { env } from '../config';
import { renderMiniSite, salonHours } from './minisite';

/** Метки источника для ссылок записи: салон видит в «Обзоре», откуда пришёл клиент */
export const SOURCES = ['yandex', '2gis', 'vk', 'telegram', 'max', 'instagram', 'whatsapp', 'avito', 'site', 'qr'] as const;
const SRC_RE = /^[a-z0-9_-]{1,32}$/;

@Public()
@Controller()
export class MiniSiteController {
  constructor(private readonly prisma: PrismaService) {}

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
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null } });
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
      hours: salonHours(masters.map((m) => m.schedule)), services, masters: masters.map(({ name, position }) => ({ name, position })), links: s.links ?? {},
    });
    res.set('Cache-Control', 'public, max-age=600').type('text/html; charset=utf-8').send(html);
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
    const t = await this.prisma.app.tenant.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null }, select: { slug: true } });
    if (!t) throw notFound('Салон');
    const tag = src && SRC_RE.test(src) ? src : 'qr';
    const url = `${env.PUBLIC_WEB_URL}/b/${t.slug}?src=${tag}`;
    const opts = { margin: 1, color: { dark: '#0E0F2B', light: '#FFFFFF' }, errorCorrectionLevel: 'M' as const };
    res.set('Cache-Control', 'public, max-age=86400');
    if (ext === 'png') res.type('image/png').send(await QRCode.toBuffer(url, { ...opts, width: 600 }));
    else res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  }
}
