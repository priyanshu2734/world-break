import { CHAT_LIMITS, checkChat, type ChatMessage } from '@wb/shared';

export type ChatResult = { ok: true; message: string } | { ok: false; error: string };
export interface ChatSender { id: string; name: string; slot: number; dead: boolean; connected: boolean }

/**
 * P6 A: team chat of one room. Nothing is stored: a message is cleaned, rate limited, queued for the gateway to send and forgotten. Only each
 * sender's last send time is kept (to rate limit), and `clear()` drops even that when the room ends.
 * Decision (docs/PING.md): a dead player MAY chat, at half the rate. What they know is the ghosts and their teammates (their stage state is blank), so they
 * hold no code, safe or solution to leak; what they could relay (where a ghost is) is what "ghost here" already tells the team.
 */
export class ChatBoard {
  private last = new Map<string, number>();
  private nextId = 1;
  private out: ChatMessage[] = [];

  send(s: ChatSender, raw: string, nowMs: number): ChatResult {
    if (!s.connected) return { ok: false, error: 'You are not connected.' };
    const c = checkChat(raw);
    if (!c.ok) return c;
    const gap = s.dead ? CHAT_LIMITS.spectatorGapMs : CHAT_LIMITS.gapMs;
    const last = this.last.get(s.id);
    if (last !== undefined && nowMs >= last && nowMs - last < gap) return { ok: false, error: 'Slow down.' };
    this.last.set(s.id, nowMs);
    this.out.push({ id: this.nextId++, from: s.id, name: s.name, slot: s.slot, text: c.text, spectator: s.dead });
    if (this.out.length > 32) this.out.splice(0, this.out.length - 32);
    return { ok: true, message: 'Sent.' };
  }
  drain(): ChatMessage[] { const o = this.out; this.out = []; return o; }
  clear(): void { this.last.clear(); this.out = []; }
}
