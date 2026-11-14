/**
 * Отрасли. MioFlow — запись к специалисту по времени; ядро (мастера, услуги, записи, напоминания)
 * общее, а отрасль меняет только слова в интерфейсе, шаблоны услуг и разметку для поисковиков.
 *
 * Медицина сознательно не поддерживается: нужна лицензия, а диагнозы и жалобы — специальная
 * категория ПДн (ст. 10 152-ФЗ) с другими требованиями к защите.
 */
export type Terms = {
  /** мастер / тренер / преподаватель */
  staff: string; staffPlural: string;
  /** клиент / ученик / гость */
  client: string; clientPlural: string;
  /** салон / студия / центр */
  place: string;
};
/** combo — названия услуг этого же шаблона, из которых состоит комплекс */
type Tpl = { name: string; price: number; duration: number; bufferTime?: number; combo?: string[] };
export type Industry = { code: string; label: string; group: string; schemaType: string; terms: Terms; templates: Tpl[] };

const BEAUTY: Terms = { staff: 'Мастер', staffPlural: 'Мастера', client: 'Клиент', clientPlural: 'Клиенты', place: 'Салон' };
const STUDIO: Terms = { ...BEAUTY, place: 'Студия' };
const r = (rub: number) => rub * 100;

export const INDUSTRIES: Industry[] = [
  // ─── Красота ───
  { code: 'beauty', label: 'Салон красоты', group: 'Красота', schemaType: 'BeautySalon', terms: BEAUTY, templates: [
    { name: 'Женская стрижка', price: r(2000), duration: 60 }, { name: 'Маникюр с покрытием', price: r(2200), duration: 120, bufferTime: 10 },
    { name: 'Коррекция бровей', price: r(800), duration: 30 }, { name: 'Укладка', price: r(1500), duration: 45 },
  ] },
  { code: 'nails', label: 'Ногтевая студия', group: 'Красота', schemaType: 'NailSalon', terms: STUDIO, templates: [
    { name: 'Маникюр без покрытия', price: r(1200), duration: 60 }, { name: 'Маникюр с покрытием гель-лак', price: r(2200), duration: 120, bufferTime: 10 },
    { name: 'Педикюр с покрытием', price: r(2800), duration: 120, bufferTime: 10 }, { name: 'Снятие покрытия', price: r(300), duration: 15 },
    { name: 'Комплекс: маникюр + педикюр с покрытием', price: r(4600), duration: 210, bufferTime: 10, combo: ['Маникюр с покрытием гель-лак', 'Педикюр с покрытием'] },
  ] },
  { code: 'hair', label: 'Парикмахерская', group: 'Красота', schemaType: 'HairSalon', terms: BEAUTY, templates: [
    { name: 'Женская стрижка', price: r(2000), duration: 60 }, { name: 'Мужская стрижка', price: r(1200), duration: 45 },
    { name: 'Окрашивание в один тон', price: r(4500), duration: 150, bufferTime: 15 }, { name: 'Укладка', price: r(1500), duration: 45 },
  ] },
  { code: 'barber', label: 'Барбершоп', group: 'Красота', schemaType: 'HairSalon', terms: { ...BEAUTY, staff: 'Барбер', staffPlural: 'Барберы', place: 'Барбершоп' }, templates: [
    { name: 'Мужская стрижка', price: r(1500), duration: 60 }, { name: 'Стрижка бороды', price: r(1000), duration: 30 },
    { name: 'Комплекс: стрижка + борода', price: r(2200), duration: 75, combo: ['Мужская стрижка', 'Стрижка бороды'] },
  ] },
  { code: 'brows', label: 'Брови и ресницы', group: 'Красота', schemaType: 'BeautySalon', terms: STUDIO, templates: [
    { name: 'Коррекция бровей', price: r(800), duration: 30 }, { name: 'Окрашивание бровей', price: r(700), duration: 30 },
    { name: 'Ламинирование ресниц', price: r(2500), duration: 75 }, { name: 'Наращивание ресниц', price: r(3000), duration: 120, bufferTime: 10 },
  ] },
  { code: 'cosmetology', label: 'Эстетическая косметология', group: 'Красота', schemaType: 'BeautySalon', terms: { ...STUDIO, staff: 'Косметолог', staffPlural: 'Косметологи' }, templates: [
    { name: 'Чистка лица', price: r(3500), duration: 90 }, { name: 'Уходовая процедура', price: r(2500), duration: 60 }, { name: 'Пилинг', price: r(2000), duration: 45 },
  ] },
  { code: 'massage', label: 'Массаж и СПА', group: 'Красота', schemaType: 'DaySpa', terms: { ...STUDIO, staff: 'Массажист', staffPlural: 'Массажисты' }, templates: [
    { name: 'Классический массаж спины', price: r(2000), duration: 45, bufferTime: 15 }, { name: 'Общий массаж', price: r(3500), duration: 90, bufferTime: 15 },
    { name: 'СПА-программа', price: r(5000), duration: 120, bufferTime: 15 },
  ] },
  { code: 'tattoo', label: 'Тату и пирсинг', group: 'Красота', schemaType: 'TattooParlor', terms: STUDIO, templates: [
    { name: 'Консультация и эскиз', price: 0, duration: 30 }, { name: 'Тату — сеанс', price: r(8000), duration: 180, bufferTime: 30 }, { name: 'Пирсинг', price: r(2000), duration: 30 },
  ] },
  // ─── Спорт и обучение ───
  { code: 'fitness', label: 'Фитнес, йога, танцы', group: 'Спорт и обучение', schemaType: 'ExerciseGym',
    terms: { staff: 'Тренер', staffPlural: 'Тренеры', client: 'Клиент', clientPlural: 'Клиенты', place: 'Студия' }, templates: [
      { name: 'Персональная тренировка', price: r(2500), duration: 60 }, { name: 'Пробное занятие', price: 0, duration: 60 }, { name: 'Растяжка', price: r(1500), duration: 60 },
    ] },
  { code: 'education', label: 'Репетиторы и курсы', group: 'Спорт и обучение', schemaType: 'EducationalOrganization',
    terms: { staff: 'Преподаватель', staffPlural: 'Преподаватели', client: 'Ученик', clientPlural: 'Ученики', place: 'Школа' }, templates: [
      { name: 'Индивидуальное занятие', price: r(1500), duration: 60 }, { name: 'Пробный урок', price: 0, duration: 30 }, { name: 'Подготовка к экзамену', price: r(2000), duration: 90 },
    ] },
  // ─── Услуги ───
  { code: 'auto', label: 'Автосервис и детейлинг', group: 'Услуги', schemaType: 'AutoRepair',
    terms: { staff: 'Мастер', staffPlural: 'Мастера', client: 'Клиент', clientPlural: 'Клиенты', place: 'Сервис' }, templates: [
      { name: 'Шиномонтаж', price: r(2500), duration: 60 }, { name: 'Замена масла', price: r(1500), duration: 45 }, { name: 'Комплексная мойка', price: r(1800), duration: 90 },
    ] },
  { code: 'pets', label: 'Груминг', group: 'Услуги', schemaType: 'LocalBusiness', terms: { ...STUDIO, staff: 'Грумер', staffPlural: 'Грумеры' }, templates: [
    { name: 'Комплексный груминг (малые породы)', price: r(3000), duration: 120 }, { name: 'Гигиеническая стрижка', price: r(1500), duration: 60 }, { name: 'Стрижка когтей', price: r(500), duration: 15 },
  ] },
  { code: 'photo', label: 'Фотостудия', group: 'Услуги', schemaType: 'ProfessionalService', terms: { ...STUDIO, staff: 'Фотограф', staffPlural: 'Фотографы' }, templates: [
    { name: 'Аренда зала, 1 час', price: r(2000), duration: 60 }, { name: 'Портретная съёмка', price: r(6000), duration: 90 },
  ] },
  { code: 'consulting', label: 'Консультации (психолог, коуч, юрист)', group: 'Услуги', schemaType: 'ProfessionalService',
    terms: { staff: 'Специалист', staffPlural: 'Специалисты', client: 'Клиент', clientPlural: 'Клиенты', place: 'Кабинет' }, templates: [
      { name: 'Консультация', price: r(3000), duration: 50, bufferTime: 10 }, { name: 'Первая встреча', price: r(1500), duration: 30 },
    ] },
  { code: 'other', label: 'Другое', group: 'Услуги', schemaType: 'LocalBusiness',
    terms: { staff: 'Специалист', staffPlural: 'Специалисты', client: 'Клиент', clientPlural: 'Клиенты', place: 'Компания' }, templates: [] },
];

