import { createGameServer } from './app.js';

const server = createGameServer({
  dataDir: process.env.DATA_DIR || './data',
  publicOrigin: process.env.PUBLIC_ORIGIN || '',
  maxRooms: Number(process.env.MAX_ROOMS) || 200,
});
const port = Number(process.env.PORT) || 3000;
server.http.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`SCOUT server listening on port ${port}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
