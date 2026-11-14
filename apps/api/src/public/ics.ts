/** Файл календаря (.ics): визит попадает в календарь телефона — с адресом, мастером и услугами */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Строки длиннее 75 байт по стандарту переносятся с пробелом в начале следующей */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' '; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function bookingIcs(b: {
  id: string; startsAt: Date; endsAt: Date; cancelled: boolean;
  salon: string; address: string | null; phone: string | null; master: string; services: string[]; url: string;
}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MioFlow//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id}@mioflow.ru`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(b.startsAt)}`,
    `DTEND:${stamp(b.endsAt)}`,
    `SUMMARY:${esc(`${b.services.join(', ')} — ${b.salon}`)}`,
    ...(b.address ? [`LOCATION:${esc(b.address)}`] : []),
    `DESCRIPTION:${esc([`Мастер: ${b.master}`, `Услуги: ${b.services.join(', ')}`, b.phone ? `Телефон салона: ${b.phone}` : '', `Перенести или отменить: ${b.url}`].filter(Boolean).join('\n'))}`,
    `URL:${b.url}`,
    `STATUS:${b.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Напоминание о записи', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
