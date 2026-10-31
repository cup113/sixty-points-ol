/**
 * 引导局数据（**生成物**，勿手改）：由 `pnpm --filter web guide` 从 `docs/guide/<slug>.json` 生成。
 *
 * 校验链见 `scripts/build-guide.ts`：结构 → 引擎重放 → 存证核对 → 引导词覆盖。
 * 手改这个文件会在 `guide:check` 与 `test/guide-generated.test.ts` 里报红。
 */
import type { GuideDealData } from '../types.ts';

export const DECLARER_02: GuideDealData = {
  "version": 1,
  "slug": "declarer-02",
  "title": "无主局：30 分埋进底",
  "role": "declarer",
  "learnerSeat": 1,
  "aliases": [
    "小鹿",
    "你",
    "老金"
  ],
  "source": {
    "table": "UTVSRE",
    "dealNo": 2,
    "date": "2026-10-07"
  },
  "facts": {
    "hands": [
      [
        "S9",
        "S3",
        "C8",
        "C7",
        "C2",
        "D3",
        "D2",
        "H12",
        "H6",
        "S14",
        "C13",
        "C12",
        "H8",
        "H7",
        "D14",
        "C5",
        "D5"
      ],
      [
        "S6",
        "S4",
        "C6",
        "C4",
        "C3",
        "D7",
        "D6",
        "H9",
        "S8",
        "S12",
        "H11",
        "D10",
        "H5",
        "j1",
        "S10",
        "C10",
        "D13"
      ],
      [
        "S7",
        "S2",
        "C14",
        "C11",
        "C9",
        "D9",
        "D8",
        "H14",
        "H13",
        "S13",
        "H2",
        "H3",
        "H10",
        "D4",
        "D12",
        "S5",
        "S11"
      ]
    ],
    "originalKitty": [
      "j0",
      "H4",
      "D11"
    ],
    "dealerSeat": 1,
    "levels": [
      {
        "rank": 2,
        "cycle": 0
      },
      {
        "rank": 5,
        "cycle": 0
      },
      {
        "rank": 2,
        "cycle": 0
      }
    ],
    "dealNo": 2
  },
  "actions": [
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 40,
        "strain": "NT"
      }
    },
    {
      "type": "bid",
      "seat": 2,
      "call": {
        "points": 45,
        "strain": "H"
      }
    },
    {
      "type": "bid",
      "seat": 0,
      "call": {
        "points": 55,
        "strain": "C"
      }
    },
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 55,
        "strain": "NT"
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
        "strain": "C"
      }
    },
    {
      "type": "bid",
      "seat": 1,
      "call": {
        "points": 60,
        "strain": "NT"
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
        "S10",
        "C10",
        "D13"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "S6",
        "S4"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "S7",
        "S2"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "S9",
        "S3"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "C6",
        "C4",
        "C3"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "C14",
        "C11",
        "C9"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "C8",
        "C7",
        "C2"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "D7",
        "D6"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "D9",
        "D8"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "D3",
        "D2"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H14"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "H12"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "H4"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H13"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "H6"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "H9"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "S13"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "S14"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "S8"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "C13",
        "C12"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "S12",
        "H11"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H2",
        "H3"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "H8",
        "H7"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "D11",
        "D10"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "H10",
        "D4"
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
      "seat": 1,
      "cards": [
        "H5"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "D12"
      ]
    },
    {
      "type": "play",
      "seat": 1,
      "cards": [
        "j1",
        "j0"
      ]
    },
    {
      "type": "play",
      "seat": 2,
      "cards": [
        "S5",
        "S11"
      ]
    },
    {
      "type": "play",
      "seat": 0,
      "cards": [
        "C5",
        "D5"
      ]
    }
  ],
  "guides": {
    "0": {
      "text": "哪门都最长三张——叫**无主**：全场只 6 张主牌，你捏大王和 ♥5。40NT。"
    },
    "3": {
      "text": "**无主压一切**：55NT 盖过 55♣。"
    },
    "6": {
      "text": "60NT——手里三张主牌就是全场前三。"
    },
    "9": {
      "text": "埋 ♠10、♣10、♦K——整整 **30 分**！双王在手末轮必胜，×2 就是 60。",
      "why": "这 30 分就是本副的胜负手。"
    },
    "10": {
      "text": "**缺位顺子**：级牌 5 不在门里，♠4-6 挨着——对手没连牌，压不过。"
    },
    "13": {
      "text": "**散牌赢不了连牌**：♣6-4-3 三连通吃 ♣A-J-9。"
    },
    "16": {
      "text": "♦7-6 撞上更大的 ♦9-8，让他收。"
    },
    "21": {
      "text": "♥A、♥K 让他收——你的双王一张没动。"
    },
    "24": {
      "text": "♥ 门清空——又缺一门。"
    },
    "27": {
      "text": "♠K 进 ♠A 口里，♠8 跟走。"
    },
    "29": {
      "text": "♣ 已空，垫 ♠Q、♥J——大而无用，Q、J 不计分。"
    },
    "32": {
      "text": "垫 ♦J-♦10——10 分舍不得也没法：主牌一张不能动。"
    },
    "35": {
      "text": "**级牌杀牌**：♥5 压死 ♦A——**大的留最后**。"
    },
    "37": {
      "text": "双王亮出，全场无敌：底 30 分 × 2 = **60 分**进账。"
    }
  },
  "notes": {
    "1": "老金争 45♥。",
    "2": "小鹿插 55♣。",
    "4": "老金放手。",
    "5": "小鹿顶到 60♣。",
    "7": "老金收手。",
    "8": "小鹿也放你过。",
    "19": "老金开始跑 ♥ 大牌。",
    "22": "♥K（10 分）也进了老金的账。"
  },
  "review": {
    "intro": "无主的账本两样：牌面 20 分，**底牌翻倍 60 分**——总分 80。",
    "tricks": {
      "0": "**缺位顺子**：♠4-6 相邻，白捡一轮。",
      "1": "散牌压不过连牌：♣6-4-3 通吃。",
      "2": "♦7-6 撞上老金更大的 ♦9-8，让他收。",
      "3": "♥ 门只剩 ♥4，跟走；♥A、♥K 是老金的。",
      "4": "♥9 跟一张，♥ 门清空——又缺一门。",
      "5": "♠8 跟走；小鹿的 ♠A 收了 ♠K 的 10 分。",
      "6": "♣ 已空，垫 ♠Q、♥J。",
      "7": "♦J-10 只能交——换三张主牌全留。",
      "8": "♥5 压死 ♦A——小的先用，大的留最后。",
      "9": "双王收末轮：30 × 2 = **60 分**进账。"
    },
    "outro": "20 + 60 = 80，升 4 级。无主局里**底牌就是第二副手牌**。"
  },
  "expect": {
    "dealNo": 2,
    "contract": {
      "points": 60,
      "strain": "NT",
      "declarerSeat": 1
    },
    "trump": {
      "strain": "NT",
      "rank": 5
    },
    "declarerTrickPoints": 20,
    "defenderTrickPoints": 50,
    "originalKitty": [
      {
        "joker": "small"
      },
      {
        "suit": "H",
        "rank": 4
      },
      {
        "suit": "D",
        "rank": 11
      }
    ],
    "kitty": [
      {
        "suit": "S",
        "rank": 10
      },
      {
        "suit": "C",
        "rank": 10
      },
      {
        "suit": "D",
        "rank": 13
      }
    ],
    "lastTrickSize": 2,
    "protectedBottom": true,
    "multiplier": 2,
    "kittyPoints": 30,
    "finalScore": 80,
    "made": true,
    "shortfall": 0,
    "levelChanges": [
      {
        "seat": 1,
        "from": {
          "rank": 5,
          "cycle": 0
        },
        "to": {
          "rank": 9,
          "cycle": 0
        },
        "levels": 4
      }
    ],
    "claim": null
  }
};
