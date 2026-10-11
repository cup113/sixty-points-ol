/**
 * 引导数据的校验：**结构 + 语义**，两层分开，脚本与单测共用这一份。
 *
 * - `parseGuideDeal`：JSON 形状校验（字段齐不齐、类型对不对、牌键认不认得），
 *   挡住「手改 JSON 打错字」这一类；
 * - `validateGuideDeal`：语义校验 —— 用引擎把整副重放一遍（每一步必须合法、不许全 pass 重发）、
 *   烘焙事实与现场重放逐项核对、**用户座位的每个动作都必须有引导词**。
 *
 * 报错一律**收集完再返回**（不碰第一个错就停）：一次跑出全部问题，作者一轮就能改完。
 */
import { SEATS, type Seat } from '@sixty/engine';
import { replayGuide, isCardKey } from './replay.ts';
import type { GuideAction, GuideDealData, GuideWord } from './types.ts';

export interface GuideProblem {
  /** 出错的位置：`actions[12]` / `facts.hands[1]` / `guides`… */
  readonly where: string;
  readonly message: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1 || value === 2;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 形状校验：认不出来就返回 problems，认得出就交回一份 `GuideDealData` */
export function parseGuideDeal(
  raw: unknown,
  expectedSlug?: string
): { readonly ok: true; readonly deal: GuideDealData } | { readonly ok: false; readonly problems: readonly GuideProblem[] } {
  const problems: GuideProblem[] = [];
  const bad = (where: string, message: string): void => {
    problems.push({ where, message });
  };
  if (!isRecord(raw)) {
    return { ok: false, problems: [{ where: '根', message: '不是一个 JSON 对象' }] };
  }

  if (raw['version'] !== 1) bad('version', `版本必须是 1，现在是 ${String(raw['version'])}`);
  if (!isNonEmptyString(raw['slug']) || !SLUG.test(raw['slug'])) {
    bad('slug', 'slug 只能是小写字母、数字与连字符');
  } else if (expectedSlug !== undefined && raw['slug'] !== expectedSlug) {
    bad('slug', `slug（${raw['slug']}）与文件名（${expectedSlug}）不一致`);
  }
  if (!isNonEmptyString(raw['title'])) bad('title', '缺标题');
  if (raw['role'] !== 'declarer' && raw['role'] !== 'defender') bad('role', 'role 只能是 declarer / defender');
  if (!isSeat(raw['learnerSeat'])) bad('learnerSeat', 'learnerSeat 只能是 0 / 1 / 2');

  const aliases = raw['aliases'];
  if (!Array.isArray(aliases) || aliases.length !== 3 || !aliases.every(isNonEmptyString)) {
    bad('aliases', 'aliases 必须是三个非空代称');
  } else if (isSeat(raw['learnerSeat']) && aliases[raw['learnerSeat']] !== '你') {
    bad('aliases', '用户所在那一席的代称必须是「你」');
  }

  const source = raw['source'];
  if (!isRecord(source)) {
    bad('source', '缺 source');
  } else {
    if (!isNonEmptyString(source['table'])) bad('source.table', '缺桌码');
    if (typeof source['dealNo'] !== 'number' || !Number.isInteger(source['dealNo']) || source['dealNo'] < 1) {
      bad('source.dealNo', '副号必须是正整数');
    }
    if (!isNonEmptyString(source['date']) || !DATE.test(source['date'])) bad('source.date', '日期必须是 YYYY-MM-DD');
  }

  // 事实块
  const facts = raw['facts'];
  if (!isRecord(facts)) {
    bad('facts', '缺 facts');
  } else {
    const hands = facts['hands'];
    if (!Array.isArray(hands) || hands.length !== 3) {
      bad('facts.hands', '必须是三手牌');
    } else {
      hands.forEach((hand, seat) => {
        if (!Array.isArray(hand) || hand.length !== 17) bad(`facts.hands[${seat}]`, '每家必须 17 张');
        else {
          for (const key of hand as unknown[]) {
            if (!isNonEmptyString(key) || !isCardKey(key)) bad(`facts.hands[${seat}]`, `不存在的牌：${String(key)}`);
          }
        }
      });
    }
    const kitty = facts['originalKitty'];
    if (!Array.isArray(kitty) || kitty.length !== 3) {
      bad('facts.originalKitty', '底牌必须 3 张');
    } else {
      for (const key of kitty as unknown[]) {
        if (!isNonEmptyString(key) || !isCardKey(key)) bad('facts.originalKitty', `不存在的牌：${String(key)}`);
      }
    }
    if (!isSeat(facts['dealerSeat'])) bad('facts.dealerSeat', 'dealerSeat 只能是 0 / 1 / 2');
    const levels = facts['levels'];
    if (!Array.isArray(levels) || levels.length !== 3) {
      bad('facts.levels', '必须是三家级别');
    } else {
      levels.forEach((level, seat) => {
        if (!isRecord(level)) {
          bad(`facts.levels[${seat}]`, '级别形状不对');
          return;
        }
        const rank = level['rank'];
        if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 2 || rank > 14) {
          bad(`facts.levels[${seat}].rank`, '点数必须是 2..14');
        }
        const cycle = level['cycle'];
        if (typeof cycle !== 'number' || !Number.isInteger(cycle) || cycle < 0) {
          bad(`facts.levels[${seat}].cycle`, '轮数必须是非负整数');
        }
      });
    }
    if (typeof facts['dealNo'] !== 'number' || !Number.isInteger(facts['dealNo']) || facts['dealNo'] < 1) {
      bad('facts.dealNo', '副号必须是正整数');
    }
  }

