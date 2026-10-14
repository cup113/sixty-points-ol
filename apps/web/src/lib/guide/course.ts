/**
 * 新手引导的课程目录（ADR-0025）：**结构 + 内容**，一副引导局都不含。
 *
 * 五条规矩（guide-v3 重塑）：
 * - **这是一出五幕剧，不是一本教材**：概念跟着牌走 —— 叫牌的最小知识就在第一副叫牌前一屏，
 *   主牌的座次就在成交后一屏，结算的账就在你亲手埋过底之后才讲。没有一幕是「先读完再玩」；
 * - **每屏一口气读完**：要点 3–4 条、短句、对「你」说话；标题是钩子，不是分类名（没有「6.1」这种编号）；
 * - **测验是「试一下」，不是考试**：一屏至多一组、组里两三题，答对才放行的门槛语义不变，
 *   但门本身从四到六题的判断墙收窄成一口气 —— 答错的纠偏仍住在每个选项的解释里；
 * - 概念段的示例一律复用 `tutorial/scenarios.ts`（那里每个牌面都被引擎核对过），不新造第二份事实；
 *   引导局只在步里写 slug 与段（`auction` / `play` / `all`），牌面与动作全部来自 `guide/deals/<slug>.ts`；
 * - **深链一个都不断**：v3 重组吸收掉的**全部**旧步 id（旧 quiz 步 + 被合并的旧简述步）都登记在文末
 *   `GUIDE_ALIASES`，测试拿 v2 的完整 id 清单核对这张账 —— 漏一个就是红。
 *
 * 文案口径（与 `/rules`、牌桌「?」共用同一套术语）：叫品写 `40♣`、无主写 `NT`（**叙述句**里写「无主」）；
 * 牌一律带字形（`♣J-Q-K-A`、`♥5-6-7`、`小王`）；凡依赖级牌点数的例子，就地写明「级牌 5」这种前提。
 */
import type { GuideCourse, QuizQuestion, QuizOption } from './types.ts';

/**
 * 判断题的两个选项：对 / 错。`whys.yes` 是「选了对」时要给的那句、`whys.no` 是「选了错」时要给的那句 ——
 * 所以不论正确答案是哪一边，两句都各就各位：答错时给的就是所选那一项的解释。
 */
function tf(
  id: string,
  statement: string,
  correct: boolean,
  whys: { readonly yes: string; readonly no: string },
  note?: string
): QuizQuestion {
  const options: QuizOption[] = [
    { id: 'yes', text: '对', correct, why: whys.yes },
    { id: 'no', text: '错', correct: !correct, why: whys.no }
  ];
  return { id, kind: 'truefalse', prompt: statement, options, ...(note === undefined ? {} : { note }) };
}

/** 单选题：`options` 里恰好一个 `correct`，每项都要有解释 */
function single(
  id: string,
  prompt: string,
  options: readonly QuizOption[],
  extra?: { readonly cards?: readonly string[]; readonly note?: string }
): QuizQuestion {
  return {
    id,
    kind: 'single',
    prompt,
    options,
    ...(extra?.cards === undefined ? {} : { cards: extra.cards }),
    ...(extra?.note === undefined ? {} : { note: extra.note })
  };
}

/** 多选题：至少两个正确项、至少一个错项 */
function multi(
  id: string,
  prompt: string,
  options: readonly QuizOption[],
  note?: string
): QuizQuestion {
  return { id, kind: 'multi', prompt, options, ...(note === undefined ? {} : { note }) };
}

