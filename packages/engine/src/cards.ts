/** 花色：梅花 / 方块 / 红桃 / 黑桃 */
export type Suit = 'C' | 'D' | 'H' | 'S';
/** 叫牌花色（将牌）：四门 + 无主 */
export type Strain = Suit | 'NT';
/** 座位号 0/1/2，按座位号递增出牌（界面上逆时针：下家在右手边） */
export type Seat = 0 | 1 | 2;
export type JokerColor = 'small' | 'big';
/** 牌面点数：2..14，J=11 Q=12 K=13 A=14 */
export type Rank = number;

export type Card = { readonly suit: Suit; readonly rank: Rank } | { readonly joker: JokerColor };

export const SUITS: readonly Suit[] = ['C', 'D', 'H', 'S'];
export const STRAINS: readonly Strain[] = ['C', 'D', 'H', 'S', 'NT'];
export const SEATS: readonly Seat[] = [0, 1, 2];
export const RANK_MIN = 2;
export const RANK_MAX = 14;

export const SUIT_LABEL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };
export const STRAIN_LABEL: Record<Strain, string> = {
  C: '梅花',
  D: '方块',
  H: '红桃',
  S: '黑桃',
  NT: '无主'
};
export const RANK_LABEL: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A'
};

export function rankLabel(rank: Rank): string {
  return RANK_LABEL[rank] ?? String(rank);
}

export function isJoker(c: Card): c is { readonly joker: JokerColor } {
  return (c as { joker?: JokerColor }).joker !== undefined;
}

export function cardKey(c: Card): string {
  return isJoker(c) ? (c.joker === 'small' ? 'j0' : 'j1') : `${c.suit}${c.rank}`;
}

export function cardLabel(c: Card): string {
  if (isJoker(c)) return c.joker === 'small' ? '小王' : '大王';
  return `${SUIT_LABEL[c.suit]}${rankLabel(c.rank)}`;
}

/** 分牌：5=5，10=10，K=10；其余 0（与是否为主牌无关，按牌面计） */
export function cardPoints(c: Card): number {
  if (isJoker(c)) return 0;
  if (c.rank === 5) return 5;
  if (c.rank === 10 || c.rank === 13) return 10;
  return 0;
}

export function cardsPoints(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0);
}

export function containsCard(haystack: readonly Card[], needle: Card): boolean {
  const key = cardKey(needle);
  return haystack.some((c) => cardKey(c) === key);
}

/** 从手牌移除给定牌（多重集合语义）；缺牌返回 null */
export function removeCards(hand: readonly Card[], cards: readonly Card[]): Card[] | null {
  const quota = new Map<string, number>();
  for (const c of cards) {
    const k = cardKey(c);
    quota.set(k, (quota.get(k) ?? 0) + 1);
  }
  const have = new Map<string, number>();
  for (const c of hand) {
    const k = cardKey(c);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  for (const [k, n] of quota) {
    if ((have.get(k) ?? 0) < n) return null;
  }
  const out: Card[] = [];
  for (const c of hand) {
    const k = cardKey(c);
    const left = quota.get(k) ?? 0;
    if (left > 0) {
      quota.set(k, left - 1);
      continue;
    }
    out.push(c);
  }
  return out;
}

export function fullDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank++) cards.push({ suit, rank });
  }
  cards.push({ joker: 'small' }, { joker: 'big' });
  return cards;
}

export type RNG = () => number;

/** Fisher–Yates，RNG 注入以便测试复现 */
export function shuffled<T>(items: readonly T[], rng: RNG): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
