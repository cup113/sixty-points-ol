/**
 * 视图投影单测。两个主题共用一份文件：
 *
 * 1. **观战者只看公共视图**（ADR-0007）：用结构 walker 把 payload 里所有像牌的对象抓出来，
 *    断言它与「此刻应当隐藏的牌集合」不相交。跑随机整局（`GAME_SEEDS` 可放大），每一步都查一次。
 *    不做字符串子串匹配：`S1` 会命中 `S14`，那种守卫会自己制造假绿。
 * 2. **底牌只对庄家提前可见**（见 CONTEXT.md 的 **底牌** / **拿上来的底牌** / **埋下的底牌**）：
 *    发牌留下的 3 张在成交后就并进庄家手牌，所以对庄家不是新信息 —— 个人视图把它们一并交出
 *    （`you.originalKitty`），好让界面点明「哪三张是拿上来的」；他**埋下去的那 3 张**同样是他自己
 *    选的，埋底完成后由 `you.buriedKitty` 交出（回看，见 `PersonalView` 的注释）。
 *    闲家到结算（`summary.originalKitty` / `summary.kitty`）才看得到两批牌。
 *
 * 两件事的边界是同一条：**公共投影里不许出现任何私有字段**，
 * 所以 `originalKitty` / `buriedKitty` 都放在 `you`（庄家私有）而不是 `deal`（观战者也拿得到）里。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cardKey, SEATS, type Card, type Rank, type Seat, type Suit } from '../src/cards.ts';
import { createGame, dispatch, playTurn, type Action, type GameState } from '../src/state.ts';
import { personalView, publicView } from '../src/view.ts';
import { mulberry32, randomLegalAction } from './helpers.ts';

const SEEDS = Number(process.env['GAME_SEEDS'] ?? 60);
const STEP_CAP = 40000;

/** 结构 walker：payload 里所有「像一张牌」的对象（joker 或 suit+rank） */
function cardsIn(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const item of value) cardsIn(item, out);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  const obj = value as Record<string, unknown>;
  if (obj['joker'] === 'small' || obj['joker'] === 'big') {
    out.push({ joker: obj['joker'] });
    return out;
  }
  if (typeof obj['suit'] === 'string' && typeof obj['rank'] === 'number') {
    out.push({ suit: obj['suit'] as Suit, rank: obj['rank'] as Rank });
    return out;
  }
  for (const item of Object.values(obj)) cardsIn(item, out);
  return out;
}

function keysOf(cards: readonly Card[]): Set<string> {
  return new Set(cards.map(cardKey));
}

/**
 * 此刻对该观看者必须隐藏的牌 = 不在他**已知集合**里的牌。
 *
 * 「隐藏」是相对知识而言的，不是一张固定的清单：
 * - 闲家：只知道自己的手牌 —— 其余两手 + 结算前的底牌都算隐藏；
 * - 庄家：拿上来的 3 张（`originalKitty`）与埋回去的 3 张（`kitty`）都是他自己选的动作，
 *   所以他本来就全知道 —— 对他只有另外两手是隐藏的。这一条是 rebase 合并
 *   「庄家的 originalKitty」时暴露出来的：庄家把拿上来的某张又埋回去之后，
 *   那张牌同时出现在 `you.originalKitty` 与（被埋的）`deal.kitty` 里，这不是泄漏；
 * - 观战者（`viewer === null`）：什么都不知道 —— 三手 + 结算前的底牌全算隐藏。
 *
 * 结算后底牌随 summary 公开，手牌也已打空，此时没有隐藏牌。
 */
function hiddenKeys(state: GameState, viewer: Seat | null): Set<string> {
  const deal = state.deal;
  if (deal === null) return new Set<string>();

  const known = new Set<string>();
  const hidden: Card[] = [];
  // 认赢的**亮牌**是主动公开的（ADR-0028）：对谁都不算隐藏，被拒也一样
  const revealed = new Set((deal.claim?.revealed ?? []).map(cardKey));
  for (const seat of SEATS) {
    if (viewer !== null && seat === viewer) {
      for (const card of deal.hands[seat]!) known.add(cardKey(card));
      continue;
    }
    hidden.push(...deal.hands[seat]!);
  }

  if (viewer === null) {
    if (deal.phase !== 'scored') hidden.push(...deal.kitty);
    return keysOf(hidden.filter((card) => !revealed.has(cardKey(card))));
  }

  // 庄家自己选过的两批牌（拿上来 / 埋回去）对他都不是隐藏信息
  if (deal.contract !== null && deal.contract.declarerSeat === viewer) {
    for (const card of deal.originalKitty) known.add(cardKey(card));
    for (const card of deal.kitty) known.add(cardKey(card));
  }
  if (deal.phase !== 'scored') {
    for (const card of deal.kitty) if (!known.has(cardKey(card))) hidden.push(card);
  }
  return keysOf(hidden.filter((card) => !revealed.has(cardKey(card))));
}

