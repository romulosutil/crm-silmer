import { createApi } from './app.js';

const api = createApi({ logger: true });
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await api.listen({ host, port });
} catch (error) {
  api.log.error(error);
  process.exitCode = 1;
}
