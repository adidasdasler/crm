/**
 * Перенос из другой программы: YCLIENTS, DIKIDI, Excel, Google Таблицы.
 * Принимает CSV (UTF-8 или Windows-1251, разделитель «;», «,» или табуляция) и XLSX.
 * Колонки узнаём по названиям — у разных программ они называются по-разному.
 */
import readXlsxFile from 'read-excel-file/node';
import { normalizePhone } from '../common/phone';

export type ImportKind = 'customers' | 'services';
type Cell = string | number | boolean | Date | null;

/** Синонимы названий колонок (сравнение без регистра, ё = е, без лишних знаков) */
const FIELDS: Record<ImportKind, Record<string, string[]>> = {
  customers: {
    name: ['имя', 'фио', 'клиент', 'имя клиента', 'полное имя', 'name', 'client', 'имя и фамилия', 'ф.и.о.'],
    lastName: ['фамилия', 'surname', 'last name'],
    middleName: ['отчество'],
    phone: ['телефон', 'номер телефона', 'мобильный', 'мобильный телефон', 'тел', 'phone', 'телефон клиента', 'контактный телефон'],
    email: ['email', 'e-mail', 'почта', 'эл. почта', 'электронная почта', 'емейл'],
    birthDate: ['дата рождения', 'день рождения', 'birthday', 'др'],
    notes: ['комментарий', 'комментарии', 'заметки', 'заметка', 'примечание', 'описание', 'comment', 'note'],
    tags: ['категории', 'категория', 'метки', 'теги', 'группа', 'группы', 'категории клиента'],
    visits: ['визиты', 'визитов', 'количество визитов', 'число визитов', 'кол-во визитов', 'посещений', 'всего визитов'],
    spent: ['сумма продаж', 'оплачено', 'сумма', 'выручка', 'потрачено', 'сумма оплат', 'продажи', 'сумма визитов'],
    lastVisit: ['последний визит', 'дата последнего визита', 'последнее посещение'],
  },
  services: {
    name: ['название', 'услуга', 'наименование', 'название услуги', 'name', 'service'],
    price: ['цена', 'стоимость', 'цена от', 'цена, руб', 'цена руб', 'price', 'цена (руб.)', 'минимальная цена'],
    duration: ['длительность', 'продолжительность', 'время', 'длительность, мин', 'длительность (мин)', 'duration', 'мин'],
    category: ['категория', 'группа', 'раздел', 'категория услуг', 'category'],
  },
};

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[*:"«»]/g, '').replace(/\s+/g, ' ').trim();

/** Прочитать файл в таблицу строк */
export async function readTable(buf: Buffer, filename: string): Promise<Cell[][]> {
  const isXlsx = buf.subarray(0, 2).toString('latin1') === 'PK' || /\.xlsx$/i.test(filename);
  if (isXlsx) return (await readXlsxFile(buf)) as Cell[][];
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
  return parseCsv(text.replace(/^﻿/, ''));
}

/** CSV с кавычками и переносами строк внутри ячеек; разделитель определяется по первой строке */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Найти строку заголовков (в первых 10 строках) и сопоставить колонки полям */
export function detectColumns(rows: Cell[][], kind: ImportKind) {
  const fields = FIELDS[kind];
  let best = { header: -1, map: {} as Record<string, number>, score: 0 };
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const map: Record<string, number> = {};
    rows[h].forEach((cell, i) => {
      const n = norm(cell);
      if (!n) return;
      for (const [field, names] of Object.entries(fields)) {
        if (map[field] !== undefined) continue;
        if (names.includes(n) || names.some((x) => x.length > 3 && n.startsWith(x))) { map[field] = i; break; }
      }
    });
    const score = Object.keys(map).length + (map.name !== undefined ? 2 : 0) + (map.phone !== undefined ? 2 : 0);
    if (score > best.score) best = { header: h, map, score };
  }
  return best;
}

/** Определить программу по набору колонок — только для подсказки в интерфейсе */
export function guessSource(header: Cell[]): string {
  const h = header.map(norm).join('|');
  if (/категории|сумма продаж|первый визит/.test(h)) return 'YCLIENTS';
  if (/имя клиента|dikidi/.test(h)) return 'DIKIDI';
  return 'таблица';
}

const str = (v: Cell) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());
const num = (v: Cell) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** «01.02.1990», «1990-02-01», дата Excel → YYYY-MM-DD */
export function parseDate(v: Cell): string | null {
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString().slice(0, 10);
  const s = str(v);
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** «90», «1 ч 30 мин», «1:30», «01:30:00», «1,5 ч» → минуты */
export function parseDuration(v: Cell): number {
  if (typeof v === 'number') return v > 0 && v < 1 ? Math.round(v * 24 * 60) : Math.round(v); // доля суток из Excel
  const s = str(v).toLowerCase().replace(',', '.');
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return +m[1] * 60 + +m[2];
  const h = s.match(/([\d.]+)\s*ч/), mm = s.match(/(\d+)\s*мин/);
  if (h || mm) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (mm ? +mm[1] : 0));
  m = s.match(/^(\d+)/);
  return m ? +m[1] : 0;
}

export type CustomerRow = { name: string; phone: string; email: string | null; birthDate: string | null; notes: string | null; tags: string[]; visits: number; spent: number; lastVisit: string | null };
export type ServiceRow = { name: string; price: number; duration: number; category: string | null };

export function toCustomers(rows: Cell[][], header: number, map: Record<string, number>) {
  const ok: CustomerRow[] = [];
  let invalid = 0;
  for (const r of rows.slice(header + 1)) {
    const get = (f: string) => (map[f] !== undefined ? r[map[f]] ?? null : null);
    const name = [str(get('lastName')), str(get('name')), str(get('middleName'))].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 150);
    const phone = normalizePhone(str(get('phone')));
    if (!phone || !name) { if (r.some((x) => str(x))) invalid++; continue; }
    const email = str(get('email')).toLowerCase();
    ok.push({
      name, phone,
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.slice(0, 200) : null,
      birthDate: parseDate(get('birthDate')),
      notes: str(get('notes')).slice(0, 2000) || null,
      tags: str(get('tags')).split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, 40)),
      visits: Math.max(0, Math.round(num(get('visits')))),
      spent: Math.max(0, Math.round(num(get('spent')) * 100)),
      lastVisit: parseDate(get('lastVisit')),
    });
  }
  return { ok, invalid };
}

export function toServices(rows: Cell[][], header: number, map: Record<string, number>) {
  const ok: ServiceRow[] = [];
  let invalid = 0;
  for (const r of rows.slice(header + 1)) {
    const get = (f: string) => (map[f] !== undefined ? r[map[f]] ?? null : null);
    const name = str(get('name')).slice(0, 150);
    const duration = parseDuration(get('duration')) || 60;
    if (!name) { if (r.some((x) => str(x))) invalid++; continue; }
    ok.push({ name, price: Math.max(0, Math.round(num(get('price')) * 100)), duration: Math.min(Math.max(duration, 5), 24 * 60), category: str(get('category')).slice(0, 100) || null });
  }
  return { ok, invalid };
}