function leaked(payload: unknown, hidden: Set<string>): string[] {
  return [...keysOf(cardsIn(payload))].filter((key) => hidden.has(key));
}

/**
 * 泄漏检查只看**当前这一副**。
 *
 * 每副牌都是重新洗的 54 张，牌面身份会重复出现：上一副的战报（`history[].kitty` / `captured`）
 * 本来就公开那些牌，把它们算成泄漏是假警报。当前这副的隐藏集合与当前这副的公开部分
 * （`deal` 里的 `handCounts` / `captured` / `trickHistory` / `summary`）才是可比的。
 */
function currentDealOf(view: { deal: unknown; you?: unknown }): unknown {
  return { deal: view.deal, you: view.you };
}

/** 公共视图的 `deal` 字段白名单：多一个字段就必须在这里显式登记，否则测试红 */
const PUBLIC_DEAL_FIELDS = [
  'phase',
  'dealNo',
  'dealerSeat',
  'auction',
  'highestBid',
  'auctionTurn',
  'contract',
  'trump',
  'trick',
  'playTurn',
  'trickHistory',
  'captured',
  'handCounts',
  'declarerSeat',
  'summary',
  'claim'
].sort();

/**
 * 公共视图的**顶层**字段白名单。
 *
 * 为什么需要它（这是一次注入实验暴露出来的盲点）：下面的泄漏检查只看当前这副，
 * 于是把 payload 收窄成 `{ deal, you }` —— 因为上一副的战报（`history`）本来就公开那些牌，
 * 全量走会假警报。但收窄也就意味着**新增在负载顶层的字段完全不被检查**：
 * 往 `publicView` 里塞一个顶层 `hands`，当时 76 个测试全绿，只有端到端（spectate-check 走全量）
 * 抓到了。所以这一层用「字段名白名单」来守：多一个字段就必须显式登记并被思考一次。
 */
const PUBLIC_FIELDS = [
  'version',
  'status',
  'dealerSeat',
  'dealNo',
  'levels',
  'progress',
  'result',
  'history',
  'deal'
].sort();