export const COURSE: GuideCourse = {
  id: 'guide-v3',
  title: '六十分新手引导',
  chapters: [
    /* ── 第一幕 · 上桌：两屏讲解就叫牌，第一副真牌热身 ─────────────── */
    {
      id: 'act-1',
      title: '上桌',
      blurb: '两屏讲解就叫牌，第一副真牌热身',
      steps: [
        {
          kind: 'brief',
          id: 'p-what',
          title: '整副牌里只有 100 分',
          points: [
            '六十分是三个人的牌局：**一个人坐庄，另外两个结伙跟他抢分**。你先当抢的那边，第二幕再换你坐庄。',
            '一副牌里值钱的只有三种牌：**5、10、K** —— 5 记 5 分，10 和 K 各记 10 分。两个王看着威风，一分不值：它们管大小，不管分。',
            '四张 5、四张 10、四张 K 加起来正好 **100 分**。全场就这么多，打完谁抓得多，谁的日子就好过。',
            '怎么抢？发牌 → 叫牌定庄家 → 出牌抓分 → 结算升级。接下来几屏，这四步你会**亲手**全部走一遍。'
          ],
          widget: { kind: 'point-values' },
          quiz: [
            {
              title: '试一下：分在哪儿',
              questions: [
                single(
                  'p-what-1',
                  '桌上摆着这五张，一共值多少分？',
                  [
                    { id: 'a', text: '15 分', correct: false, why: '5 + 10 = 15，但 K 也是 10 分，漏了它。' },
                    { id: 'b', text: '20 分', correct: false, why: '10 与 K 各 10 分，再加那张 5，应当是 25。' },
                    { id: 'c', text: '25 分', correct: true, why: '♣K 10 + ♠10 10 + ♥5 5 = 25。' },
                    { id: 'd', text: '30 分', correct: false, why: '这五张里只有三张分牌，凑不出 30。' }
                  ],
                  {
                    cards: ['H5', 'S10', 'CK', 'D3', 'H9'],
                    note: '25 分 —— 全场 100 分，这一手就捏着四分之一。'
                  }
                ),
                tf('p-what-2', '小王是全场最值钱的牌。', false, {
                  yes: '王一分不值 —— 它管的是谁大谁小，分永远只在 5、10、K 上。',
                  no: '王再大也不值分：分只认 5、10、K 三种点数。'
                })
              ]
            }
          ]
        },
        {
          kind: 'brief',
          id: 'p-bid',
          title: '叫牌：把你想主打的那门拍在桌上',
          points: [
            '谁坐庄不是定的，是**叫**出来的：从 **40 分**起叫，每次至少加 5。',
            '分数一样时比花色：♣ < ♦ < ♥ < ♠ < 无主（记作 **NT**）。所以想压过 40♣，叫 40♦ 就够了，不必喊 45。',
            '叫到最高的那家坐庄。他叫的分数就是他这副的**及格线**：抓不够，这副算他输。',
            '连续两家不叫就成交；三家都不叫，这副作废重发，谁也不吃亏。'
          ],
          widget: { kind: 'bid-demo' },
          quiz: [
            {
              title: '试一下：谁压得过谁',
              questions: [
                multi(
                  'p-bid-1',
                  '下面哪些叫品压得过 40♣？',
                  [
                    { id: 'a', text: '40♦', correct: true, why: '同分比花色，♦ 在 ♣ 之上。' },
                    { id: 'b', text: '45♣', correct: true, why: '分数高一档，花色就无所谓了。' },
                    { id: 'c', text: '40NT', correct: true, why: '同分时居首的是无主。' },
                    { id: 'd', text: '35NT', correct: false, why: '分数低于 40，这个叫品根本叫不出口。' },
                    { id: 'e', text: '40♣', correct: false, why: '与当前叫品完全相同，不算更大。' }
                  ],
                  '先比分数，分数一样再比花色 —— 花色序只在叫牌里用，打牌时不用它。'
                )
              ]
            }
          ]
        },
        {
          kind: 'deal',
          id: 'p-auction',
          title: '第一副 · 跟着教练叫牌',
          slug: 'defender-01',
          segment: 'auction'
        },
        {
          kind: 'brief',
          id: 'p-trump',
          title: '主牌：一支排好座次的队伍',
          points: [
            '刚才那副叫完，主打的那门**整门**升级成了主牌。主牌一共三拨：**双王、四张级牌、主打那门的其余牌**。',
            '级牌跟庄家走：庄家级别是 5，四张 5 就都是级牌 —— 换个人坐庄，级牌就换一批。',
            '座次从大到小：**大王 > 小王 > 主级 > 副级 > 主打那门的其余**。主级是主打门里那张级牌，副级是另外三张。',
            '所以级牌 2、主打 ♠ 时，♠2 压得过 ♠A —— 级牌被提到了整门之上。唯一的例外：三张副级完全相等，先出的那张算大。'
          ],
          widget: { kind: 'trump-ladder' },
          quiz: [
            {
              title: '试一下：座次怎么排',
              questions: [
                tf('p-trump-1', '级牌 2、主打 ♠ 时，♠A 大过 ♠2。', false, {
                  yes: '♠2 是主级，位置在副级之上、更在 ♠A 之上；主打门里没有哪张牌压得过它。',
                  no: '♠2 是主级，压在 ♠A 之上 —— 主打门里没有哪张牌大得过它。'
                }),
                tf('p-trump-2', '两张副级相遇，先出的那张赢。', true, {
                  yes: '三张副级完全相等，先出为大 —— 主牌里唯一要记的例外。',
                  no: '两张副级完全相等，谁也不压谁：先出的那张算大。'
                })
              ]
            }
          ]
        },
        {
          kind: 'brief',
          id: 'p-play',
          title: '出牌：一轮的三条规矩',
          points: [
            '一轮 = 三家各出一次：一家**领出**，另外两家跟。**跟牌要同门、同张数** —— 领一张跟一张，领一条顺子就得凑出同样的张数。',
            '这一轮里的 5、10、K **全归赢家** —— 包括你自己摆进去的那张分牌。',
            '下一轮由赢家领出。想赢只有两条路：同门里出更大的，或者缺门时甩主牌杀 —— 这两条打完这副再细拆。',
            '接下来这副的每一手都由**教练栏**带着打：桌面下方那条金框说该出哪几张、为什么；点别的牌会被指回来 —— 那不是你出错，是它在带路。'
          ],
          widget: { kind: 'lead-cases' },
          quiz: [
            {
              title: '试一下：这一轮归谁',
              questions: [
                tf('p-play-1', '你的 ♥K 是这轮最大的牌，另外两家出的是 ♥5 和 ♥6 —— 这轮你得 10 分。', false, {
                  yes: '分是 5、10、K 一起算的：♥K 10 + ♥5 5 = 15 分全归赢家。',
                  no: '♥K 10 + ♥5 5 = 15 分**全归赢家** —— 你自己出的那张 K 也算进这一轮。'
                })
              ]
            }
          ]
        },
        {
          kind: 'deal',
          id: 'p-play-deal',
          title: '第一副 · 一轮一轮打下去',
          slug: 'defender-01',
          segment: 'play'
        },
        { kind: 'review', id: 'p-review', title: '第一副 · 复盘', slug: 'defender-01' }
      ]
    },

    /* ── 第二幕 · 坐庄：多三张牌，多一道坎 ───────────────────────── */
    {
      id: 'act-2',
      title: '坐庄',
      blurb: '埋底与及格线，一副打完',
      steps: [
        {
          kind: 'brief',
          id: 'd-why',
          title: '坐庄：多三张牌，多一道坎',
          points: [
            '这一副换你坐庄：一个人打两家，本副级牌按**你的级别**算。',
            '庄家多一道手续：先把 3 张底牌拿进手里（17 → 20），再扣 3 张回去。**扣哪三张，是你这副第一个自己说了算的决定。**',
            '扣下的底牌是一笔暗账：最后一轮你赢了（**保底**），底牌分按末轮张数翻倍进账；输了（**抠底**），同样一笔翻倍扣回。',
            '你的及格线就是自己叫的分 —— 叫得越高，这副越要抓得动。'
          ],
          widget: { kind: 'bury-demo' },
          quiz: [
            {
              title: '试一下：底牌这笔账',
              questions: [
                single(
                  'd-why-1',
                  '你埋的底牌共 10 分，最后一轮每家出 2 张。最后一轮**输了**，你的最终得分怎么变？',
                  [
                    { id: 'a', text: '扣 20 分', correct: true, why: '抠底 = 底牌分 × 末轮每家张数 = 10 × 2。' },
                    { id: 'b', text: '扣 10 分', correct: false, why: '漏了末轮张数这一层倍率。' },
                    { id: 'c', text: '扣 5 分', correct: false, why: '倍率算反了：是 10 × 2，不是 10 ÷ 2。' },
                    { id: 'd', text: '不变', correct: false, why: '底牌分正是靠保底 / 抠底进出账的，末轮一输就扣。' }
                  ],
                  { note: '10 × 2 = 20 分从账上扣掉；同一笔账反过来就是保底时的进项。' }
                )
              ]
            }
          ]
        },
        {
          kind: 'deal',
          id: 'd-deal',
          title: '第二副 · 从叫牌打到结算',
          slug: 'declarer-01',
          segment: 'all'
        },
        { kind: 'review', id: 'd-review', title: '第二副 · 复盘', slug: 'declarer-01' }
      ]
    },

    /* ── 第三幕 · 底细：赢墩、跟牌、顺子、无主、算账 ─────────────── */
    {
      id: 'act-3',
      title: '底细',
      blurb: '赢墩、跟牌、顺子、无主、算账',
      steps: [
        {
          kind: 'brief',
          id: 'x-trick',
          title: '想赢一轮，只有两条路',
          points: [
            '第一条路：**同门压过** —— 同一门里出更大的牌。多张时要压得过整条连牌，不是比最大那张。',
            '第二条路：**缺门杀牌** —— 领出的那门你一张都没有，甩出**同张数、还连着**的主牌，这轮就是你的。',
            '其余全算**垫牌**：不同门、不连续、张数不对 —— 垫牌出得再大，也赢不了这一轮。',
            '最容易漏的半句：一轮的分**全归赢家**，你自己摆进去的分也一起归他。'
          ],
          widget: { kind: 'ruff-contrast' },
          quiz: [
            {
              title: '试一下：杀牌还是垫牌',
              questions: [
                tf('x-trick-1', '这一轮的主牌是 ♦，对手出了 ♠K-Q，你用 ♥A-K 能赢。', false, {
                  yes: '♥A-K 既不是 ♠ 门、也不是主牌（主牌是 ♦），只能算垫牌。',
                  no: '要赢只能是 ♠ 门里更大的排法，或缺门时用主牌杀；♥A-K 两头都不占，是垫牌。'
                }),
                tf('x-trick-2', '手里有领出那门的牌，也可以改甩主牌杀。', false, {
                  yes: '该门有牌就必须先出该门 —— 缺门才谈得上杀。',
                  no: '该门有牌就必须先出该门；缺门才谈得上杀牌。'
                })
              ]
            }
          ]
        },
        {
          kind: 'brief',
          id: 'x-follow',
          title: '跟牌不是随便挑：结构优先',
          points: [
            '该门够张数，就必须**全出这一门**，一张副牌都不能垫。',
            '门里只要还有连牌，就必须先拿出**最长的那段**，剩下的才能自由配。',
            '为什么这么死板？不然谁都能拿大牌配小牌，把长套拆散藏起来 —— 跟牌就成了自由市场。'
          ],
          widget: { kind: 'follow-answer' },
          quiz: [
            {
              title: '试一下：这一手怎么跟',
              questions: [
                single(
                  'x-follow-1',
                  '上家领出 ♣8-9-10-J 四张顺子。你手里 ♣ 有 3 顺（♣3-4-6，级牌 5 不在这一门）和 2 顺（♣Q-K）。该怎么跟？',
                  [
                    { id: 'a', text: '♣3-4-6 + ♣Q', correct: true, why: '结构优先：最长的那段先出，剩下的任配一张。' },
                    { id: 'b', text: '♣Q-K + ♣3-4', correct: false, why: '2 顺 + 2 顺的分解比 3 顺 + 1 张小，不是最大分解。' },
                    { id: 'c', text: '♣3-4 + 两张副牌', correct: false, why: '该门够 4 张，就必须全出这一门。' },
                    { id: 'd', text: '♣3-4-6 + ♠9', correct: false, why: '门里还有 ♣Q、♣K 没出，必须先出完这一门。' }
                  ],
                  { note: '连续段的分解要字典序最大：3 顺 + 1 张 大于 2 顺 + 2 顺。' }
                )
              ]
            }
          ]
        },
        {
          kind: 'brief',
          id: 'x-runs',
          title: '顺子的三条细则',
          points: [
            '细则一：副牌的一门里，**级牌那个点数不在** —— 级牌 5 时 ♣4 的下一张就是 ♣6，♣3-4-6 是合法三顺。看着「缺一张」的连牌，往往正好能出。',
            '细则二：主牌不分花色、只看座次 —— 级牌 5、主打 ♥ 时，♥Q-K-A-♠5-♥5 是一条合法五顺。跨花色不碍事，顺序才是真的。',
            '细则三：一条主牌顺子里**最多带一张副级** —— 三张副级完全相等，凑不出连续。'
          ],
          widget: { kind: 'side-suit' },
          quiz: [
            {
              title: '试一下：连不连',
              questions: [
                tf('x-runs-1', '级牌 5 时，♠5-♣5-♦5 是一条三顺。', false, {
                  yes: '三张副级完全相等，彼此不构成相邻。',
                  no: '三张副级彼此完全相等，凑不出连续 —— 它们不是顺子。'
                }),
                tf('x-runs-2', '主打 ♥、级牌 5 时，♥3-4-6 在主牌里也是三顺。', true, {
                  yes: '主牌按座次相邻：♥5 是主级，位置更高，不在 ♥4 与 ♥6 之间。',
                  no: '主牌座次里 ♥4 的下一张就是 ♥6（♥5 被提到了主级那一层），所以它们相邻。'
                })
              ]
            }
          ]
        },
        {
          kind: 'brief',
          id: 'x-nt',
          title: '无主：谁都别想靠一门称王',
          points: [
            '叫到 **NT**（无主）就没有主打门：主牌只剩**四张级牌 + 双王** —— 级牌 5 时一共 6 张。',
            '四张级牌在无主里完全相等，碰上先出为大。',
            '同一个分数上 NT 是最大的叫品。主牌少，谁也没法靠一门长主牌压制谁 —— 无主局拼的是各门里的大牌。'
          ],
          widget: { kind: 'trump-groups' },
          quiz: [
            {
              title: '试一下：无主局',
              questions: [
                tf('x-nt-1', '无主时谁都不许出王。', false, {
                  yes: '王永远是主牌，随时能出，也能当杀牌用。',
                  no: '双王在任何一副里都是主牌 —— 无主局里它们照样最大。'
                })
              ]
            }
          ]
        },
        {
          kind: 'brief',
          id: 'x-score',
          title: '打完一副，怎么算账',
          points: [
            '最终得分 = 抓到的墩分 **± 底牌账**：保底加、抠底扣，底分 × 末轮每家张数。',
            '打成：庄家按**最终得分**查表升级 —— 只看得分，与叫了多少无关；叫分只是及格线。',
            '打输：两家闲家各升 ⌈差 ÷ 10⌉ 级。',
            '级别从 2 爬到 A，爬完 A 套圈回 2、记作 2(+1) —— 越级就是这么来的。两位爬到 2(+2)、或一位爬到 2(+3)，整场结束，总进度最高的是冠军。'
          ],
          widget: { kind: 'upgrade-table' },
          quiz: [
            {
              title: '试一下：算账',
              questions: [
                tf('x-score-1', '叫分越高，打成时升得越多。', false, {
                  yes: '升级只看最终得分，与叫分无关。',
                  no: '升级只看最终得分 —— 叫分只是及格线，不参与升级档位。'
                }),
                tf('x-score-2', 'A(+0) 之后再升一级是 2(+1)。', true, {
                  yes: '爬完 A 套圈回 2，轮数加一。',
                  no: 'A 之后回到 2，轮数 +1，记作 2(+1)。'
                })
              ]
            }
          ]
        }
      ]
    },

    /* ── 第四幕 · 直觉：老手的七条判断，一口气收尾 ───────────────── */
    {
      id: 'act-4',
      title: '直觉',
      blurb: '老手的七条判断，一口气收尾',
      steps: [
        {
          kind: 'brief',
          id: 'h-bid',
          title: '叫牌的两条直觉：抬价与埋伏',
          points: [
            '抬价的账要算清：叫牌是**明牌**，你一叫，对手就知道你想要哪门。往上叫的唯一理由是**把庄家位抢过来** —— 而且得是「这门够长、当庄也打得动」才叫。',
            '牌不好就**不叫**：三家不叫只是重发，一分不亏。硬抬一个凑不齐及格线的庄，输面全记在自己账上。',
            '**埋伏**是另一手棋：握着长主牌和分牌，先让对手坐庄 —— 等他埋完底，你缺门杀他的分。判据一句话：我当闲家是不是更赚？'
          ]
        },
        {
          kind: 'brief',
          id: 'h-bury',
          title: '埋底：把钱压在箱底',
          points: [
            '埋**断门**：把一门一张不留地埋空，之后谁领这门，你都能甩主牌杀。',
            '埋**分**：底牌分在保底时按末轮张数翻倍进账 —— 但末轮一被抠底，同样翻倍地扣回来。',
            '怎么选看主牌：主牌硬、末轮守得住，就把分埋进去等翻倍；主牌薄、底守不住，就埋没分的短门换缺门，别把 10、K 送进暗底。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-lead',
          title: '领出：把长的先打出去',
          points: [
            '同门连着领最占便宜：一次甩四张顺子，对手就得凑出四张的结构 —— 凑不出只能眼睁睁垫牌。',
            '**清主**就是连着领主牌顺子，把对手的主牌逼光：他们从此杀不动你的副牌。他手里若只剩主牌，**双王也得跟着交出来**。',
            '反过来记着：手里的长顺别在中盘拆散 —— 那是末轮的本钱。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-last',
          title: '末轮：保底与抠底的攻防',
          points: [
            '最后一轮的输赢决定底牌账，所以末轮之前要**留一手能赢的牌** —— 庄家留着保底，闲家留着抠底。',
            '当闲家想抠底，先逼光庄家的主牌：连着领副牌顺子，让他一次次用主牌盖。他主牌一空，末轮就是你扣他底分的时候。',
            '逼主有成本：甩出去的顺子若带着分，大不过就是白送 —— 先逼主、后领分，顺序别反。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-count',
          title: '记牌：只记三个数',
          points: [
            '主牌总共就那么多（有主 18 张、无主 6 张）：谁出了几张主，外面还剩几张，心里有数就行。',
            '一门里缺的那张，多半在对手手里 —— 这是**推断**，不是猜。',
            '三个数：还剩几张主、哪门已经断了、分都进了谁的账。记这三样，够你打到毕业以后。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-check',
          title: '收个尾：这五条直觉记住了几条',
          points: [
            '下面四道小题，每道都对应一条直觉 —— 答完就发最后两副的牌。',
            '答错不扣分：解释就写在选项里，读完再选一次就是。'
          ],
          quiz: [
            {
              title: '试一下：直觉对不对',
              questions: [
                tf('h-check-1', '抬价叫牌能把庄家位从对手手里抢过来。', true, {
                  yes: '抢庄家位是叫高的唯一理由 —— 没人再往上叫，庄家就是你。',
                  no: '叫高的作用就是把庄家位抢过来：没人再盖，这副你说了算。'
                }),
                tf('h-check-2', '手上那门不长时，硬抬一档总比不叫强。', false, {
                  yes: '三家不叫只是重发、级别不变，一分不亏 —— 凑不齐及格线的庄别抢。',
                  no: '全 pass 只是重发、一分不亏；抢一个打不动的庄，输面全在自己账上。'
                }),
                tf('h-check-3', '埋断门要挑没分的短门。', true, {
                  yes: '断门进的是暗底，被抠底会翻倍扣 —— 所以要挑没分的门断。',
                  no: '被抠底时底牌分按末轮张数翻倍扣，埋断门要挑没分的短门。'
                }),
                tf('h-check-4', '末轮之前把长顺拆开用掉，更容易保底。', false, {
                  yes: '长顺要留到末轮当保底牌 —— 拆了就没了。',
                  no: '保底靠的是末轮那一手能赢的牌：长顺留到最后。'
                })
              ]
            }
          ]
        }
      ]
    },

    /* ── 第五幕 · 毕业：最后两副真牌，打完开桌 ───────────────────── */
    {
      id: 'act-5',
      title: '毕业',
      blurb: '最后两副真牌，打完开桌',
      steps: [
        {
          kind: 'deal',
          id: 'g-deal2',
          title: '第三副 · 再坐庄：盯住你的底牌',
          slug: 'declarer-02',
          segment: 'all'
        },
        { kind: 'review', id: 'g-review2', title: '第三副 · 复盘', slug: 'declarer-02' },
        {
          kind: 'deal',
          id: 'g-deal3',
          title: '第四副 · 当闲家：等他主牌打光',
          slug: 'defender-02',
          segment: 'all'
        },
        { kind: 'review', id: 'g-review3', title: '第四副 · 复盘', slug: 'defender-02' },
        { kind: 'end', id: 'g-end', title: '毕业了' }
      ]
    }
  ]
};

/**
 * 深链别名（guide-v3 重组账本）：**全部**退役旧步 id → 内容最接近的新步 id。
 * v2 并屏吸收过一批 quiz 步，v3 又把概念屏并进了五幕结构 —— 两代退役的 id 都登记在这里，
 * 曾经分享出去的 `?s=c2-follow-single`、`?s=c6-block` 这类链接照样落在内容对应的那一屏。
 * 完整性由 `guide-course.test.ts` 拿 v2 的 id 清单核对：漏登记一个就是红。
 */
export const GUIDE_ALIASES: ReadonlyMap<string, string> = new Map(
  [
    // v2 的 quiz 步（并屏时吸收）
    ['c0-points-tf', 'p-what'],
    ['c0-points-count', 'p-what'],
    ['c0-turns-tf', 'p-play'],
    ['c1-bid-higher', 'p-bid'],
    ['c1-bid-meaning', 'p-bid'],
    ['c2-trump-tf', 'p-trump'],
    ['c2-ladder-tf', 'p-trump'],
    ['c2-trick-tf', 'x-trick'],
    ['c2-ruff-tf', 'x-trick'],
    ['c2-follow-single', 'x-follow'],
    ['c4-upgrade-tf', 'x-score'],
    ['c4-bury-single', 'd-why'],
    ['c4-nt-tf', 'x-nt'],
    ['c4-runs-side-tf', 'x-runs'],
    ['c4-runs-trump-tf', 'x-runs'],
    ['c6-strategy-tf', 'h-check'],
    // v3 重组时被合并 / 改名的简述步
    ['c0-points', 'p-what'],
    ['c0-turns', 'p-play'],
    ['c1-bid', 'p-bid'],
    ['c1-play-brief', 'p-play'],
    ['c2-trump', 'p-trump'],
    ['c2-ladder', 'p-trump'],
    ['c2-trick', 'x-trick'],
    ['c2-ruff', 'x-trick'],
    ['c2-follow', 'x-follow'],
    ['c3-intro', 'd-why'],
    ['c4-upgrade', 'x-score'],
    ['c4-bury', 'x-score'],
    ['c4-nt', 'x-nt'],
    ['c4-runs-side', 'x-runs'],
    ['c4-runs-trump', 'x-runs'],
    ['c6-block', 'h-bid'],
    ['c6-hold', 'h-bid'],
    ['c6-cut', 'h-bury'],
    ['c6-runs', 'h-lead'],
    ['c6-count', 'h-count'],
    ['c6-keep', 'h-last'],
    ['c6-drain', 'h-last'],
    // v3 改名的引导局 / 复盘 / 结尾步
    ['c1-auction', 'p-auction'],
    ['c1-play', 'p-play-deal'],
    ['c1-review', 'p-review'],
    ['c3-deal', 'd-deal'],
    ['c3-review', 'd-review'],
    ['c5-deal', 'g-deal2'],
    ['c5-review', 'g-review2'],
    ['c7-deal', 'g-deal3'],
    ['c7-review', 'g-review3'],
    ['c8-end', 'g-end']
  ] as const
);