  // 动作
  const actions = raw['actions'];
  if (!Array.isArray(actions) || actions.length === 0) {
    bad('actions', '动作序列不能为空');
  } else {
    actions.forEach((action, index) => {
      if (!isRecord(action)) {
        bad(`actions[${index}]`, '动作形状不对');
        return;
      }
      if (!isSeat(action['seat'])) bad(`actions[${index}].seat`, '座位不对');
      switch (action['type']) {
        case 'bid': {
          const call = action['call'];
          if (call === 'pass') break;
          if (!isRecord(call)) {
            bad(`actions[${index}].call`, '叫品形状不对');
            break;
          }
          const points = call['points'];
          const strain = call['strain'];
          if (typeof points !== 'number' || !Number.isInteger(points)) bad(`actions[${index}].call.points`, '分数必须是整数');
          if (strain !== 'C' && strain !== 'D' && strain !== 'H' && strain !== 'S' && strain !== 'NT') {
            bad(`actions[${index}].call.strain`, '花色必须是 C/D/H/S/NT');
          }
          break;
        }
        case 'bury':
        case 'play': {
          const cards = action['cards'];
          if (!Array.isArray(cards) || cards.length === 0 || !cards.every(isNonEmptyString)) {
            bad(`actions[${index}].cards`, '牌面必须是牌键数组');
            break;
          }
          for (const key of cards as string[]) {
            if (!isCardKey(key)) bad(`actions[${index}].cards`, `不存在的牌：${key}`);
          }
          break;
        }
        default:
          bad(`actions[${index}].type`, `未知动作类型：${String(action['type'])}`);
      }
    });
  }

  // 引导词与解说
  const guides = raw['guides'];
  if (!isRecord(guides)) {
    bad('guides', '缺 guides');
  } else {
    for (const [key, value] of Object.entries(guides)) {
      const at = Number(key);
      if (!Number.isInteger(at) || at < 0 || !Array.isArray(actions) || at >= actions.length) {
        bad(`guides.${key}`, '引导词挂在了一个不存在的动作上');
        continue;
      }
      if (!isRecord(value) || !isNonEmptyString(value['text'])) {
        bad(`guides.${key}`, '引导词缺正文');
      } else if (value['why'] !== undefined && !isNonEmptyString(value['why'])) {
        bad(`guides.${key}.why`, 'why 写了就必须非空');
      }
    }
  }

  const notes = raw['notes'];
  if (notes !== undefined) {
    if (!isRecord(notes)) {
      bad('notes', 'notes 必须是「动作下标 → 一句话」');
    } else {
      for (const [key, value] of Object.entries(notes)) {
        const at = Number(key);
        if (!Number.isInteger(at) || at < 0 || !Array.isArray(actions) || at >= actions.length) {
          bad(`notes.${key}`, '解说挂在了一个不存在的动作上');
        }
        if (!isNonEmptyString(value)) bad(`notes.${key}`, '解说必须非空');
      }
    }
  }