describe('公共视图 / 个人视图的信息边界', () => {
  it('公共视图的顶层字段只有白名单里的这些', () => {
    const rng = mulberry32(7);
    let state = createGame(0);
    for (let step = 0; step < 40; step++) {
      const res = dispatch(state, randomLegalAction(state, rng), rng);
      assert.ok(res.ok);
      if (!res.ok) return;
      state = res.state;
      assert.deepEqual(
        Object.keys(publicView(state)).sort(),
        PUBLIC_FIELDS,
        `公共视图的顶层字段变了：多出来的字段可能是新的泄漏面（第 ${step} 步）`
      );
    }
  });

  it('公共视图没有手牌与底牌字段（白名单）', () => {
    const rng = mulberry32(7);
    let state = createGame(0);
    for (let step = 0; step < 40; step++) {
      const res = dispatch(state, randomLegalAction(state, rng), rng);
      assert.ok(res.ok);
      if (!res.ok) return;
      state = res.state;
      const view = publicView(state);
      if (view.deal === null) continue;
      assert.deepEqual(
        Object.keys(view.deal).sort(),
        PUBLIC_DEAL_FIELDS,
        `公共视图的 deal 字段变了：多出来的字段可能是新的泄漏面（第 ${step} 步，phase=${view.deal.phase}）`
      );
    }
  });

  it('个人视图 = 公共视图 + 自己那一份 you（私有字段只能在 you 里）', () => {
    const rng = mulberry32(11);
    let state = createGame(0);
    for (let step = 0; step < 40; step++) {
      const res = dispatch(state, randomLegalAction(state, rng), rng);
      assert.ok(res.ok);
      if (!res.ok) return;
      state = res.state;
      const pub = publicView(state) as unknown as Record<string, unknown>;
      const mine = personalView(state, 1) as unknown as Record<string, unknown>;
      const extra = Object.keys(mine).filter((key) => !(key in pub));
      assert.deepEqual(extra, ['you'], `个人视图相对公共视图只能多出 you，实际多出 ${extra.join(',')}`);
      const you = mine['you'] as {
        seat: number;
        hand: readonly Card[];
        isDeclarer: boolean;
        originalKitty: readonly Card[] | null;
        buriedKitty: readonly Card[] | null;
      };
      assert.equal(you.seat, 1, 'you.seat 应当就是请求的座位');
      assert.equal(
        you.hand.length,
        state.deal === null ? 0 : state.deal.hands[1]!.length,
        'you.hand 张数应当与引擎里该座位的手牌一致'
      );
      // 私有字段一律挂在 you 上：庄家的两批底牌都不该出现在公共投影里
      assert.equal('originalKitty' in (pub['deal'] as object ?? {}), false, '公共投影里出现了 originalKitty');
      assert.equal('buriedKitty' in (pub['deal'] as object ?? {}), false, '公共投影里出现了 buriedKitty');
      for (const key of Object.keys(pub)) {
        assert.deepEqual(mine[key], pub[key], `字段 ${key} 在两个视图里应当一致`);
      }
    }
  });

  it(`${SEEDS} 个随机整局：观战者与玩家每一步都拿不到隐藏牌`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = mulberry32(seed);
      let state = createGame((seed % 3) as Seat);
      let steps = 0;
      let sawAuction = false;
      let sawPlay = false;

      while (state.status === 'playing' && steps < STEP_CAP) {
        const res = dispatch(state, randomLegalAction(state, rng), rng);
        assert.ok(res.ok, `seed=${seed} 动作被拒`);
        if (!res.ok) break;
        state = res.state;
        steps += 1;

        if (state.deal?.phase === 'auction') sawAuction = true;
        if (state.deal?.phase === 'play') sawPlay = true;

        const spectator = publicView(state);
        const spectatorLeak = leaked(currentDealOf(spectator), hiddenKeys(state, null));
        assert.deepEqual(
          spectatorLeak,
          [],
          `seed=${seed} 第 ${steps} 步观战视图泄漏了牌：${spectatorLeak.join(',')}`
        );

        for (const seat of SEATS) {
          const playerLeak = leaked(currentDealOf(personalView(state, seat)), hiddenKeys(state, seat));
          assert.deepEqual(
            playerLeak,
            [],
            `seed=${seed} 第 ${steps} 步座位 ${seat} 的个人视图泄漏了牌：${playerLeak.join(',')}`
          );
        }
      }

      assert.ok(sawAuction, `seed=${seed} 没经过叫牌阶段，覆盖不完整`);
      assert.ok(sawPlay, `seed=${seed} 没经过打牌阶段，覆盖不完整`);
    }
  });

  it('底牌只在结算后随 summary 公开（公共投影口径）', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = mulberry32(seed);
      let state = createGame((seed % 3) as Seat);
      let steps = 0;
      let checkedHidden = false;
      let checkedRevealed = false;

      while (state.status === 'playing' && steps < STEP_CAP) {
        const res = dispatch(state, randomLegalAction(state, rng), rng);
        assert.ok(res.ok);
        if (!res.ok) break;
        state = res.state;
        steps += 1;

        const deal = state.deal;
        if (deal === null) continue;
        const kittyKeys = keysOf(deal.kitty);
        const inPayload = keysOf(cardsIn(publicView(state).deal));

        if (deal.phase === 'bury' || deal.phase === 'play') {
          // 埋底之后、结算之前：底牌一个字都不能出现
          for (const key of kittyKeys) {
            assert.ok(!inPayload.has(key), `seed=${seed} ${deal.phase} 阶段公共视图里出现了底牌 ${key}`);
          }
          checkedHidden = true;
        }
        if (deal.phase === 'scored' && deal.summary !== null) {
          for (const key of keysOf(deal.summary.kitty)) {
            assert.ok(inPayload.has(key), `seed=${seed} 结算后底牌 ${key} 应当随 summary 公开`);
          }
          checkedRevealed = true;
        }
      }

      assert.ok(checkedHidden, `seed=${seed} 没覆盖到「结算前底牌不可见」`);
      assert.ok(checkedRevealed, `seed=${seed} 没覆盖到「结算后底牌公开」`);
    }
  });
});

