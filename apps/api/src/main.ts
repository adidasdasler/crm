import 'reflect-metadata';
import { createApp } from './bootstrap';
import { env } from './config';

createApp().then(async (app) => {
  await app.listen(env.PORT, '0.0.0.0');
  console.log(`Salon API: http://localhost:${env.PORT}/v1`);
});
