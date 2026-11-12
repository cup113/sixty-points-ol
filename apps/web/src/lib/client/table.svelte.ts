import {
  cardKey,
  forcedPlay,
  pickableCards,
  type BidCall,
  type Card,
  type PublicView
} from '@sixty/engine';
import type { PlayerHand, Role, StreamPayload, TableView } from '$lib/shared';
import {
  armedAfter,
  AUTO_PASS_TRIES,
  autoPassBeat,
  autoPassDelay,
  autoPassRetryDelay,
  readArmedDealNo,
  writeArmedDealNo
} from '$lib/auto-pass';
import { saveCredential } from '$lib/identity';
import { checkPlay } from '$lib/labels';
import { shouldResetSelection, type SelectionContext } from '$lib/selection';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/** 一张同桌的客户端状态：SSE 收负载（角色/视图/手牌）、POST 发动作（座位由服务端决定） */
export class TableClient {
  readonly code: string;
  /** 当前角色：观战者入座后由下一帧负载切换，界面据此增减手牌区与操作区 */
  role = $state<Role>('spectator');
  view = $state<PublicView | null>(null);
  /** 玩家独有的一份信息；观战者为 null */
  you = $state<PlayerHand | null>(null);
  table = $state<TableView | null>(null);
  /**
   * **玩家自己点的**那几张（`cardKey` 数组）；`null` = 还没点过，此刻用引擎算的**必出牌**
   * （ADR-0030）。两个状态分开存是刻意的：自动选中只该在「玩家没有表态」时生效 ——
   * 一旦他自己点了一张，那就是他的选择，不该被下一帧按必出牌覆盖掉。
   */
  #custom = $state<string[] | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  connection = $state<ConnectionState>('connecting');
  /** 入座时这一副正在进行 ⇒ 我接下了别人的手牌（一次性提示，关掉即消） */
  inheritedNotice = $state(false);
  /**
   * 这一副是否已委托「不叫」（ADR-0029）。真值源是 `localStorage`（键里带副号），
   * 这里只是它在界面上的镜像 —— 换副、或这一副的叫牌一结束，`#syncAutoPass()` 就会把它算回 false，
   * 所以不需要另写清理代码。
   */
  autoPass = $state(false);

  #source: EventSource | null = null;
  /** 一拍只排一次：排上了就等它响，别叠第二个定时器 */
  #autoTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已经代按过的**那一拍**（`副号:叫牌史长度`）：先记后发，发失败了再退回来重试 */
  #autoBeat: string | null = null;
  /**
   * 这一拍已经连败几拍。**只在失败时涨**，成功或收到新帧就归零（见 `#fireAutoPass` / `#apply`）：
   * 预算用完就停手 —— 否则断网时它会永远每秒重发一次（`AUTO_PASS_TRIES` 那里写着为什么）。
   */
  #autoTries = 0;

  constructor(code: string, initial: StreamPayload, inherited = false) {
    this.code = code;
    this.inheritedNotice = inherited;
    this.#apply(initial);
  }

