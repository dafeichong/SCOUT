// Local UI verification helper: joins one seat and confirms orientation only.
// Usage: node test/manual-peer.js ROOMCODE [http://localhost:3000] [nickname]
// It never plays cards. Stop with Ctrl+C after the UI check.
import { io } from 'socket.io-client';
const [code, url = 'http://localhost:3000', name = '测试座位'] = process.argv.slice(2);
if (!code) throw new Error('Provide a room code for your local test room.');
const response = await fetch(`${url}/api/session`);
if (!response.ok) throw new Error(`Session failed: ${response.status}`);
const cookie = response.headers.get('set-cookie').split(';')[0];
const socket = io(url, { extraHeaders: { Cookie: cookie }, reconnection: false });
let room;
let busy = false;
socket.on('room:state', value => { room = value; });
socket.on('connect', async () => {
  const result = await socket.timeout(3000).emitWithAck('room:command', { type: 'join', payload: { name, code } });
  console.log(result.ok ? 'Test peer joined.' : result.error);
  if (!result.ok) process.exit(1);
});
socket.on('connect_error', e => { console.error(e.message); process.exit(1); });
const timer = setInterval(async () => {
  if (!room || busy || room.phase !== 'orient' || room.players.find(p => p.id === room.you)?.ready) return;
  busy = true;
  try { await socket.timeout(3000).emitWithAck('room:command', { type: 'ready', payload: {}, version: room.version }); }
  finally { busy = false; }
}, 500);
process.on('SIGINT', () => { clearInterval(timer); socket.disconnect(); process.exit(0); });
