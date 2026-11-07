export type Role = 'OWNER' | 'MANAGER' | 'ADMIN' | 'MASTER';
export type BookingStatus = 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type Week = Partial<Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', [string, string][]>>;

export type Me = {
  user: { id: string; email: string; name: string };
  telegramLinked: boolean;
  role: Role;
  resourceId: string | null;
  tenant: { id: string; name: string; slug: string; timezone: string };
  tenants: { id: string; name: string; slug: string; role: Role }[];
};
export type Resource = { id: string; name: string; phone: string | null; position: string | null; color: string; schedule: Week; isActive: boolean; serviceIds: string[] };
export type Service = { id: string; name: string; description: string | null; price: number; duration: number; bufferTime: number; isActive: boolean; isPublic: boolean; categoryId: string | null; resourceIds: string[] };
export type Customer = {
  id: string; name: string; phone: string; email: string | null; notes: string | null; tags: string[];
  totalVisits: number; totalSpent: number; lastVisitAt: string | null; marketingConsent: boolean; telegramChatId: string | null;
};
export type Booking = {
  id: string; startsAt: string; endsAt: string; status: BookingStatus; source: string; price: number; notes: string | null; version: number;
  resourceId: string; customerId: string;
  items: { id: string; serviceId: string; name: string; price: number; duration: number }[];
  customer: { id: string; name: string; phone: string; notes: string | null; totalVisits: number };
  resource: { id: string; name: string; color: string };
  reminders?: { id: string; type: 'BEFORE_24H' | 'BEFORE_2H' | 'AFTER_VISIT'; status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'; channel: 'TELEGRAM' | 'SMS'; scheduledAt: string; sentAt: string | null }[];
};
export type Tenant = {
  id: string; name: string; slug: string; phone: string | null; address: string | null; timezone: string;
  settings: { slotStepMin: number; minLeadMin: number; maxDaysAhead: number; cancelBeforeHours: number; onlineBookingEnabled: boolean; remindersEnabled: boolean; legalName?: string; inn?: string };
};
export type Plan = { id: string; code: string; name: string; priceMonthly: number; priceYearly: number; limits: { masters?: number; smsPerMonth?: number } };
export type Subscription = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED'; daysLeft: number | null; until: string | null;
  trialEndsAt: string | null; currentPeriodEnd: string | null; billingPeriod: 'MONTHLY' | 'YEARLY'; plan: Plan; paymentsEnabled: boolean;
};
export type Payment = { id: string; amount: number; status: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | 'REFUNDED'; billingPeriod: 'MONTHLY' | 'YEARLY'; paidAt: string | null; createdAt: string };
export type Paged<T> = T[];
