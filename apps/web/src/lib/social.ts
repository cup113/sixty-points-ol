/**
 * 桌边消息的**纯函数那一半**：表情目录、短句校验、暂离档位与剩余时间文案。
 *
 * 三种消息（表情 / 短句 / 暂离）共用**一个**座位气泡（见 ADR-0028）：
 * 服务端只存「最近一条」，浏览器不建历史、不建未读，也没有第二个展示面。
 * 所以这里没有任何 store / 时间戳：服务端算「还剩多久」，组件拿它本地倒数。
 */

/** 表情是**固定目录**，不是自由输入的 emoji：键写进数据库，字形只活在客户端 */
export const EMOTES = [
  { key: 'nice', glyph: '👍', label: '好' },
  { key: 'clap', glyph: '👏', label: '鼓掌' },
  { key: 'laugh', glyph: '😂', label: '笑' },
  { key: 'wow', glyph: '😮', label: '惊讶' },
  { key: 'think', glyph: '🤔', label: '想一想' },
  { key: 'tired', glyph: '😴', label: '困了' },
  { key: 'thanks', glyph: '🙏', label: '谢谢' },
  { key: 'party', glyph: '🎉', label: '庆祝' }
] as const;

export type Emote = (typeof EMOTES)[number];
export type EmoteKey = Emote['key'];

const EMOTE_BY_KEY = new Map<string, Emote>(EMOTES.map((emote) => [emote.key, emote]));

export function isEmoteKey(value: unknown): value is EmoteKey {
  return typeof value === 'string' && EMOTE_BY_KEY.has(value);
}

/** 键盘/数据库里的键 → 那一颗字形；未知键返回一个中性占位，界面不因脏数据空掉 */
export function emoteGlyph(key: string | null): string {
  return key === null ? '·' : (EMOTE_BY_KEY.get(key)?.glyph ?? '·');
}

export function emoteLabel(key: string | null): string {
  return key === null ? '表情' : (EMOTE_BY_KEY.get(key)?.label ?? '表情');
}

/** 一条消息最多几个字（按码点算，CJK 与 emoji 都算一个） */
export const MAX_MESSAGE_LENGTH = 24;

/** 表情与短句各自活多久；暂离的寿命就是所选的那一档 */
export const EMOTE_TTL_MS = 6_000;
export const TEXT_TTL_MS = 10_000;

/** 两条消息之间至少隔这么久（服务端判；客户端不预判，失败时那条错误自己会说） */
export const ANNOUNCEMENT_RATE_LIMIT_MS = 2_000;

/** 暂离档位：比第一版的 5/15/30 多三档，选时间不用靠猜 */
export const AWAY_MINUTES = [5, 10, 15, 30, 45, 60] as const;

export type AwayMinutes = (typeof AWAY_MINUTES)[number];

export function isAwayMinutes(value: unknown): value is AwayMinutes {
  return typeof value === 'number' && Number.isInteger(value) && (AWAY_MINUTES as readonly number[]).includes(value);
}

export type AnnouncementKind = 'emote' | 'text' | 'away';

export type SocialPost =
  | { readonly kind: 'emote'; readonly key: EmoteKey }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'away'; readonly minutes: AwayMinutes };

export type ParsedSocial = { readonly ok: true; readonly post: SocialPost } | { readonly ok: false; readonly error: string };

/**
 * 把一条消息收成**一行**纯文本。
 *
 * 去掉控制字符与零宽/双向覆盖字符（它们能让一条消息在界面上「看起来是空的」或改写相邻文本），
 * 再把连续空白压成一个空格：气泡里没有段落，换行只会让高度不可控。
 */
export function normalizeMessage(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 返回 null = 可以发；否则是给用户看的那一句原因 */
export function messageProblem(raw: string): string | null {
  const text = normalizeMessage(raw);
  const length = [...text].length;
  if (length === 0) return '写一句再发';
  if (length > MAX_MESSAGE_LENGTH) return `最多 ${MAX_MESSAGE_LENGTH} 个字`;
  return null;
}

/** 来自客户端的原始 JSON → 类型化的消息；错误文案直接可上屏 */
export function parseSocialPost(value: unknown): ParsedSocial {
  if (typeof value !== 'object' || value === null) return { ok: false, error: '消息格式不正确' };
  const raw = value as { kind?: unknown; key?: unknown; text?: unknown; minutes?: unknown };

  if (raw.kind === 'emote') {
    if (!isEmoteKey(raw.key)) return { ok: false, error: '不认识这个表情' };
    return { ok: true, post: { kind: 'emote', key: raw.key } };
  }
  if (raw.kind === 'text') {
    if (typeof raw.text !== 'string') return { ok: false, error: '消息格式不正确' };
    const problem = messageProblem(raw.text);
    if (problem !== null) return { ok: false, error: problem };
    return { ok: true, post: { kind: 'text', text: normalizeMessage(raw.text) } };
  }
  if (raw.kind === 'away') {
    if (!isAwayMinutes(raw.minutes)) return { ok: false, error: '暂离时长不在档位里' };
    return { ok: true, post: { kind: 'away', minutes: raw.minutes } };
  }
  return { ok: false, error: '消息格式不正确' };
}

/** 暂离气泡的第二行：「还剩 14 分」（到点返回 null，组件据此隐藏） */
export function awayRemainingText(remainingMs: number): string | null {
  if (!(remainingMs > 0)) return null;
  return `还剩 ${Math.max(1, Math.ceil(remainingMs / 60_000))} 分`;
}
