-- Отдельные записи в кабинете клиента: сделанные из кабинета и привязанные по ссылке «управлять записью».
-- Привязка по записи, а не по клиенту салона целиком: чужая ссылка или чужой телефон не открывают всю историю.
CREATE TABLE "ClientBooking" (
  "clientUserId" UUID NOT NULL REFERENCES "ClientUser"("id") ON DELETE CASCADE,
  "bookingId"    UUID NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("clientUserId", "bookingId")
);
CREATE INDEX "ClientBooking_booking_idx" ON "ClientBooking"("bookingId");
REVOKE ALL ON "ClientBooking" FROM salon_app;
