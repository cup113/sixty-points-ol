<script lang="ts">
  import { rankLabel, type PublicView } from '@sixty/engine';
  import { isRedStrain, strainGlyph } from '$lib/labels';

  let {
    view,
    onReviewTrick
  }: {
    view: PublicView;
    /** 「上一轮」回看入口：传入才渲染（内容见 `TrickReview`；不传时这一块仍是纯信息须） */
    onReviewTrick?: () => void;
  } = $props();

  const deal = $derived(view.deal);
  const contract = $derived(deal?.contract ?? null);
  const trump = $derived(deal?.trump ?? null);
  /** 收过墩才有「上一轮」可回看（还没打过牌、或换副重发的当口都没有） */
  const canReview = $derived(onReviewTrick !== undefined && (deal?.trickHistory.length ?? 0) > 0);
  const declarerPoints = $derived(
    contract === null ? 0 : (deal?.captured[contract.declarerSeat]?.points ?? 0)
  );

  /**
   * 数字一律**大号金色**（打牌时决定进退的就是这几个数），标签是压在它们上面的一行小字。
   * 单位（「分」）留在值里而不是表头里：表头写「庄已抓 分」读起来像一句话说了一半。
   */
  const num = 'text-xl font-black leading-none tabular-nums text-gold sm:text-2xl';
  /**
   * 表头那行小字：**11px 是可读下限**（早先 10px，手机上偏小）。它比值的字号小两档以上，
   * 所以加大 1px 不会与值抢视线 —— 而它是这张表的**唯一说明**（`定约 / 级牌 / 庄已抓`
   * 三个词本身没有别的解释），读不清就等于表头不存在。
   *
   * `pt-1.5 pb-0.5` 是**上边距**：早先上下都只有 2px（`py-0.5`），第一行贴着整块的圆角边线
   * 读起来很挤（真机截图反馈）。现在上面 6px、下面与值那一格的 `pb-1.5` 对齐成 6px。
   * `w-14` 是每一列的**下限**（56px）：表格是 auto 布局 + 定宽，多出来的宽度按内容分配，
   * 所以这一档只保证最窄的「级牌」列不至于被挤成一个数字的宽度。
   */
  const head = 'w-14 whitespace-nowrap pt-1.5 pb-0.5 text-[11px] font-normal leading-none text-white/45';
  /**
   * 值那一格的内边距：四周都留一点余量（`px-2 pt-1 pb-1.5`）——
   * 数字是这一条上最大最亮的东西，贴着格子边线会显得挤（表头那行的小字不必跟着放宽，
   * 它本来就是陪衬）。整块定宽之后这一档内边距不再撑宽整条（见下面「宽度」那一段）。
   *
   * 横向是 `px-2`（8px）而不是更宽：`shot-auction.ts` 的 ⑭b 量过每一格的余量，
   * 桌面场景里最紧的「回溯」格只剩 **0.0px** —— 而定宽必须容得下最宽的内容
   * （`100♣` + `100 分`，见 `app.css` 的 `--rail-w`），每格省 4px 正好把这笔余量让出来。
   *
   * `whitespace-nowrap`：**不许把「分」折到第二行**（真机截图反馈：`25` 下面单独一行「分」）。
   * 折行的后果不只是难看 —— 它会让那一行整行变高，整块跟着长高。这一格的宽度由
   * 定宽 + auto 布局的余量给出，余量不够时宁可让那 8px 的内边距先被吃掉，
   * 也不许换行；「内容到底放不放得下」由 `shot-auction.ts` 的 ⑭b 当场量
   * （不换行时需要多宽 vs 这一格真有多宽），所以 nowrap 不会把问题藏起来。
   */
  const cell = 'whitespace-nowrap px-2 pb-1.5 pt-1 text-center align-middle';
  /**
   * 回溯那一格里的按钮：**两种状态都在**（`canReview` 只决定它能不能点）。
   *
   * 为什么要留一颗灰的：第一轮还没收墩时，那一格若整格空着，四列表格里就缺了一角
   * （「空出一块太怪」）。灰按钮同时说明了「这里能做什么」与「现在还不能做」——
   * 它没坏，只是还没到时候。
   */
  const reviewOn =
    'pointer-events-auto whitespace-nowrap rounded-full border border-gold/40 px-1.5 py-0.5 text-[11px] font-bold text-gold hover:bg-gold/10';
  const reviewOff =
    'whitespace-nowrap rounded-full border border-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white/30';
</script>

