import { Controller, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { audit } from '../common/audit';
import { Auth, AuthCtx, can, NoDemo } from '../common/auth';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { detectColumns, guessSource, ImportKind, readTable, toCustomers, toServices } from './import-file';

const LABELS: Record<string, string> = {
  name: 'Имя', lastName: 'Фамилия', middleName: 'Отчество', phone: 'Телефон', email: 'Email', birthDate: 'Дата рождения',
  notes: 'Заметки', tags: 'Метки', visits: 'Визитов', spent: 'Потратил', lastVisit: 'Последний визит',
  price: 'Цена', duration: 'Длительность', category: 'Категория',
};

/**
 * Перенос из другой программы. Сначала ?dryRun=1 — показываем, что нашли (колонки и первые строки),
 * затем тот же файл без dryRun — загружаем. Существующие клиенты (по телефону) и услуги (по названию) не дублируются.
 */
@Controller('import')
export class ImportController {
  constructor(private readonly prisma: PrismaService) {}

  @NoDemo()
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async import(@Auth() a: AuthCtx, @UploadedFile() file: Express.Multer.File | undefined, @Query('kind') kindRaw?: string, @Query('dryRun') dryRun?: string) {
    const kind: ImportKind = kindRaw === 'services' ? 'services' : 'customers';
    if (kind === 'customers' && !can(a, 'customers.view')) throw new AppError('FORBIDDEN', 'Нет доступа к базе клиентов', 403);
    if (kind === 'services' && !can(a, 'catalog.manage')) throw new AppError('FORBIDDEN', 'Нет доступа к услугам', 403);
    if (!file?.buffer?.length) throw new AppError('VALIDATION_ERROR', 'Выберите файл .xlsx или .csv');

    let rows;
    try {
      rows = await readTable(file.buffer, file.originalname ?? '');
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Не удалось прочитать файл. Сохраните его как .xlsx или .csv и попробуйте снова');
    }
    const { header, map } = detectColumns(rows, kind);
    const need = kind === 'customers' ? ['name', 'phone'] : ['name'];
    const missing = need.filter((f) => map[f] === undefined);
    if (header < 0 || missing.length) {
      throw new AppError('IMPORT_COLUMNS', `Не нашли колонки: ${missing.map((f) => LABELS[f]).join(', ')}. Проверьте, что в первой строке файла есть заголовки`, 422);
    }
    const parsed = kind === 'customers' ? toCustomers(rows, header, map) : toServices(rows, header, map);
    const columns = Object.entries(map).map(([f, i]) => ({ field: LABELS[f] ?? f, column: String(rows[header][i] ?? '') }));
    const summary = { kind, source: guessSource(rows[header]), columns, total: parsed.ok.length, invalid: parsed.invalid, sample: parsed.ok.slice(0, 5) };
    if (dryRun) return summary;

    return this.prisma.withTenant(a.tenantId, async (tx) => {
      if (kind === 'customers') {
        const list = toCustomers(rows, header, map).ok;
        const existing = new Set((await tx.customer.findMany({ where: { phone: { in: list.map((c) => c.phone) } }, select: { phone: true } })).map((c) => c.phone));
        const fresh = [...new Map(list.filter((c) => !existing.has(c.phone)).map((c) => [c.phone, c])).values()];
        const r = await tx.customer.createMany({
          data: fresh.map((c) => ({
            tenantId: a.tenantId, name: c.name, phone: c.phone, email: c.email, notes: c.notes, tags: c.tags,
            birthDate: c.birthDate ? new Date(`${c.birthDate}T00:00:00Z`) : null,
            totalVisits: c.visits, totalSpent: c.spent, lastVisitAt: c.lastVisit ? new Date(`${c.lastVisit}T12:00:00Z`) : null,
          })),
          skipDuplicates: true,
        });
        await audit(tx, a, 'customer.import', 'Customer', null, null, { created: r.count, source: summary.source });
        return { ...summary, sample: undefined, created: r.count, skipped: list.length - r.count };
      }
      const list = toServices(rows, header, map).ok;
      const have = new Set((await tx.service.findMany({ where: { deletedAt: null }, select: { name: true } })).map((s) => s.name.toLowerCase()));
      const cats = new Map((await tx.serviceCategory.findMany()).map((c) => [c.name.toLowerCase(), c.id]));
      const masters = await tx.resource.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
      let created = 0;
      for (const s of list) {
        if (have.has(s.name.toLowerCase())) continue;
        let categoryId: string | null = null;
        if (s.category) {
          categoryId = cats.get(s.category.toLowerCase()) ?? null;
          if (!categoryId) {
            categoryId = (await tx.serviceCategory.create({ data: { tenantId: a.tenantId, name: s.category, sortOrder: cats.size } })).id;
            cats.set(s.category.toLowerCase(), categoryId);
          }
        }
        const svc = await tx.service.create({ data: { tenantId: a.tenantId, name: s.name, price: s.price, duration: s.duration, categoryId, sortOrder: created } });
        // Услуги сразу доступны всем мастерам — лишнее можно снять в карточке мастера
        if (masters.length) await tx.serviceResource.createMany({ data: masters.map((m) => ({ tenantId: a.tenantId, serviceId: svc.id, resourceId: m.id })) });
        have.add(s.name.toLowerCase());
        created++;
      }
      await audit(tx, a, 'service.import', 'Service', null, null, { created, source: summary.source });
      return { ...summary, sample: undefined, created, skipped: list.length - created };
    });
  }
}
