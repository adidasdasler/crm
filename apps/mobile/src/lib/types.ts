export type Role = 'OWNER' | 'MANAGER' | 'ADMIN' | 'MASTER';
export type BookingStatus = 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type Week = Partial<Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', [string, string][]>>;

export type Perm =
  | 'bookings.all' | 'customers.view' | 'customers.contacts' | 'customers.export' | 'catalog.manage'
  | 'staff.manage' | 'stock.manage' | 'finance.manage' | 'team.manage' | 'settings.manage' | 'analytics.view';

export type Me = {
  user: { id: string; email: string; name: string };
  telegramLinked: boolean;
  role: Role;
  resourceId: string | null;
  permissions: Perm[];
  tenant: { id: string; name: string; slug: string; timezone: string };
  tenants: { id: string; name: string; slug: string; role: Role }[];
  industry?: { code: string; label: string; terms: Terms };
};
export type Resource = { id: string; name: string; phone: string | null; position: string | null; color: string; schedule: Week; isActive: boolean; serviceIds: string[] };
export type Service = { id: string; name: string; description: string | null; price: number; duration: number; bufferTime: number; isActive: boolean; isPublic: boolean; categoryId: string | null; resourceIds: string[]; comboOf?: string[] };
export type Customer = {
  id: string; name: string; phone: string; email: string | null; notes: string | null; tags: string[];
  totalVisits: number; totalSpent: number; lastVisitAt: string | null; marketingConsent: boolean; telegramChatId: string | null; maxUserId?: string | null; vkUserId?: string | null;
};
export type Booking = {
  id: string; startsAt: string; endsAt: string; status: BookingStatus; source: string; price: number; notes: string | null; version: number;
  resourceId: string; customerId: string;
  items: { id: string; serviceId: string; name: string; price: number; duration: number }[];
  customer: { id: string; name: string; phone: string; notes: string | null; totalVisits: number };
  resource: { id: string; name: string; color: string };
  reminders?: { id: string; type: 'BEFORE_24H' | 'BEFORE_2H' | 'AFTER_VISIT'; status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'; channel: 'TELEGRAM' | 'MAX' | 'VK' | 'EMAIL' | 'SMS'; scheduledAt: string; sentAt: string | null }[];
  review?: { rating: number; comment: string | null; source: string; createdAt: string } | null;
  settlement?: { pass: { name: string; kind: string; visitsLeft: number | null; expiresAt: string } | null; fromBalance: number };
};
export type Tenant = {
  id: string; name: string; slug: string; phone: string | null; address: string | null; timezone: string;
  settings: { slotStepMin: number; minLeadMin: number; maxDaysAhead: number; cancelBeforeHours: number; onlineBookingEnabled: boolean; remindersEnabled: boolean; legalName?: string; inn?: string;
    industry: string; about?: string; links?: Partial<Record<LinkKey, string>>; feedbackEnabled: boolean; insightsDigest: boolean; depositTiers: { amount: number; bonus: number }[]; depositAutoCharge: boolean;
  };
  industry?: { code: string; label: string; terms: Terms };
};
export type LinkKey = 'site' | 'vk' | 'telegram' | 'max' | 'instagram' | 'whatsapp' | 'yandexMaps' | 'twoGis';
export type Terms = { staff: string; staffPlural: string; client: string; clientPlural: string; place: string };
export type IndustryInfo = { code: string; label: string; group: string; terms: Terms };
export type Plan = { id: string; code: string; name: string; priceMonthly: number; priceYearly: number; limits: { masters?: number } };
export type Subscription = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED'; daysLeft: number | null; until: string | null;
  trialEndsAt: string | null; currentPeriodEnd: string | null; billingPeriod: 'MONTHLY' | 'YEARLY'; plan: Plan; paymentsEnabled: boolean;
};
export type Payment = { id: string; amount: number; status: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | 'REFUNDED'; billingPeriod: 'MONTHLY' | 'YEARLY'; paidAt: string | null; createdAt: string };
export type Paged<T> = T[];

export type Analytics = {
  period: { from: string; to: string; days: number };
  totals: {
    revenue: number; booked: number; bookings: number; completed: number; cancelled: number; noShow: number; noShowRate: number;
    avgCheck: number; onlineShare: number; newCustomers: number; load: number; materialCost: number; rating: number | null; reviews: number; lowRatings: number; deposits: number; passSales: number; passCount: number;
  };
  previous: { booked: number; bookings: number };
  byDay: { date: string; revenue: number; bookings: number }[];
  sources: { key: string; label: string; count: number; amount: number }[];
  masters: { id: string; name: string; color: string; bookings: number; amount: number; bookedMin: number; capacityMin: number; load: number; rating: number | null; reviews: number }[];
  services: { name: string; count: number; amount: number }[];
};

export type Today = {
  date: string;
  load: {
    value: number; bookedMin: number; capacityMin: number; freeMin: number; dayOver: boolean;
    masters: { id: string; name: string; color: string; capacityMin: number; bookedMin: number; load: number; bookings: number; free: { from: string; to: string; minutes: number }[] }[];
  };
  revenue: {
    expected: number; done: number; bookings: number;
    list: { id: string; startsAt: string; price: number; status: BookingStatus; customer: string; services: string[]; master: string }[];
  };
  topMaster: {
    period: string;
    top: { id: string; name: string; color: string; amount: number; bookings: number; share: number; avgCheck: number } | null;
    ranking: { id: string; name: string; color: string; amount: number; bookings: number; share: number; avgCheck: number }[];
  };
};

export type Material = {
  id: string; name: string; unit: string; category: string | null; trackExpiry: boolean; isActive: boolean;
  stock: number; minStock: number; price: number; value: number; low: boolean; nearestExpiry?: string | null;
};
export type MaterialDetail = Material & {
  batches: { id: string; qty: number; remaining: number; price: number; expiresAt: string | null; receivedAt: string }[];
  movements: { id: string; type: string; label: string; qty: number; price: number; bookingId: string | null; note: string | null; createdAt: string }[];
  norms: { serviceId: string; service: string; qty: number }[];
};
export type StockAlerts = {
  low: { materialId: string; name: string; unit: string; stock: number; minStock: number }[];
  expiring: { batchId: string; materialId: string; name: string; unit: string; remaining: number; expiresAt: string; expired: boolean; daysLeft: number }[];
};

export type Insight = {
  code: string; level: 'warn' | 'tip' | 'good'; title: string; text: string;
  action?: { label: string; route: string };
  customers?: { id: string; name: string; lastVisitAt: string }[];
};

export type TimeRule = { days?: number[]; from?: string; to?: string } | null;
export type PassPlan = {
  id: string; name: string; description: string | null; kind: 'VISITS' | 'UNLIMITED'; visits: number | null; validityDays: number;
  price: number; serviceIds: string[]; timeRule: TimeRule; isPublic: boolean; isActive: boolean;
};
export type CustomerPass = {
  id: string; name: string; kind: 'VISITS' | 'UNLIMITED'; visitsTotal: number | null; visitsLeft: number | null; price: number;
  method: string | null; startsAt: string; expiresAt: string; status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED'; timeRule: TimeRule;
};
export type Account = {
  money: number; bonus: number; total: number; tiers: { amount: number; bonus: number }[];
  entries: { id: string; type: string; label: string; money: number; bonus: number; method: string | null; bookingId: string | null; note: string | null; createdAt: string }[];
  passes: CustomerPass[];
};