<!-- 牌桌**顶端的信息须**（ADR-0020 修订）：毡面的第一行，横贯内宽、**类表格**四列 ——
     表头 `回溯 / 定约 / 级牌 / 庄已抓`，值在下面一行。

     为什么是表格而不是三枚并排的药丸（那是上一版）：
     ① **标签上移，横向反而更窄**。药丸版把标签与数字挤在同一行：`庄已抓 0 分` 一枚就要 100px，
        三枚加起来实测 278px —— 而 320px 机型的内宽只有 272px，于是最右那枚被挤成两行
        （实测截过：320px 上「庄已抓」竖排成两行）。标签独占一行小字之后，值只剩下数字本身。
     ② 它读起来是一个**计分牌**，而不是三块浮在空绿区里的孤岛：四列有竖线、上下两行、
        整块有描边与底色，与毡面底部那条同样是限宽居中的「我」底栏形成上下呼应。
     ③ **级牌独立成列**（早先它并进定约那枚写成 `40♣ · 2`）：它决定「哪张牌是主」，
        答案就是「点数」两个字，值只写 `2` —— 有自己的列，不必再靠 `·` 粘连。

     四条纪律：
     - 它**是一行，不是一层**：不写任何偏移，位置由毡面的 `data-felt-row="rail"` 给出；
     - 没有定约（大厅 / 叫牌阶段）时整块不渲染，但那一格始终在（行的顺序恒定）；
     - 它**不是**座位卡的一部分，也不属于内容槽：它是台面级信息（定约、级牌、进度、回看入口），
       内容槽因此只剩「打这一墩」的东西，牌区上方不再悬着任何层；
     - 纯信息须（除了回看入口没有一个可点元素）⇒ 整体 `pointer-events-none`：
       它与座位卡同处毡面，窄屏上会盖住座位卡上的动作按钮（「+ 机器人」/「请离」）。
       唯一的例外是那枚回看入口，它自己 `pointer-events-auto` 把点击接回来 ——
       少了那一句，按钮会看得见点不到（BuryPanel 记过这个坑）。

     **宽度取自毡面的那一个尺度（`--rail-w`，app.css）**，与底部「我」那条底栏**同一个值**：
     两块一上一下、同宽同居中，读起来才是同一个台面框，而不是两块各按内容撑开的浮块
     （早先本块由内容撑到 229–238px，而底栏固定在 256px：两者差 18–27px，上下框对不齐）。
     那个尺度**跟着数字长大**：`sm` 断点上值那一档从 `text-xl` 变成 `text-2xl`，同一个断点上
     尺度从 16rem（256px）变成 18rem（288px）—— 因为「放得下最宽的内容」是按数字字号算的
     （`100♣ / 100 分` 在 24px 下要约 272px，见 app.css 里那笔账）。
     定宽同时也**治住了折行**：auto 布局把余量按列分掉，四列永远在一行里。
     代价是毡面内宽的下限跟着走：基准档 256px ⇒ 视口下限约 304px
     （256 + 毡面 24 + 页面 24），而 320px 是项目实测的最低机型。

     为什么删掉了「第 N 轮」：它在这里没有信息量（打到第几轮由毡面上那墩牌自己说明，
     而唯一需要说清轮次的地方是**回看浮层**的标题「上一轮 · 第 N 轮」，见 TrickReview）。

     钩子：`data-info-rail`（整块）、`data-rail-cell="review|contract|level|points"`（四个值格），
     供 `scripts/shot-auction.ts` 实测「整块居中、与底栏同宽、各格都落在毡面内、互不相叠」。 -->
{#if contract !== null}
  <table
    data-info-rail="true"
    class="pointer-events-none mx-auto w-[var(--rail-w)] border-separate border-spacing-0 overflow-hidden rounded-xl bg-black/35 ring-1 ring-white/10"
  >
    <thead>
      <tr>
        <th scope="col" class={head}>回溯</th>
        <th scope="col" class={`${head} border-l border-white/10`}>定约</th>
        <th scope="col" class={`${head} border-l border-white/10`}>级牌</th>
        <th scope="col" class={`${head} border-l border-white/10`}>庄已抓</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td data-rail-cell="review" class={cell}>
          <!-- 收过墩才**能点**（`canReview`），但按钮一直在：第一轮那颗灰按钮既是占位，
               也预告了「这里能回看上一轮」——整格空着会让四列表格缺一角。
               bot 出手只有 0.5–1.5 秒，收墩后赢家立刻领出下一轮，所以这一格是回看入口
               （浮层见 TrickReview）。 -->
          <button
            type="button"
            class={canReview ? reviewOn : reviewOff}
            disabled={!canReview}
            onclick={() => onReviewTrick?.()}>上一轮</button
          >
        </td>
        <td data-rail-cell="contract" class={`${cell} border-l border-white/10`}>
          <b class={num}>
            {contract.points}<span class={isRedStrain(contract.strain) ? 'text-rose-300' : ''}>{strainGlyph(
              contract.strain
            )}</span>
          </b>
        </td>
        <td data-rail-cell="level" class={`${cell} border-l border-white/10`}>
          <b class={num}>{trump === null ? '—' : rankLabel(trump.rank)}</b>
        </td>
        <td data-rail-cell="points" class={`${cell} border-l border-white/10`}>
          <b class={num}>{declarerPoints}</b><span class="ml-0.5 text-[11px] text-white/60">分</span>
        </td>
      </tr>
    </tbody>
  </table>
{/if}
