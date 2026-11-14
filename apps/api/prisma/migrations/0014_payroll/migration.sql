-- Правило оплаты мастера: процент от услуг, оплата за смену, оклад в месяц, вычет материалов
ALTER TABLE "Resource" ADD COLUMN "payRule" JSONB;
