import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Single-process durable store. Write to a sibling file, then atomically replace. */
export class RoomStore {
  constructor(directory) {
    this.rooms = new Map();
    this.directory = directory ? resolve(directory) : null;
    if (!this.directory) return;
    mkdirSync(this.directory, { recursive: true });
    this.file = join(this.directory, 'rooms.json');
    if (!existsSync(this.file)) return;
    const data = JSON.parse(readFileSync(this.file, 'utf8'));
    if (data.schema !== 1 || !Array.isArray(data.rooms)) throw new Error('Unsupported room store. Restore a backup before starting.');
    this.rooms = new Map(data.rooms.map(r => [r.code, r]));
  }
  persist(next) {
    if (this.directory) {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ schema: 1, rooms: [...next.values()] }), { mode: 0o600, flush: true });
      renameSync(`${this.file}.tmp`, this.file);
    }
    this.rooms = next;
  }
  set(room) {
    const next = new Map(this.rooms);
    next.set(room.code, room);
    this.persist(next);
  }
  delete(code) {
    const next = new Map(this.rooms);
    next.delete(code);
    this.persist(next);
  }
}
