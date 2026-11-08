import { cardKey, type BidCall, type Card, type PublicView } from '@sixty/engine';
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
  selected = $state<string[]>([]);
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

  #apply(payload: StreamPayload): void {
    this.role = payload.role;
    this.view = payload.view;
    this.you = payload.you;
    this.table = payload.table;
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
      const reset = shouldResetSelection(this.#snapshot(), payload);
      this.#apply(payload);
      if (reset) this.selected = [];
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

  selectedCards = $derived.by(() => {
    const hand = this.you?.hand ?? [];
    return hand.filter((card) => this.selected.includes(cardKey(card)));
  });

  playError = $derived.by(() => {
    const view = this.view;
    const you = this.you;
    const deal = view?.deal;
    if (!view || !you || !deal || deal.phase !== 'play' || deal.trump === null) return null;
    if (deal.playTurn !== you.seat) return null;
    const cards = this.selectedCards;
    if (cards.length === 0) return null;
    const lead = deal.trick && deal.trick.plays.length > 0 ? deal.trick.plays[0]!.cards : null;
    return checkPlay({ hand: you.hand, trump: deal.trump, lead }, cards);
  });

  toggle(card: Card): void {
    const key = cardKey(card);
    this.selected = this.selected.includes(key)
      ? this.selected.filter((k) => k !== key)
      : [...this.selected, key];
  }

  clearSelection(): void {
    this.selected = [];
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
      this.selected = [];
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
