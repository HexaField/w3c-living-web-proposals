import { createRelay } from './server.js';

const port = parseInt(process.env.PORT ?? '4000', 10);
const host = process.env.HOST ?? '0.0.0.0';

createRelay({ port, host });
