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
            '三个人，**一打二**，类似斗地主。',
            '每一副牌的目的是得分，只有 **5、10、K** 是分牌，其中 5 记 5 分、10 和 K 均记 10 分。',
            '每一种花色 **25 分**，四个花色共 100 分，两张王不算分。'
          ],
          widget: { kind: 'point-values' },
          quiz: [
            {
              title: '小测 1 算分',
              questions: [
                single(
                  'p-what-1',
                  '这五张一共值多少分？',
                  [
                    { id: 'a', text: '15 分', correct: false, why: '只算了 ♥5 与 ♠10 —— ♦K 也是 10 分。' },
                    { id: 'b', text: '25 分', correct: true, why: '♥5 5 + ♠10 10 + ♦K 10 = 25；大王与 ♠A 一分不值。' },
                    { id: 'c', text: '35 分', correct: false, why: '只有 5、10、K 是分牌：大王再大也不算分。' },
                    { id: 'd', text: '45 分', correct: false, why: '大王和 ♠A 都是 0 分 —— 分值只看牌面是不是 5、10、K。' }
                  ],
                  {
                    cards: ['H5', 'S10', 'DK', 'j1', 'SA'],
                    note: '这一手捏着全场四分之一。'
                  }
                ),
                tf('p-what-2', '四种花色各有 25 分，加起来正好 100 分。', true, {
                  yes: '每门的 5、10、K 合起来 25 分，四门 100 —— 两张王不在这一百里面。',
                  no: '每门都有 5、10、K 各一张：5 + 10 + 10 = 25，四门合起来正是 100。'
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
            '谁坐庄不是派好的，是**叫**出来的：40 分起，每次至少加 5 分。',
            '同分比花色：♣ < ♦ < ♥ < ♠ < **NT**（无主）—— 40♦ 压过 40♣。',
            '叫得最高的那家坐庄，他叫的分就是**及格线**：抓不够就算输。',
            '两家连着不叫就成交；三家都不叫，这副重发，谁也不亏。'
          ],
          widget: { kind: 'bid-demo' },
          quiz: [
            {
              title: '小测 2 叫牌',
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
                  '先分数后花色——花色序只在叫牌里用。'
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
            '成交那门**整门升格**为主牌：**双王 + 四张级牌 + 主打门的其余牌**。',
            '**级牌就是庄家的级别**：庄家 5 级，四张 5 全是级牌。',
            '座次从大到小：**大王 > 小王 > 主级 > 副级 > 主打门**。',
            '所以级牌 2、主打 ♠ 时，**♠2 压过 ♠A**；三张副级一样大，先出为大。'
          ],
          widget: { kind: 'trump-ladder' },
          quiz: [
            {
              title: '小测 3 主牌',
              questions: [
                tf('p-trump-1', '级牌 2、主打 ♠ 时，♠A 大过 ♠2。', false, {
                  yes: '♠2 是主级，压在 ♠A 之上。',
                  no: '♠2 是主级，压在 ♠A 之上——主打门里没有更大的。'
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
            '一家**领出**，两家跟：**同门、同张数** —— 领几张跟几张。',
            '这一轮的分**全归赢家**，含你自己摆进去的那几张。',
            '赢家领下一轮。想赢两条路：**同门压过**或**缺门杀牌**，其余都是垫牌。',
            '下一手**教练栏**会告诉你出哪张 —— 点别的牌，会被它指回来。'
          ],
          widget: { kind: 'point-places' },
          quiz: [
            {
              title: '小测 4 出牌',
              questions: [
                tf('p-play-1', '你的 ♥K 是这轮最大的牌，另外两家出的是 ♥5 和 ♥6 —— 这轮你得 10 分。', false, {
                  yes: '分是 5、10、K 一起算的：♥K 10 + ♥5 5 = 15 分全归赢家。',
                  no: '15 分**全归赢家**——你自己的 K 也算进去。'
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
            '这一副换你坐庄：一个人打两家，级牌按**你的级别**算。',
            '先把 3 张底牌拿进手（17 → 20），再扣 3 张回去 —— **第一次你自己说了算**。',
            '底牌是暗账：末轮你赢（**保底**）翻倍进账，输（**抠底**）翻倍扣回。',
            '**及格线就是你自己叫的分**：叫多高，就得抓多狠。'
          ],
          widget: { kind: 'bury-demo' },
          quiz: [
            {
              title: '小测 5 底牌',
              questions: [
                single(
                  'd-why-1',
                  '埋底 10 分、末轮每家 2 张 —— 末轮输了，扣多少？',
                  [
                    { id: 'a', text: '扣 20 分', correct: true, why: '抠底 = 底牌分 × 末轮每家张数 = 10 × 2。' },
                    { id: 'b', text: '扣 10 分', correct: false, why: '漏了末轮张数这一层倍率。' },
                    { id: 'c', text: '扣 5 分', correct: false, why: '倍率算反了：是 10 × 2，不是 10 ÷ 2。' },
                    { id: 'd', text: '不变', correct: false, why: '底牌分正是靠保底 / 抠底进出账的，末轮一输就扣。' }
                  ],
                  { note: '10 × 2 = 20 分扣掉；反过来就是保底的进项。' }
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
            '**同门压过**：多张时得压得过整条连牌，不是比最大那张。',
            '**缺门杀牌**：那门一张没有，甩同张数的主牌，这轮归你。',
            '其余都叫**垫牌** —— 出得再大也赢不了。',
            '最容易漏的半句：你摆进去的分，也**归赢家**。'
          ],
          widget: { kind: 'ruff-contrast' },
          quiz: [
            {
              title: '小测 6 赢墩',
              questions: [
                tf('x-trick-1', '主牌 ♦，对手甩 ♠K-Q —— 你的 ♥A-K 能赢。', false, {
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
            '不然谁都能大牌配小牌、拆散长套藏起来。'
          ],
          widget: { kind: 'follow-answer' },
          quiz: [
            {
              title: '小测 7 跟牌',
              questions: [
                single(
                  'x-follow-1',
                  '上家甩 ♣8-9-10-J 四张顺子。你手里 ♣ 有 3-4-6 和 Q-K（级牌 5 不在这门）—— 怎么跟？',
                  [
                    { id: 'a', text: '♣3-4-6 + ♣Q', correct: true, why: '结构优先：最长的那段先出，剩下的任配一张。' },
                    { id: 'b', text: '♣Q-K + ♣3-4', correct: false, why: '2 顺 + 2 顺的分解比 3 顺 + 1 张小，不是最大分解。' },
                    { id: 'c', text: '♣3-4 + 两张副牌', correct: false, why: '该门够 4 张，就必须全出这一门。' },
                    { id: 'd', text: '♣3-4-6 + ♠9', correct: false, why: '门里还有 ♣Q、♣K 没出，必须先出完这一门。' }
                  ],
                  { note: '分解取最大：3 顺 + 1 张 > 2 顺 + 2 顺。' }
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
            '副牌里**级牌那一点不算数**：级牌 5 时，♣3-4-6 就是合法三顺（♣5 缺位）。',
            '主牌只看**座次**：级牌 5、主打 ♥ 时，♥Q-K-A-♠5-♥5 是一条五顺。',
            '一条主牌顺子里**最多带一张副级** —— 三张副级一样大，凑不出连续。'
          ],
          widget: { kind: 'side-suit' },
          quiz: [
            {
              title: '小测 8 顺子',
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
            '叫到 **NT**（无主）就没有主打门：主牌只剩**四张级牌 + 双王**，级牌 5 时一共 6 张。',
            '四张级牌在无主里**完全相等**：碰上先出为大。',
            '同分时 **NT 最大**；主牌这么少，拼的就是各门的大牌。'
          ],
          widget: { kind: 'trump-groups' },
          quiz: [
            {
              title: '小测 9 无主',
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
            '打成：按**最终得分**查表升级 —— 叫分只是及格线。',
            '打输：庄家原地不动，两家闲家各升 **⌈差 ÷ 10⌉** 级。',
            '爬完 A 套圈回 2(+1)；两位到 2(+2) 或一位到 2(+3)，整场结束。'
          ],
          widget: { kind: 'upgrade-table' },
          quiz: [
            {
              title: '小测 10 算账',
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
            '往上叫只有一个理由：**把庄家位抢过来** —— 还得这门够长、打得动。',
            '牌不好就**不叫**：三家不叫只是重发，一分不亏。',
            '**埋伏**：握着长主牌先让他坐庄，埋完底你缺门杀分。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-bury',
          title: '埋底：把钱压在箱底',
          points: [
            '埋**断门**：一整门埋空，谁领这门你都能杀。',
            '埋**分**：保底翻倍进，抠底翻倍扣。',
            '主牌硬就埋分等翻倍；主牌薄就埋没分的短门，换个缺门。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-lead',
          title: '领出：把长的先打出去',
          points: [
            '连着领最占便宜：甩一条四连，对手凑不出就只能垫。',
            '**清主**：连领主牌把它逼光 —— 他若只剩主牌，**双王也得交出来**。',
            '反过来记着：手里的长顺别在中盘拆散，那是末轮的本钱。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-last',
          title: '末轮：保底与抠底的攻防',
          points: [
            '末轮定底牌账，之前要**留一手能赢的牌**：庄保底、闲抠底。',
            '闲家抠底先逼主：连领副牌顺子逼他盖，主牌一空，末轮扣他的底。',
            '逼主有成本：甩出去的顺子带着分、又大不过，就是白送 —— 先逼主，再领分。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-count',
          title: '记牌：只记三个数',
          points: [
            '主牌有数：有主 18 张、无主 6 张 —— 谁出了几张，外面还剩几张。',
            '一门里缺的那张，多半在对手手里 —— 这是**推断**，不是猜。',
            '**三个数**：剩几张主、哪门断了、分进了谁的账。'
          ]
        },
        {
          kind: 'brief',
          id: 'h-check',
          title: '收个尾：直觉四连问',
          points: [
            '四条直觉：**抢庄才抬价**、**埋断门挑没分的**、**长顺留末轮**、**闲家记三个数**。',
            '四道小题一条一问 —— 答错不扣分，解释就在选项里。'
          ],
          quiz: [
            {
              title: '小测 11 直觉',
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
