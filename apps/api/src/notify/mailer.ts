import * as nodemailer from 'nodemailer';
import { env, isProd } from '../config';

export type Mail = { to: string; subject: string; text: string };

let transporter: nodemailer.Transporter | null = null;

/** Отправка писем. Без SMTP_URL письмо пишется в лог (удобно в разработке). Транспорт подменяется в тестах. */
export const mailer = {
  transport: async (m: Mail): Promise<boolean> => {
    if (!env.SMTP_URL) {
      if (!isProd) console.log(`[mail] → ${m.to}: ${m.subject}\n${m.text}`);
      return false;
    }
    transporter ??= nodemailer.createTransport(env.SMTP_URL);
    try {
      await transporter.sendMail({ from: env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text });
      return true;
    } catch (e) {
      console.error('[mail] error', (e as Error).message);
      return false;
    }
  },
  send(m: Mail) {
    return this.transport(m);
  },
};
