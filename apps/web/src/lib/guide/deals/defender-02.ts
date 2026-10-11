/**
 * 引导局数据（**生成物**，勿手改）：由 `pnpm --filter web guide` 从 `docs/guide/<slug>.json` 生成。
 *
 * 校验链见 `scripts/build-guide.ts`：结构 → 引擎重放 → 存证核对 → 引导词覆盖。
 * 手改这个文件会在 `guide:check` 与 `test/guide-generated.test.ts` 里报红。
 */
import type { GuideDealData } from '../types.ts';

export const DEFENDER_02: GuideDealData = {
  "version": 1,
  "slug": "defender-02",
  "title": "盯住庄家的主牌",
  "role": "defender",
  "learnerSeat": 0,
  "aliases": [
    "你",
    "阿凯",
    "小满"
  ],
  "source": {
    "table": "M64RMP",
    "dealNo": 4,
    "date": "2026-10-06"
  },
  "facts": {
    "hands": [
      [
        "j0",
        "C3",
        "S14",
        "D4",
        "D11",
        "D9",
        "C5",
        "C4",
        "C2",
        "C13",
        "H7",
        "H2",
        "D14",
        "D7",
        "D6",
        "H14",
        "H12"
      ],
      [
        "S8",
        "S7",
        "S6",
        "S5",
        "S11",
        "S10",
        "C8",
        "C7",
        "C6",
        "H10",
        "H9",
        "D2",
        "D12",
        "D8",
        "H3",
        "D10",
        "H6"
      ],
      [
        "S3",
        "D3",
        "S13",
        "S12",
        "S9",
        "S4",
        "C11",
        "C10",
        "C9",
        "C14",
        "H11",
        "H8",
        "D13",
        "H13",
        "D5",
        "H5",
        "j1"
      ]
    ],
    "originalKitty": [
      "C12",
      "S2",
      "H4"
    ],
    "dealerSeat": 1,
    "levels": [
      {
        "rank": 3,
        "cycle": 0
      },
      {
        "rank": 3,
        "cycle": 0
      },
      {
        "rank": 10,
        "cycle": 0
      }
    ],
    "dealNo": 4
  },
  "actions": [
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 40,
        "strain": "S"
      }
    },
    {
      "type": "bid",
      "seat": 2,
      "call": {
        "points": 40,
        "strain": "NT"
      }
    },
    {
      "type": "bid",
      "seat": 0,
      "call": {
        "points": 45,
        "strain": "D"
      }
    },
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 50,
        "strain": "C"
      }
    },
    {
      "type": "bid",
      "seat": 2,
      "call": "pass"
    },
    {
      "type": "bid",
      "seat": 0,
      "call": {
        "points": 50,
        "strain": "D"
      }
    },
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 50,
        "strain": "S"
      }
    },
    {
      "type": "bid",
      "seat": 2,
      "call": "pass"
    },
    {
      "type": "bid",
      "seat": 0,
      "call": {
        "points": 55,
        "strain": "D"
      }
    },
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 55,
        "strain": "S"
      }
    },
    {
      "type": "bid",
      "seat": 2,
      "call": "pass"
    },
    {
      "type": "bid",
      "seat": 0,
      "call": {
        "points": 60,
        "strain": "D"
      }
    },
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 60,
        "strain": "S"
      }
    },
    {
      "type": "bid",
      "seat": 2,
      "call": "pass"
    },
    {
      "type": "bid",
      "seat": 0,
      "call": "pass"
    },
    {
      "type": "bury",
      "seat": 1,
      "cards": [
        "H6",
        "H4",
        "C12"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "S8",
        "S7",
        "S6",
        "S5"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "S3",
        "D3",
        "S13",
        "S12"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "j0",
        "C3",
        "S14",
        "D4"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "S11",
        "S10"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "S9",
        "S4"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "D11",
        "D9"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "C8",
        "C7",
        "C6"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "C11",
        "C10",
        "C9"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "C5",
        "C4",
        "C2"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "C14"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "C13"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "S2"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "H10",
        "H9"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H11",
        "H8"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "H7",
        "H2"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "D2"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "D13"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "D14"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "D7",
        "D6"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "D12",
        "D8"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H13",
        "D5"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "H14"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "H3"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H5"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "D10"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "j1"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "H12"
      ]
    }
  ],
  "guides": {
    "2": {
      "text": "阿凯开局就亮 40♠——他 ♠ 一定不短。你捏着 ♦A 和六张 ♦，45♦ 插进去：一来看他敢跟多高，二来真让你坐庄，♦A 带队也咬得住。"
    },
    "5": {
      "text": "阿凯绕去叫 50♣？说明他的 ♣ 也不空——**记下这条信息**。你的 ♦ 套还在，50♦ 继续。"
    },
    "8": {
      "text": "他回到 55♠。跟。竞叫每跟一档，他的及格线就高一截——他叫得越高，打输时你们升得越多。"
    },
    "11": {
      "text": "最后一口：60♦。把他的及格线顶到 60 分——♠ 里你们一家有大王、一家有 K-Q，他这 60 分有得凑。"
    },
    "14": {
      "text": "收手。65♦ 就得自己抓 65——你的 ♦ 撑不起这个数；而他 60♠ 未必凑得齐：小满第一口就叫过 NT，手里必有大王。**让他打**。"
    },
    "18": {
      "text": "跟上四张：你的三张主牌（小王、♣3、♠A）一张不剩全交，外加垫 ♦4。别心疼——清主就是这么残酷，好在你交出去的分是 0。"
    },
    "21": {
      "text": "你的 ♠ 空了（♠A 上一轮交了），自由垫牌：♦J、♦9 两张不带分。注意：阿凯开局叫 40♠、又甩出六张 ♠——这门他基本见底了。"
    },
    "24": {
      "text": "阿凯的 ♣ 三连。小满的 ♣J-10-9 压过去。你跟 ♣5、♣4、♣2：三张小 ♣ 全清，♣K 单留。"
    },
    "26": {
      "text": "同伴的 ♣A 拍上去了，你的 ♣K（10 分）跟上去——闲家是一伙的，这 10 分稳稳落进自家账里……只要阿凯杀不动。看他。"
    },
    "30": {
      "text": "♥10-9 二连。你和小满都压不出连牌，阿凯白收 10 分。你 ♥ 门还剩 A、Q 两张大的——留着。"
    },
    "33": {
      "text": "**机会来了**：阿凯的主牌上一轮就打光了（♠2 是最后一张）。现在他领 ♦2，你的 ♦A 直接吃掉小满的 ♦K——10 分进闲家，主动权也到手。"
    },
    "34": {
      "text": "领出你的 ♦7-6 连牌。阿凯只剩垫牌的份，小满也把 ♥K、♦5 垫进你这轮——庄家断主，就是这个滋味。"
    },
    "37": {
      "text": "♥A 领出去收分。当心一件事：三张副级也是主牌——阿凯只要还捏着一张 3，就能杀掉这一轮。赌一把；真被杀，丢的也只有小满 ♥5 那 5 分。"
    },
    "42": {
      "text": "最后一张 ♥Q 跟出去。看小满：大王收下末轮——**抠底**！底牌是 ♥6、♥4、♣Q，一分没有：阿凯埋底时没埋分，抠了也白抠。这笔账记到下一副用。"
    }
  },
  "notes": {
    "0": "阿凯开局 40♠。",
    "1": "小满直接 40NT——无主？他手里多半捏着大王和几张级牌。",
    "3": "阿凯绕去叫 50♣——记着：他的 ♣ 也不空。",
    "6": "阿凯回到 ♠。",
    "9": "阿凯的 ♠ 越叫越高。",
    "12": "60♠——同分比花色，♠ 压你的 ♦。",
    "13": "小满放手。",
    "16": "开局四连清主——庄家的标准开局。",
    "17": "小满也没得挑：她的主牌是 大王 + 两条二连（♠3-♦3 和 ♠K-♠Q），结构优先只认「整条整条地交」，于是四张主牌一次清空——两条二连全被抽走，反倒那张孤零零的大王留了下来（它末轮还要收底）。",
    "19": "阿凯接着甩 ♠J-10。",
    "20": "小满的 ♠ 也见底了。",
    "22": "阿凯换 ♣ 三连。",
    "23": "小满的 ♣J-10-9 整条压过！",
    "25": "小满抢到领出，♣A 拍上去。",
    "27": "阿凯翻出 ♠2 杀了！——发牌的底牌带进来的牌，谁也没见过这张。",
    "28": "阿凯领 ♥10-9 二连。",
    "29": "小满压不出连牌。",
    "31": "阿凯领 ♦2。",
    "32": "小满的 ♦K 送上来。",
    "35": "阿凯只能垫 ♦Q-8。",
    "36": "小满也垫：♥K、♦5——15 分全进你这轮。",
    "38": "阿凯用 ♥3 杀掉你的 ♥A！级牌不分花色都是主牌。",
    "39": "小满的 ♥5 跟走，5 分。",
    "40": "阿凯垫出最后的 ♦10。",
    "41": "小满的大王收下末轮——抠底！"
  },
  "review": {
    "intro": "这副把策略篇的几条串了起来：**清主的威力**（挨了一下）、**断主推断**（第 6 墩起势）、**级牌杀**（第 8 墩被反杀）、**末轮抠底**（第 9 墩）。",
    "tricks": {
      "0": "开局被四连清主：三张主牌加一张垫牌全交——好在交出去的分是 0。",
      "1": "♠ 空了，自由垫 ♦J-9 两张不带分的。",
      "2": "小满的 ♣J-10-9 压过庄家三连，15 分归闲家。",
      "3": "阿凯翻出 ♠2 杀 ♣——底牌带进来的牌，数牌时要留这一手。",
      "4": "♥10-9 二连没人压得住，10 分归庄。",
      "5": "**机会**：阿凯的主牌打光了，♦A 吃掉 ♦K，主动权到手。",
      "6": "领 ♦7-6 连牌：庄家只能垫，同伴也垫——15 分进账，这就是断主的滋味。",
      "7": "想收 ♥ 的分，被阿凯用 ♥3（级牌、主牌）反杀——级牌不分花色都是主。",
      "8": "小满的大王收下末轮：**抠底**！底牌 0 分——埋 0 分的底，抠底也白抠。这笔记到下一副用。"
    },
    "outro": "50 对 50：阿凯差 10 分没到 60，你和小满各升 1 级。这副真正的收获是那本账：他的主牌第几轮空的、底牌里有没有分——**记牌就是闲家的武器**。"
  },
  "expect": {
    "dealNo": 4,
    "contract": {
      "points": 60,
      "strain": "S",
      "declarerSeat": 1
    },
    "trump": {
      "strain": "S",
      "rank": 3
    },
    "declarerTrickPoints": 50,
    "defenderTrickPoints": 50,
    "originalKitty": [
      {
        "suit": "C",
        "rank": 12
      },
      {
        "suit": "S",
        "rank": 2
      },
      {
        "suit": "H",
        "rank": 4
      }
    ],
    "kitty": [
      {
        "suit": "H",
        "rank": 6
      },
      {
        "suit": "H",
        "rank": 4
      },
      {
        "suit": "C",
        "rank": 12
      }
    ],
    "lastTrickSize": 1,
    "protectedBottom": false,
    "multiplier": 1,
    "kittyPoints": 0,
    "finalScore": 50,
    "made": false,
    "shortfall": 10,
    "levelChanges": [
      {
        "seat": 0,
        "from": {
          "rank": 3,
          "cycle": 0
        },
        "to": {
          "rank": 4,
          "cycle": 0
        },
        "levels": 1
      },
      {
        "seat": 2,
        "from": {
          "rank": 10,
          "cycle": 0
        },
        "to": {
          "rank": 11,
          "cycle": 0
        },
        "levels": 1
      }
    ]
  }
};
