import { env } from '../config';

export type SmsResult = { ok: boolean; error?: string; id?: string };

/** SMS через sms.ru. Транспорт подменяется в тестах. */
export const sms = {
  get enabled() {
    return !!env.SMS_RU_API_KEY;
  },

  transport: async (phone: string, text: string): Promise<SmsResult> => {
    if (!env.SMS_RU_API_KEY) return { ok: false, error: 'sms disabled' };
    const to = phone.replace(/\D/g, '');
    const q = new URLSearchParams({ api_id: env.SMS_RU_API_KEY, to, msg: text, json: '1' });
    if (env.SMS_SENDER) q.set('from', env.SMS_SENDER);
    try {
      const res = await fetch(`https://sms.ru/sms/send?${q}`, { signal: AbortSignal.timeout(10_000) });
      const json = (await res.json()) as { status?: string; status_text?: string; sms?: Record<string, { status: string; status_text?: string; sms_id?: string }> };
      const one = json.sms?.[to];
      if (json.status === 'OK' && one?.status === 'OK') return { ok: true, id: one.sms_id };
      return { ok: false, error: one?.status_text ?? json.status_text ?? 'sms.ru error' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  send(phone: string, text: string) {
    return this.transport(phone, text);
  },
};
