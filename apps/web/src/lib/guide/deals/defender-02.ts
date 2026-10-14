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
      "text": "他亮 40♠，你捏六张 ♦——45♦ 插进去试深浅。"
    },
    "5": {
      "text": "他绕叫 50♣——♣ 也不空，**记下**。50♦ 继续。"
    },
    "8": {
      "text": "跟上去——他叫得越高，打输时你们升得越多。"
    },
    "11": {
      "text": "顶到 60♦：你们一家捏大王、一家 K-Q，他这 60 分有得凑。"
    },
    "14": {
      "text": "65♦ 就得自己抓 65——撑不起。**让他打**。"
    },
    "18": {
      "text": "三张主牌全交外加垫 ♦4——清主残酷，好在一分没丢。"
    },
    "21": {
      "text": "♠ 空了，垫 ♦J-9 不带分——他甩了六张 ♠，这门见底了。"
    },
    "24": {
      "text": "同伴压过去了——♣5-4-2 全清，♣K 单留。"
    },
    "26": {
      "text": "同伴 ♣A 在上，♣K 的 10 分跟进去——看他杀不杀得动。"
    },
    "30": {
      "text": "压不出连牌，他白收 10 分——♥A、♥Q 留着。"
    },
    "33": {
      "text": "**他主牌打光了**——♦A 吃掉 ♦K，10 分加主动权到手。"
    },
    "34": {
      "text": "♦7-6 领出，两家只能垫——15 分，这就是断主的滋味。"
    },
    "37": {
      "text": "♥A 收分——赌他手里没 3 了（副级也是主牌）。"
    },
    "42": {
      "text": "小满大王收末轮——**抠底**！可惜底牌 0 分：他埋底没埋分。"
    }
  },
  "notes": {
    "0": "阿凯开局 40♠。",
    "1": "小满 40NT——多半捏着大王。",
    "3": "阿凯绕叫 50♣——♣ 也不空。",
    "6": "阿凯回到 ♠。",
    "9": "阿凯的 ♠ 越叫越高。",
    "12": "60♠——同分比花色，♠ 压你的 ♦。",
    "13": "小满放手。",
    "16": "开局四连清主——庄家的标准开局。",
    "17": "小满四张主牌一次清空——两条二连被抽走，只剩大王。",
    "19": "阿凯接着甩 ♠J-10。",
    "20": "小满的 ♠ 也见底了。",
    "22": "阿凯换 ♣ 三连。",
    "23": "小满的 ♣J-10-9 整条压过！",
    "25": "小满抢到领出，♣A 拍上去。",
    "27": "阿凯翻出 ♠2 杀——底牌带进来的，谁也没见过。",
    "28": "阿凯领 ♥10-9 二连。",
    "29": "小满压不出连牌。",
    "31": "阿凯领 ♦2。",
    "32": "小满的 ♦K 送上来。",
    "35": "阿凯只能垫 ♦Q-8。",
    "36": "小满也垫——15 分进你这轮。",
    "38": "阿凯用 ♥3 杀掉你的 ♥A！级牌不分花色都是主牌。",
    "39": "小满的 ♥5 跟走，5 分。",
    "40": "阿凯垫出最后的 ♦10。",
    "41": "小满的大王收下末轮——抠底！"
  },
  "review": {
    "intro": "这副串起四条：**清主、断主、级牌杀、抠底**。",
    "tricks": {
      "0": "被四连清主——好在一分没丢。",
      "1": "♠ 空了，垫 ♦J-9。",
      "2": "♣J-10-9 压过，15 分归闲家。",
      "3": "♠2 杀——底牌带进来的，数牌要留这手。",
      "4": "♥10-9 二连没人压得住，10 分归庄。",
      "5": "**他主牌打光**：♦A 吃 ♦K，主动权到手。",
      "6": "♦7-6 领出，两家只能垫——15 分，断主的滋味。",
      "7": "♥3 反杀——级牌不分花色都是主牌。",
      "8": "大王收末轮**抠底**——底牌 0 分，白抠。"
    },
    "outro": "差 10 分没到 60——你俩各升 1 级。**记牌就是闲家的武器**。"
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