export const INDUSTRY_CODES = INDUSTRIES.map((i) => i.code) as [string, ...string[]];
export const industry = (code?: string | null): Industry => INDUSTRIES.find((i) => i.code === code) ?? INDUSTRIES[0];

/** Создать услуги шаблона: сначала обычные, затем комплексы со ссылками на них */
export async function createTemplateServices(
  tx: { service: { create: (a: { data: any }) => Promise<{ id: string; name: string }> }; serviceResource: { createMany: (a: { data: any[]; skipDuplicates?: boolean }) => Promise<unknown> } },
  tenantId: string, templates: Tpl[], resourceIds: string[],
) {
  const byName = new Map<string, string>();
  const created: { id: string; name: string }[] = [];
  const ordered = [...templates.filter((t) => !t.combo), ...templates.filter((t) => t.combo)];
  for (const [i, { combo, ...t }] of ordered.entries()) {
    const comboOf = (combo ?? []).map((n) => byName.get(n)).filter((x): x is string => !!x);
    const s = await tx.service.create({ data: { ...t, tenantId, sortOrder: i, ...(comboOf.length >= 2 ? { comboOf } : {}) } });
    byName.set(s.name, s.id);
    created.push(s);
    if (resourceIds.length) await tx.serviceResource.createMany({ data: resourceIds.map((resourceId) => ({ tenantId, serviceId: s.id, resourceId })), skipDuplicates: true });
  }
  return created;
}