  const review = raw['review'];
  if (!isRecord(review)) {
    bad('review', '缺复盘块');
  } else {
    if (!isNonEmptyString(review['intro'])) bad('review.intro', '复盘缺开篇');
    if (!isNonEmptyString(review['outro'])) bad('review.outro', '复盘缺收尾');
    const tricks = review['tricks'];
    if (tricks !== undefined) {
      if (!isRecord(tricks)) {
        bad('review.tricks', 'review.tricks 必须是「墩号 → 一句话」');
      } else {
        for (const [key, value] of Object.entries(tricks)) {
          if (!Number.isInteger(Number(key)) || Number(key) < 0) bad(`review.tricks.${key}`, '墩号必须是非负整数');
          if (!isNonEmptyString(value)) bad(`review.tricks.${key}`, '墩要点必须非空');
        }
      }
    }
  }

  if (!isRecord(raw['expect'])) bad('expect', '缺结算存证');
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, deal: raw as unknown as GuideDealData };
}

/** 语义校验：形状已经过了，这里只问引擎 */
export function validateGuideDeal(deal: GuideDealData): readonly GuideProblem[] {
  const problems: GuideProblem[] = [];
  const bad = (where: string, message: string): void => {
    problems.push({ where, message });
  };

  // 54 张不重不漏：三家 17 张 + 3 张底牌
  const hands = deal.facts.hands.map((hand) => [...hand]);
  const all = [...hands.flat(), ...deal.facts.originalKitty];
  if (all.length !== 54) bad('facts', `发牌后是 ${all.length} 张，应当是 54 张`);
  if (new Set(all).size !== all.length) bad('facts', '发牌后有重复的牌');

  const replay = replayGuide(deal);
  if (replay.error !== null) {
    bad(`actions[${replay.error.index}]`, replay.error.message);
    return problems; // 重放都过不去，后面的核对没有意义
  }
  if (replay.state.deal?.phase !== 'scored') {
    bad('actions', '这副牌没有打到结算');
    return problems;
  }

  // 存证核对：引擎或结算规则变了，这里必须报红
  const summary = replay.state.deal.summary!;
  if (JSON.stringify(summary) !== JSON.stringify(deal.expect)) {
    bad('expect', '现场重放的结算与存证不一致（引擎漂移，或数据被改过）');
  }

  // 角色与庄家一致
  const declarerSeat = summary.contract.declarerSeat;
  const roleOk = deal.role === 'declarer' ? deal.learnerSeat === declarerSeat : deal.learnerSeat !== declarerSeat;
  if (!roleOk) {
    bad('role', `role=${deal.role} 与庄家座位（${declarerSeat}）不符`);
  }

  // 引导词：用户座位的每个动作恰好一条，别人一条也不该有
  const guideKeys = new Set(Object.keys(deal.guides));
  const learnerIndexes = new Set<string>();
  deal.actions.forEach((action: GuideAction, index: number) => {
    if (action.seat !== deal.learnerSeat) {
      if (guideKeys.has(String(index))) bad(`guides.${index}`, '给对手的动作写了引导词（引导词只属于用户座位）');
      return;
    }
    learnerIndexes.add(String(index));
    const word: GuideWord | undefined = deal.guides[String(index)];
    if (word === undefined) bad(`guides.${index}`, '用户座位的动作缺引导词');
  });
  for (const key of guideKeys) {
    if (!learnerIndexes.has(key)) bad(`guides.${key}`, '引导词挂在了不属于用户座位的动作上');
  }

  // 复盘要点：墩号必须在范围里
  const trickCount = replay.tricks.length;
  for (const key of Object.keys(deal.review.tricks ?? {})) {
    const ordinal = Number(key);
    if (ordinal >= trickCount) bad(`review.tricks.${key}`, `这副只有 ${trickCount} 墩，墩号越界`);
  }

  // 判据与「三人非 bot」的取材口径对齐：座位表只在 0/1/2 里
  if (!SEATS.includes(deal.learnerSeat)) bad('learnerSeat', '座位越界');

  // 生成物里的牌键必须是**规范写法**：小写 j0/j1，花色 + 数字点数（`C13` 而不是 `CK`）。
  // 手写的课程文案可以用可读写法，但提取脚本产出的数据一律规范，免得两个写法混进同一份文件。
  const CANONICAL = /^(j[01]|[CDHS]([2-9]|1[0-4]))$/;
  for (const key of new Set([...deal.facts.hands.flat(), ...deal.facts.originalKitty])) {
    if (!CANONICAL.test(key)) bad('facts', `牌键必须是规范写法（如 C13）：${key}`);
  }

  return problems;
}
