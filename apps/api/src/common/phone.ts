/** Нормализация российского/СНГ номера в E.164. Возвращает null, если номер некорректен. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10 && d.startsWith('9')) d = '7' + d;
  if (d.length < 10 || d.length > 15) return null;
  return '+' + d;
}
