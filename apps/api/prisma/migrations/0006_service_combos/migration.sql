-- Комплекс услуг («стрижка + борода»): одна услуга со своей ценой и временем, из каких услуг состоит
ALTER TABLE "Service" ADD COLUMN "comboOf" UUID[] NOT NULL DEFAULT '{}';