/** 走完整的一副：叫牌 → 埋底 → 打牌 → 结算，每一步都断言三家的底牌可见性 */
function walkOneDeal(seed: number): { final: GameState } {
  const rng = mulberry32(seed);
  let state = createGame(0);
  let steps = 0;
  let sawBury = false;
  let sawPlay = false;

  while (steps < 20000) {
    const deal = state.deal;
    if (deal !== null && deal.phase === 'scored' && deal.summary !== null) {
      // 结算后：summary 里的底牌对三家都公开，数量与发牌留下的一致
      for (const seat of SEATS) {
        const view = personalView(state, seat);
        assert.equal(view.deal?.summary?.originalKitty.length, 3, `seed=${seed} 结算后底牌应对所有人可见`);
      }
      assert.ok(sawBury, `seed=${seed} 这一副应当经过埋底阶段`);
      assert.ok(sawPlay, `seed=${seed} 这一副应当经过出牌阶段`);
      return { final: state };
    }

    if (deal !== null) {
      const declarerSeat = deal.contract?.declarerSeat ?? null;
      for (const seat of SEATS) {
        const view = personalView(state, seat);
        const kitty = view.you.originalKitty;
        if (deal.phase === 'auction' || declarerSeat === null) {
          assert.equal(kitty, null, `seed=${seed} 叫牌阶段任何人都不该看到底牌`);
          continue;
        }
        if (seat === declarerSeat) {
          assert.equal(kitty?.length, 3, `seed=${seed} 庄家应当看得到 3 张底牌`);
          assert.deepEqual(
            (kitty ?? []).map(cardKey).sort(),
            deal.originalKitty.map(cardKey).sort(),
            `seed=${seed} 庄家看到的底牌应与牌局一致`
          );
          // 庄家看得见 = 因为他手里本来就有这 20 张；埋完 3 张就回到 17（打牌中再逐轮减少）
          if (deal.phase === 'bury') {
            assert.equal(view.you.hand.length, 20, `seed=${seed} 埋底阶段庄家手牌应为 20 张`);
          } else if (deal.trick?.plays.length === 0 && deal.trickHistory.length === 0) {
            assert.equal(view.you.hand.length, 17, `seed=${seed} 出牌第 1 轮庄家手牌应为 17 张`);
          }
        } else {
          assert.equal(kitty, null, `seed=${seed} 闲家（座位 ${seat}）不该看到底牌`);
        }
      }
      if (deal.phase === 'bury') sawBury = true;
      if (deal.phase === 'play') sawPlay = true;
    }

    const action: Action = randomLegalAction(state, rng);
    const result = dispatch(state, action, rng);
    assert.ok(result.ok, `seed=${seed} 第 ${steps} 步被拒：${result.ok ? '' : result.message}`);
    if (!result.ok) break;
    state = result.state;
    steps += 1;
  }
  throw new Error(`seed=${seed} 没能在 20000 步内走完一副`);
}

