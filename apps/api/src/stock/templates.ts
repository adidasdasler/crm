/**
 * Отраслевые наборы материалов с нормами расхода на типовые услуги (названия услуг — из шаблонов отраслей).
 * Количества — в обычных единицах. Это стартовые цифры: салон правит их под свои материалы.
 */
type Mat = { name: string; unit: string; minStock: number; trackExpiry?: boolean; category?: string; norms?: Record<string, number> };

export const STOCK_TEMPLATES: Record<string, Mat[]> = {
  nails: [
    { name: 'Гель-лак', unit: 'мл', minStock: 30, trackExpiry: true, category: 'Покрытия', norms: { 'Маникюр с покрытием гель-лак': 0.5, 'Педикюр с покрытием': 0.5 } },
    { name: 'База', unit: 'мл', minStock: 30, trackExpiry: true, category: 'Покрытия', norms: { 'Маникюр с покрытием гель-лак': 0.4, 'Педикюр с покрытием': 0.4 } },
    { name: 'Топ', unit: 'мл', minStock: 30, trackExpiry: true, category: 'Покрытия', norms: { 'Маникюр с покрытием гель-лак': 0.3, 'Педикюр с покрытием': 0.3 } },
    { name: 'Обезжириватель', unit: 'мл', minStock: 200, category: 'Расходники', norms: { 'Маникюр с покрытием гель-лак': 3, 'Педикюр с покрытием': 3 } },
    { name: 'Пилки одноразовые', unit: 'шт', minStock: 50, category: 'Расходники', norms: { 'Маникюр без покрытия': 1, 'Маникюр с покрытием гель-лак': 1, 'Педикюр с покрытием': 1 } },
    { name: 'Перчатки нитриловые', unit: 'пар', minStock: 50, category: 'Гигиена', norms: { 'Маникюр без покрытия': 1, 'Маникюр с покрытием гель-лак': 1, 'Педикюр с покрытием': 1 } },
    { name: 'Средство для снятия гель-лака', unit: 'мл', minStock: 200, category: 'Расходники', norms: { 'Снятие покрытия': 5 } },
  ],
  barber: [
    { name: 'Лезвия', unit: 'шт', minStock: 50, category: 'Бритьё', norms: { 'Стрижка бороды': 1 } },
    { name: 'Гель для бритья', unit: 'мл', minStock: 300, trackExpiry: true, category: 'Бритьё', norms: { 'Стрижка бороды': 10 } },
    { name: 'Воротнички бумажные', unit: 'шт', minStock: 100, category: 'Гигиена', norms: { 'Мужская стрижка': 1, 'Стрижка бороды': 1 } },
    { name: 'Средство для укладки', unit: 'г', minStock: 200, trackExpiry: true, category: 'Укладка', norms: { 'Мужская стрижка': 2 } },
    { name: 'Масло для бороды', unit: 'мл', minStock: 100, trackExpiry: true, category: 'Уход', norms: { 'Стрижка бороды': 1 } },
  ],
  hair: [
    { name: 'Краска для волос', unit: 'г', minStock: 300, trackExpiry: true, category: 'Окрашивание', norms: { 'Окрашивание в один тон': 60 } },
    { name: 'Оксидант', unit: 'мл', minStock: 500, trackExpiry: true, category: 'Окрашивание', norms: { 'Окрашивание в один тон': 90 } },
    { name: 'Шампунь профессиональный', unit: 'мл', minStock: 1000, trackExpiry: true, category: 'Уход', norms: { 'Женская стрижка': 15, 'Окрашивание в один тон': 20 } },
    { name: 'Средство для укладки', unit: 'мл', minStock: 300, trackExpiry: true, category: 'Укладка', norms: { 'Укладка': 10 } },
  ],
  brows: [
    { name: 'Краска для бровей', unit: 'мл', minStock: 20, trackExpiry: true, category: 'Окрашивание', norms: { 'Окрашивание бровей': 1 } },
    { name: 'Состав для ламинирования (саше)', unit: 'шт', minStock: 10, trackExpiry: true, category: 'Ламинирование', norms: { 'Ламинирование ресниц': 1 } },
    { name: 'Ресницы для наращивания (лента)', unit: 'шт', minStock: 10, category: 'Наращивание', norms: { 'Наращивание ресниц': 1 } },
    { name: 'Клей для ресниц', unit: 'мл', minStock: 5, trackExpiry: true, category: 'Наращивание', norms: { 'Наращивание ресниц': 0.3 } },
  ],
  cosmetology: [
    { name: 'Маска альгинатная', unit: 'г', minStock: 200, trackExpiry: true, category: 'Уход', norms: { 'Уходовая процедура': 25, 'Чистка лица': 25 } },
    { name: 'Пилинг', unit: 'мл', minStock: 50, trackExpiry: true, category: 'Пилинги', norms: { 'Пилинг': 3 } },
    { name: 'Салфетки одноразовые', unit: 'шт', minStock: 100, category: 'Гигиена', norms: { 'Чистка лица': 4, 'Уходовая процедура': 2, 'Пилинг': 2 } },
  ],
  massage: [
    { name: 'Массажное масло', unit: 'мл', minStock: 500, trackExpiry: true, category: 'Масла', norms: { 'Классический массаж спины': 15, 'Общий массаж': 30 } },
    { name: 'Простыни одноразовые', unit: 'шт', minStock: 50, category: 'Гигиена', norms: { 'Классический массаж спины': 1, 'Общий массаж': 1, 'СПА-программа': 1 } },
  ],
  beauty: [
    { name: 'Гель-лак', unit: 'мл', minStock: 30, trackExpiry: true, category: 'Маникюр', norms: { 'Маникюр с покрытием': 0.5 } },
    { name: 'Перчатки нитриловые', unit: 'пар', minStock: 50, category: 'Гигиена', norms: { 'Маникюр с покрытием': 1, 'Женская стрижка': 1 } },
    { name: 'Шампунь профессиональный', unit: 'мл', minStock: 1000, trackExpiry: true, category: 'Волосы', norms: { 'Женская стрижка': 15 } },
  ],
  pets: [
    { name: 'Шампунь для животных', unit: 'мл', minStock: 1000, trackExpiry: true, category: 'Уход', norms: { 'Комплексный груминг (малые породы)': 40, 'Гигиеническая стрижка': 20 } },
    { name: 'Лезвия для машинки', unit: 'шт', minStock: 3, category: 'Инструмент' },
  ],
  tattoo: [
    { name: 'Иглы-картриджи', unit: 'шт', minStock: 50, trackExpiry: true, category: 'Расходники', norms: { 'Тату — сеанс': 3 } },
    { name: 'Пигменты', unit: 'мл', minStock: 50, trackExpiry: true, category: 'Пигменты', norms: { 'Тату — сеанс': 2 } },
    { name: 'Плёнка заживляющая', unit: 'шт', minStock: 20, category: 'Уход', norms: { 'Тату — сеанс': 1 } },
  ],
  auto: [
    { name: 'Моторное масло', unit: 'л', minStock: 20, category: 'Масла', norms: { 'Замена масла': 4.5 } },
    { name: 'Автошампунь', unit: 'мл', minStock: 2000, category: 'Мойка', norms: { 'Комплексная мойка': 100 } },
  ],
};
