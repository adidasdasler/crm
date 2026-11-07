import { randomUUID } from 'node:crypto';
import { env, paymentProvider } from '../config';

export type ProviderPayment = { status: 'pending' | 'succeeded' | 'canceled'; paidAt?: Date };

export interface PaymentProvider {
  name: 'yookassa' | 'mock';
  create(p: { paymentId: string; amount: number; description: string; returnUrl: string; metadata: Record<string, string> }): Promise<{ externalId: string; confirmationUrl: string }>;
  get(externalId: string): Promise<ProviderPayment>;
}

const rubles = (kop: number) => (kop / 100).toFixed(2);

/**
 * ЮKassa API v3: https://yookassa.ru/developers/api
 * Для самозанятых чек в «Мой налог» формирует сама ЮKassa — при подключении магазина
 * проверьте в личном кабинете, что включена передача чеков для НПД.
 */
const yookassa: PaymentProvider = {
  name: 'yookassa',
  async create(p) {
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': p.paymentId,
        Authorization: 'Basic ' + Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString('base64'),
      },
      body: JSON.stringify({
        amount: { value: rubles(p.amount), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: p.returnUrl },
        description: p.description.slice(0, 128),
        metadata: p.metadata,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { id?: string; confirmation?: { confirmation_url?: string }; description?: string };
    if (!res.ok || !json.id || !json.confirmation?.confirmation_url) {
      throw new Error(`ЮKassa: ${json.description ?? res.status}`);
    }
    return { externalId: json.id, confirmationUrl: json.confirmation.confirmation_url };
  },
  async get(externalId) {
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(externalId)}`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString('base64') },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { status?: string; captured_at?: string };
    if (!res.ok) throw new Error(`ЮKassa: HTTP ${res.status}`);
    return {
      status: json.status === 'succeeded' ? 'succeeded' : json.status === 'canceled' ? 'canceled' : 'pending',
      paidAt: json.captured_at ? new Date(json.captured_at) : undefined,
    };
  },
};

/** Тестовые платежи для разработки: страница «оплаты» на сайте, без денег. */
const mock: PaymentProvider = {
  name: 'mock',
  async create(p) {
    return { externalId: `mock_${randomUUID()}`, confirmationUrl: `${env.PUBLIC_WEB_URL}/pay/mock/${p.paymentId}` };
  },
  async get() {
    return { status: 'pending' };
  },
};

export function getProvider(): PaymentProvider | null {
  if (paymentProvider === 'yookassa') return env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY ? yookassa : null;
  if (paymentProvider === 'mock') return mock;
  return null;
}

/** IP-адреса, с которых ЮKassa отправляет уведомления (проверьте актуальность в документации). */
const YOOKASSA_NETS = ['185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25', '77.75.156.11/32', '77.75.156.35/32', '77.75.154.128/25'];
export function isYookassaIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, '');
  const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return ip.startsWith('2a02:5180:');
  return YOOKASSA_NETS.some((net) => {
    const [base, bits] = net.split('/');
    const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (toInt(v4) & mask) === (toInt(base) & mask);
  });
}