describe('个人视图：底牌可见性', () => {
  it('叫牌阶段对所有人隐藏；成交后只对庄家可见；结算后对所有人公开', () => {
    for (const seed of [1, 4, 9]) walkOneDeal(seed);
  });

  it('闲家看到的底牌恒为 null —— 直到结算才随 summary 公开', () => {
    const rng = mulberry32(11);
    let state = createGame(0);
    let steps = 0;
    let checkedDefender = false;

    while (steps < 20000) {
      const deal = state.deal;
      if (deal !== null && deal.contract !== null && deal.phase !== 'scored') {
        const declarer = deal.contract.declarerSeat;
        const defender = ((declarer + 1) % 3) as Seat;
        const view = personalView(state, defender);
        assert.equal(view.you.originalKitty, null, '闲家不该看到底牌');
        assert.equal(view.you.buriedKitty, null, '闲家不该看到庄家埋下去的那 3 张');
        assert.equal(view.you.isDeclarer, false);
        checkedDefender = true;
      }
      if (deal !== null && deal.phase === 'scored') break;
      const result = dispatch(state, randomLegalAction(state, rng), rng);
      if (!result.ok) break;
      state = result.state;
      steps += 1;
    }

    assert.ok(checkedDefender, '这副牌应当至少检查到一次成交后的闲家视图');
  });

  it('庄家的 originalKitty 与结算里的 originalKitty 是同一组牌', () => {
    const rng = mulberry32(23);
    let state = createGame(0);
    let captured: { seat: Seat; kitty: string[] } | null = null;
    let steps = 0;

    while (steps < 20000) {
      const deal = state.deal;
      if (deal !== null && deal.phase === 'bury' && deal.contract !== null) {
        const seat = deal.contract.declarerSeat;
        const view = personalView(state, seat);
        captured = { seat, kitty: (view.you.originalKitty ?? []).map(cardKey).sort() };
      }
      if (deal !== null && deal.phase === 'scored' && deal.summary !== null) {
        assert.ok(captured !== null, '应当先经过埋底阶段');
        assert.deepEqual(
          deal.summary.originalKitty.map(cardKey).sort(),
          captured!.kitty,
          '结算公开的底牌应与庄家埋底时看到的一致'
        );
        return;
      }
      const result = dispatch(state, randomLegalAction(state, rng), rng);
      if (!result.ok) break;
      state = result.state;
      steps += 1;
    }
    throw new Error('没能在 20000 步内走完一副');
  });

  it('庄家的 buriedKitty 埋底完成后才出现，且与结算里的 kitty 是同一组牌', () => {
    const rng = mulberry32(41);
    let state = createGame(0);
    let steps = 0;
    let sawBury = false;
    let sawPlay = false;
    let buriedAtPlay: string[] | null = null;

    while (steps < 20000) {
      const deal = state.deal;
      if (deal !== null && deal.contract !== null && deal.phase === 'bury') {
        // 埋底阶段 `deal.kitty` 还是发牌留下的占位（见 state.ts 的 newDeal）：
        // 庄家这时还没埋牌，把它当「埋下去的 3 张」交出去会指着一手还没做的决定。
        const view = personalView(state, deal.contract.declarerSeat);
        assert.equal(view.you.buriedKitty, null, '埋底阶段不该给出 buriedKitty');
        sawBury = true;
      }
      if (deal !== null && deal.phase === 'play' && deal.contract !== null) {
        const view = personalView(state, deal.contract.declarerSeat);
        assert.ok(view.you.buriedKitty !== null, '打牌阶段庄家应当能回看自己埋下去的 3 张');
        assert.deepEqual(
          [...view.you.buriedKitty].map(cardKey).sort(),
          deal.kitty.map(cardKey).sort(),
          'buriedKitty 与引擎里埋下的底牌对不上'
        );
        buriedAtPlay = [...view.you.buriedKitty].map(cardKey).sort();
        sawPlay = true;
      }
      if (deal !== null && deal.phase === 'scored' && deal.contract !== null && deal.summary !== null) {
        const view = personalView(state, deal.contract.declarerSeat);
        assert.ok(view.you.buriedKitty !== null, '结算阶段庄家仍能回看自己埋下去的 3 张');
        assert.deepEqual(
          [...view.you.buriedKitty].map(cardKey).sort(),
          deal.summary.kitty.map(cardKey).sort(),
          '结算公开的 kitty 应与庄家回看的 buriedKitty 一致'
        );
        assert.deepEqual(buriedAtPlay, [...view.you.buriedKitty].map(cardKey).sort(), '打牌阶段与结算阶段应是同一组牌');
        return;
      }
      const result = dispatch(state, randomLegalAction(state, rng), rng);
      if (!result.ok) break;
      state = result.state;
      steps += 1;
    }
    throw new Error(`没能在 20000 步内走完一副（sawBury=${sawBury} sawPlay=${sawPlay}）`);
  });

  it('出牌阶段的轮次提示仍然只在座位上（视图不因私有字段而改变轮次语义）', () => {
    const rng = mulberry32(31);
    let state = createGame(0);
    let checked = 0;
    let steps = 0;
    while (steps < 20000) {
      const deal = state.deal;
      if (deal !== null && deal.phase === 'play') {
        const turn = playTurn(deal);
        for (const seat of SEATS) {
          const view = personalView(state, seat);
          assert.equal(view.deal?.playTurn, turn);
          assert.equal(view.you.seat, seat);
        }
        checked += 1;
        break;
      }
      const result = dispatch(state, randomLegalAction(state, rng), rng);
      if (!result.ok) break;
      state = result.state;
      steps += 1;
    }
    assert.ok(checked > 0, '应当走到出牌阶段');
  });
});
