-- Удалённые салоны больше не держат адрес страницы: его можно сразу занять заново
UPDATE "Tenant" SET "slug" = 'removed-' || "id" WHERE "deletedAt" IS NOT NULL AND "slug" NOT LIKE 'deleted-%' AND "slug" NOT LIKE 'removed-%';
