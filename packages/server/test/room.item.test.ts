import { describe, expect, it } from 'vitest';
import { Room } from '../src/room';

describe('Room.itemAction', () => {
  it('is refused outside play and for strangers', () => {
    const room = new Room('TEST', 1);
    room.join('p1', 'A');
    expect(room.itemAction('p1', { action: 'pickup', itemId: 'coil_ok' })).toEqual({ ok: false, error: 'No stage is running.' });
    room.start('p1');
    for (let i = 0; i < 5; i++) room.tick();
    expect(room.phase).toBe('playing');
    expect(room.itemAction('stranger', { action: 'pickup', itemId: 'coil_ok' })).toEqual({ ok: false, error: 'You are not part of this run.' });
    expect(room.itemAction('p1', { action: 'pickup', itemId: 'coil_ok' })).toEqual({ ok: false, error: 'There is nothing to carry in this stage.' });
  });
});