  /**
   * 吃一帧负载。`resetSelection` = 这一帧让**玩家自己的选择**失去意义了（换副、补位、我刚出手，
   * 判据在 `selection.ts`）—— 那时把 `#custom` 抹回 `null`，选中态于是落回引擎的必出牌。
   *
   * 清空与自动选中**写在一起**是有意的：分开两处时，「刚清掉旧牌、又该自动选中新牌」这条
   * 先后关系就靠在两个文件里各写一遍，迟早会有一个调用方只做一半。
   */
  #apply(payload: StreamPayload, resetSelection = false): void {
    this.role = payload.role;
    this.view = payload.view;
    this.you = payload.you;
    this.table = payload.table;
    if (resetSelection) this.#custom = null;
    // 收到新帧 = 这条链路又通了，重试预算归零（断网期间烧完的那五个不该带进来）
    this.#autoTries = 0;
    this.#syncAutoPass();
    this.#pumpAutoPass();
  }

  connect(): void {
    this.connection = 'connecting';
    const source = new EventSource(`/api/tables/${this.code}/stream`);
    source.onopen = () => {
      this.connection = 'live';
    };
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as StreamPayload;
      // 只有让选择失去意义的帧才清空：无关连接引起的广播不该刷掉正在选的牌（见 selection.ts）
      this.#apply(payload, shouldResetSelection(this.#snapshot(), payload));
      this.connection = 'live';
    };
    source.onerror = () => {
      this.connection = 'offline';
    };
    this.#source = source;
  }

  #snapshot(): SelectionContext {
    return { role: this.role, you: this.you };
  }

  disconnect(): void {
    this.#source?.close();
    this.#source = null;
    this.#clearAutoTimer();
  }

  /* ---------------- 委托不叫（ADR-0029） ---------------- */

  /**
   * 委托开 / 关：只写本机存储，不发任何请求，所以点了立即生效、也不可能失败。
   *
   * 摆在叫牌阶段之外时直接忽略（界面上那个开关也只在叫牌阶段渲染）：
   * 委托的作用范围就是「这一副的叫牌」，没有第二种用法。
   */
  setAutoPass(on: boolean): void {
    const deal = this.view?.deal ?? null;
    if (deal === null || deal.phase !== 'auction') return;
    writeArmedDealNo(this.code, on ? deal.dealNo : null);
    this.autoPass = on;
    this.#pumpAutoPass();
  }

  /** 从本机存储把「这一副是否已委托」算回来（刷新、换副、叫牌结束、开新对局之后都靠它） */
  #syncAutoPass(): void {
    const stored = readArmedDealNo(this.code);
    const next = armedAfter(this.view, stored);
    if (next === null) {
      // 叫牌结束就清账：台账因此永远只可能躺着一个**当下正在叫牌**的副号，
      // 「开新对局把副号归零」也就不会让上一局的委托重新生效（见 auto-pass.ts 的 armedAfter）。
      if (stored !== null) writeArmedDealNo(this.code, null);
    } else if (stored !== next) {
      writeArmedDealNo(this.code, next);
    }
    this.autoPass = next !== null;
  }

  /**
   * 每次负载变化后重判一次：该代按就排一拍，不该就撤掉在途的那一拍。
   *
   * 没有轮询、没有常驻定时器：唯一的定时器是「这半拍」本身，而且只在真该出手时存在。
   * 判据全在 `auto-pass.ts` 的 `autoPassBeat` 里（纯函数，逐帧可测）。
   */
  #pumpAutoPass(): void {
    const beat = autoPassBeat(this.view, this.you, this.autoPass, this.#autoBeat);
    if (beat === null) {
      this.#clearAutoTimer();
      return;
    }
    if (this.#autoTimer !== null) return;
    // 预算烧完：不再自己重排，等下一帧（重连补帧）把预算清零后重来。
    // 少了这一句，断网时的代按就是一条**每秒一次**的循环（代价写在 `AUTO_PASS_TRIES` 那里）。
    if (this.#autoTries >= AUTO_PASS_TRIES) {
      this.error = '委托不叫没发出去（网络？）—— 轮到你时请手动点「不叫」';
      this.#clearAutoTimer();
      return;
    }
    this.#autoTimer = setTimeout(() => {
      this.#autoTimer = null;
      void this.#fireAutoPass();
    }, autoPassDelay(Math.random) + autoPassRetryDelay(this.#autoTries));
  }

  #clearAutoTimer(): void {
    if (this.#autoTimer === null) return;
    clearTimeout(this.#autoTimer);
    this.#autoTimer = null;
  }

  /**
   * 定时器到点：**重新判一次**再出手（这半拍里可能已经有人出手、我撤了委托、换了副）。
   *
   * 记账键先写下去再发：同一拍绝不发第二次（重连补帧、无关广播引起的重判都不会）。
   * 但发失败就把账退回来并再排一拍 —— 一次网络抖动不该让这一拍永远没人按（桌面会卡在那里等），
   * 也不该等下一帧：这一拍之后可能再也没有别人出手，帧也就不再来。
   *
   * 重试**有退避、有预算**（`autoPassRetryDelay` / `AUTO_PASS_TRIES`）：没有它们的话，
   * 「失败就立刻再排一拍」在断网时是一条每秒一次的循环 —— `busy` 每秒翻一次、页头横幅每秒被抹一次，
   * 而「一次抖动」与「网真断了」这两件事根本分不开。
   */
  async #fireAutoPass(): Promise<void> {
    const beat = autoPassBeat(this.view, this.you, this.autoPass, this.#autoBeat);
    if (beat === null) return;
    this.#autoBeat = beat;
    const sent = await this.bid('pass', { quiet: true });
    if (this.#autoBeat !== beat) return;
    if (sent) {
      this.#autoTries = 0;
      return;
    }
    this.#autoBeat = null;
    this.#autoTries += 1;
    this.#pumpAutoPass();
  }

  /** 本墩领出的那几张（轮到我领出、或还没人出牌时为 null）—— 三条判据共用这一个入口 */
  #lead = $derived.by((): readonly Card[] | null => {
    const trick = this.view?.deal?.trick ?? null;
    return trick !== null && trick.plays.length > 0 ? trick.plays[0]!.cards : null;
  });

  /** 我的牌是否**已经落在这一墩里**了（出过手之后，本墩的领出与我无关） */
  #playedThisTrick = $derived.by((): boolean => {
    const trick = this.view?.deal?.trick ?? null;
    const me = this.you;
    if (trick === null || me === null) return false;
    return trick.plays.some((play) => play.seat === me.seat);
  });

  /**
   * 这一手**归我动**（打牌轮到我 / 埋底轮到庄家）—— 「我的回合」的**唯一定义**。
   *
   * 动作托盘出不出现（`ActionTray`）、手牌能不能点（`+page.svelte`）、必出牌要不要自动选中
   * （`#forced`）都读它。**三处各写一遍时它们会各自过期**：早先 `#forced` 只看
   * 「本墩已有领出」，于是别人领出的那十几秒里、以及我自己刚出完牌之后，
   * 该跟那一门的牌一边带蓝框（拟选，ADR-0021）、一边被自动选中并上浮 ——
   * 而那一刻**托盘根本不在**（它只在我这一手归我动时出现），
   * 上浮的选择态没有任何能作用于它的控件，看起来就是「系统替我出了牌」。
   */
  myMove = $derived.by((): boolean => {
    const deal = this.view?.deal ?? null;
    const me = this.you;
    if (deal === null || me === null) return false;
    if (deal.phase === 'play') return deal.playTurn === me.seat;
    if (deal.phase === 'bury') return me.isDeclarer;
    return false;
  });

  /**
   * **拟选的窗口**（ADR-0021）：本墩已有领出、而我还**没出手**。
   *
   * 「该跟哪一门」（蓝框）与「哪几张凑得出合法的一手」（`pickable`）都只在这个窗口里成立 ——
   * 我出过手之后旧领出不再约束我，再标就是一条过期的提示（同一株根因的另一半，见 `myMove`）。
   */
  planning = $derived.by((): boolean => {
    const deal = this.view?.deal ?? null;
    if (deal === null || this.you === null || deal.phase !== 'play') return false;
    const trick = deal.trick;
    if (trick === null || trick.plays.length === 0) return false;
    return !this.#playedThisTrick;
  });

  /**
   * 这一手**必出**的那几张（引擎算，`forcedPlay`，ADR-0030）；没有就是空数组。
   *
   * 只在**归我动的那一刻**才算：领出恒为空（出什么、出几张全由玩家定），
   * 而拟选期间不算 —— 那时没有托盘，「已选 N 张」这句话无处可说，上浮只能被读成别的东西。
   */
  #forced = $derived.by((): string[] => {
    const deal = this.view?.deal ?? null;
    const me = this.you;
    const lead = this.#lead;
    if (deal === null || me === null || deal.trump === null || lead === null) return [];
    if (deal.phase !== 'play' || !this.myMove) return [];
    return forcedPlay(me.hand, deal.trump, lead).map(cardKey);
  });

  /** 选中态：玩家自己点的那几张，否则就是必出牌（自动选中，少点几下） */
  get selected(): readonly string[] {
    return this.#custom ?? this.#forced;
  }

  /**
   * 现在**点得动**的手牌（引擎的 `pickableCards`）：点不动的牌不响应，也不上浮。
   *
   * 只在拟选窗口里有值（`planning`）；其余时刻是 `null` = 不设限 ——
   * 埋底（20 张里挑 3 张）与领出（任意单张都合法）本来就没有「点了也不成」这回事。
   */
  pickable = $derived.by((): ReadonlySet<string> | null => {
    const deal = this.view?.deal ?? null;
    const me = this.you;
    if (deal === null || me === null || deal.trump === null || !this.planning) return null;
    return pickableCards(me.hand, deal.trump, this.#lead, this.selectedCards);
  });

  selectedCards = $derived.by(() => {
    const hand = this.you?.hand ?? [];
    const chosen = this.selected;
    return hand.filter((card) => chosen.includes(cardKey(card)));
  });

  playError = $derived.by(() => {
    const view = this.view;
    const you = this.you;
    const deal = view?.deal;
    if (!view || !you || !deal || deal.phase !== 'play' || deal.trump === null) return null;
    if (deal.playTurn !== you.seat) return null;
    const cards = this.selectedCards;
    if (cards.length === 0) return null;
    return checkPlay({ hand: you.hand, trump: deal.trump, lead: this.#lead }, cards);
  });

  /**
   * 点一张牌。**点不动的牌不响应**（不合法的那一下被拦在这里，而不是等到按出牌时再报错）。
   *
   * 第一次点就写进 `#custom` —— 从这一刻起选中态归玩家，必出牌不再自动接管。
   */
  toggle(card: Card): void {
    const key = cardKey(card);
    if (this.pickable !== null && !this.pickable.has(key)) return;
    const current = this.selected;
    this.#custom = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
  }

  /** 清空 = 玩家表态「一张都不选」：落回 `[]` 而不是 `null`，否则必出牌会立刻把它填回来 */
  clearSelection(): void {
    this.#custom = [];
  }

  /**
   * 所有动作请求的唯一出口。
   *
   * `quiet` = **不是用户刚点的动作**：委托不叫（ADR-0029）由页面代发。
   * 这类请求不许碰界面的两个状态位：
   * - **不置 `busy`**：它会让手动「不叫」、托盘、页头那几枚按钮跟着灰一下。
   *   代按重试时每分钟灰好几次，看起来就像界面在抽风（它甚至可能把人的手动出口挡在后面）。
   * - **不清/不写 `error`**：`error = null` 是「我刚点了一个动作，旧的红字过期了」这条语义，
   *   一条每分钟重发几次的后台请求没有资格替用户抹掉页头的横幅。
   *
   * 成功与失败的判据完全不变，只是不上屏。去重由 `#autoBeat` 那把记账键负责，不靠 `busy`。
   */
  async #request(path: string, init: RequestInit = {}, quiet = false): Promise<unknown> {
    /** 这次请求是否替用户「持有」界面的那两个状态位 */
    const owned = !quiet;
    if (owned) {
      this.busy = true;
      this.error = null;
    }
    try {
      const response = await fetch(path, {
        ...init,
        headers: {
          // 让 SvelteKit 的错误响应也走 JSON：动作失败的原因才能在客户端原样上屏，
          // 而不是退化成「操作失败（400）」。
          accept: 'application/json',
          'content-type': 'application/json',
          ...(init.headers ?? {})
        }
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        if (owned) this.error = payload?.message ?? `操作失败（${response.status}）`;
        return null;
      }
      this.#custom = null;
      return payload;
    } catch (cause) {
      if (owned) this.error = cause instanceof Error ? cause.message : '网络错误';
      return null;
    } finally {
      if (owned) this.busy = false;
    }
  }

  send(action: unknown, options: { quiet?: boolean } = {}): Promise<boolean> {
    return this.#request(
      `/api/tables/${this.code}/action`,
      { method: 'POST', body: JSON.stringify({ action }) },
      options.quiet === true
    ).then((payload) => payload !== null);
  }

  /**
   * 桌边消息（ADR-0028）：表情 / 短句 / 暂离共用这一个写端。
   *
   * 与动作请求刻意分开，**不碰 `this.error`**：失败原因是「发得太快了」这类要贴在弹层里的话，
   * 不该跑到页头那条红色横幅上、把毡面顶下去；它也不清 `selected` ——
   * 说一句话与手上正在拟选的牌是两件正交的事。
   *
   * 返回 `null` 表示成功，否则是给用户看的那一句原因。
   */
  async #social(body: unknown): Promise<string | null> {
    this.busy = true;
    try {
      const response = await fetch(`/api/tables/${this.code}/social`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) return payload?.message ?? `没发出去（${response.status}）`;
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : '网络错误';
    } finally {
      this.busy = false;
    }
  }

  emote(key: string): Promise<string | null> {
    return this.#social({ kind: 'emote', key });
  }

  say(text: string): Promise<string | null> {
    return this.#social({ kind: 'text', text });
  }

  away(minutes: number): Promise<string | null> {
    return this.#social({ kind: 'away', minutes });
  }

  /** 入座：继承该座位的级别与手牌；角色会随下一帧负载变成 player */
  async sit(): Promise<boolean> {
    const payload = (await this.#request(`/api/tables/${this.code}/seat`, { method: 'POST' })) as {
      inherited?: boolean;
    } | null;
    if (payload === null) return false;
    // 这一副正在进行的话，我接下的是别人的进度：提示一次，别让人拿着陌生手牌发愣
    this.inheritedNotice = payload.inherited === true;
    return true;
  }

  /** 离座：座位空出、本人转为观战者（服务端幂等） */
  leave(): Promise<boolean> {
    return this.#request(`/api/tables/${this.code}/seat`, { method: 'DELETE' }).then((p) => p !== null);
  }

  /**
   * 加机器人：`seat` 是**点的那张空座卡**（进行中加入即补位）。
   * 服务端校验「在座人类 + 未达上限 + 该座位确实空着」。
   */
  addBot(seat: number): Promise<boolean> {
    return this.#request(`/api/tables/${this.code}/bot`, {
      method: 'POST',
      body: JSON.stringify({ seat })
    }).then((p) => p !== null);
  }

  /** 请机器人离座：离座语义（本副停在空座上等补位），身份随之删除、名字可复用 */
  removeBot(seat: number): Promise<boolean> {
    return this.#request(`/api/tables/${this.code}/bot?seat=${seat}`, { method: 'DELETE' }).then(
      (p) => p !== null
    );
  }

  /** 改名字：凭据串随名字重签，必须写回 localStorage，否则旧串当场失效 */
  async rename(name: string): Promise<string | null> {
    const payload = (await this.#request('/api/auth/rename', {
      method: 'POST',
      body: JSON.stringify({ name })
    })) as { name?: string; credential?: string } | null;
    if (payload?.credential) saveCredential(payload.credential);
    return payload?.name ?? null;
  }

  /** 换身份：粘贴另一条凭据串（在座时服务端会拒绝，必须先离座） */
  async switchIdentity(credential: string): Promise<boolean> {
    const payload = (await this.#request('/api/auth/claim', {
      method: 'POST',
      body: JSON.stringify({ credential })
    })) as { credential?: string } | null;
    if (payload?.credential) saveCredential(payload.credential);
    return payload !== null;
  }

  /**
   * 叫牌。`quiet` 只给「委托不叫」的代按用（ADR-0029）：同一个方法、
   * 同一条服务器权威路径，区别只有失败时不往页头写红字。
   */
  bid(call: BidCall, options: { quiet?: boolean } = {}): Promise<boolean> {
    return this.send({ type: 'bid', call }, options);
  }

  bury(): Promise<boolean> {
    return this.send({ type: 'bury', cards: this.selectedCards });
  }

  play(): Promise<boolean> {
    return this.send({ type: 'play', cards: this.selectedCards });
  }

  /**
   * 认赢（ADR-0028）：只说「我要认」—— 亮牌、末轮张数与成立与否都由引擎在服务端当场判，
   * 成立这一副就结束，不成立会回一句人话（「剩下的牌你还赢不完全」）。
   */
  claim(): Promise<boolean> {
    return this.send({ type: 'claim' });
  }

  deal(): Promise<boolean> {
    return this.send({ type: 'deal' });
  }

  newGame(): Promise<boolean> {
    return this.send({ type: 'newGame' });
  }
}
