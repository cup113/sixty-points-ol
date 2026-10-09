/**
 * 阶段说明单测：界面上不再有常驻提示，说明只活在「?」弹层、/rules 与 MCP 工具面的 read_rules 里，
 * 所以这份文本必须①每个阶段都有、②写完整、③不再出现方位称谓、
 * ④anchor 指向的 /rules 小节真实存在（对着页面文件核对，而不是各写一份常量）。
 *
 * 文本本身住在引擎包（packages/engine/src/help.ts），因为 MCP 工具面也要读它；
 * 本文件留在 web，是因为它校验的 anchor 属于 /rules 页面。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HELP_KEYS, helpKeyOf, phaseHelp, type HelpContext, type HelpKey } from '@sixty/engine';

/**
 * 与阶段无关的**参考键**：`helpKeyOf` 永不返回它们（网页「?」弹层因此看不到），
 * 但它们是 `HELP_KEYS` 的成员 —— MCP 的 `read_rules` 全量读法会给出。
 */
const REFERENCE_KEYS: readonly HelpKey[] = ['trump-order', 'runs'];

/** `helpKeyOf` 能落到的**阶段键**：弹层与阶段一一对应 */
const CONTEXT_KEYS: readonly HelpKey[] = [
  'lobby',
  'auction',
  'bury-declarer',
  'bury-defender',
  'play-lead',
  'play-follow',
  'play-wait',
  'scored',
  'spectate'
];

const ALL_KEYS: readonly HelpKey[] = [...REFERENCE_KEYS, ...CONTEXT_KEYS];

/** 每条说明必须讲到的关键词：漏了就是「说不完整」 */
const REQUIRED: Record<HelpKey, readonly string[]> = {
  'trump-order': ['大王', '小王', '主级', '副级', '跳过级牌', '先出为大'],
  runs: ['顺子', '跳过级牌', '主牌', '至多含一张副级', '杀牌', '字典序'],
  lobby: ['三人', '开始第一副', '邀请', '17', '暗底'],
  auction: ['40', '加 5 分', '♣ < ♦ < ♥ < ♠ < 无主', '两家不叫', '庄家', '级牌', '认领责任'],
  'bury-declarer': ['3 张', '保底', '抠底', '末轮张数'],
  'bury-defender': ['暗底', '闲家', '底分'],
  'play-lead': ['单张', '顺子', '跳过级牌', '跟几张'],
  'play-follow': ['同门', '同张数', '结构优先', '杀牌', '垫牌'],
  'play-wait': ['轮到别人', '先出为大', '副级'],
  scored: ['底牌分 × 末轮张数', '40-55', '每多 5 分', 'ceil', '闲家', '冠军'],
  spectate: ['公共信息', '手牌', '满座', '离座', '入座', '改名']
};

const page = readFileSync(new URL('../src/routes/rules/+page.svelte', import.meta.url), 'utf8');
const tryPlay = readFileSync(new URL('../src/lib/components/TryPlay.svelte', import.meta.url), 'utf8');

/** 取某个小节自己的源码片段：断言必须落在小节内，否则「别处也提过一句」会让守卫变成空转 */
function sectionOf(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) throw new Error(`找不到小节 ${id}`);
  const next = html.indexOf('<section', start);
  return html.slice(start, next < 0 ? html.length : next);
}

test('每个阶段都有标题、至少两条正文，且逐条非空', () => {
  for (const key of ALL_KEYS) {
    const entry = phaseHelp(key);
    assert.ok(entry.title.length > 0, `${key} 缺标题`);
    assert.ok(entry.body.length >= 2, `${key} 正文少于两条`);
    for (const item of entry.body) {
      assert.ok(item.trim().length >= 8, `${key} 有一条过短：${item}`);
    }
  }
});

test('每个阶段都把话说完整（关键词齐备）', () => {
  for (const key of ALL_KEYS) {
    const text = phaseHelp(key).body.join('\n');
    for (const keyword of REQUIRED[key]) {
      assert.ok(text.includes(keyword), `${key} 的说明缺少「${keyword}」`);
    }
  }
});

test('说明里不再出现方位称谓（东/南/西）', () => {
  for (const key of ALL_KEYS) {
    const entry = phaseHelp(key);
    const text = [entry.title, ...entry.body].join('\n');
    assert.equal(/[东南西]/.test(text), false, `${key} 仍出现方位称谓：${text}`);
  }
});

test('anchor 指向 /rules 里真实存在的小节', () => {
  for (const key of ALL_KEYS) {
    const { anchor } = phaseHelp(key);
    assert.ok(page.includes(`id="${anchor}"`), `/rules 缺少 id="${anchor}"（${key} 的链接会落空）`);
  }
});

test('/rules 的九个小节都在，且不只是空壳', () => {
  for (const id of ['start', 'points', 'trump', 'auction', 'bury', 'play', 'inference', 'scoring', 'spectate']) {
    assert.ok(page.includes(`id="${id}"`), `/rules 缺小节 ${id}`);
  }
  // 教程必须复用真实牌渲染组件，而不是自己画方块
  for (const component of ["components/Card.svelte", "components/HandFan.svelte", "components/LevelBadge.svelte"]) {
    assert.ok(page.includes(component), `/rules 没有复用 ${component}`);
  }
  // 「结算」与「升级与赛程」合成一节后，升级表仍要在这一节里
  const scoring = sectionOf(page, 'scoring');
  assert.ok(scoring.includes('UPGRADE_ROWS'), '结算一节没有升级表');
  assert.ok(scoring.includes('LEVEL_STEPS') || scoring.includes('steps'), '结算一节没有升级步进');
});

test('阶段条的四步都连着真实小节', () => {
  // 阶段条渲染的是 PHASES，每一条都链到 #<id>；链错就会点空
  for (const id of ['auction', 'bury', 'play', 'scoring']) {
    assert.ok(page.includes(`href={\`#\${phase.id}\`}`), '阶段条没有按 phase.id 生成链接');
  }
  assert.ok(page.includes('PHASES'), '阶段条没有走 scenarios 的 PHASES 数据');
});

test('测试里的阶段清单与引擎导出的 HELP_KEYS 一致', () => {
  // HELP_KEYS 是 MCP 工具面 read_rules 的遍历顺序；新增一段必须两边都改，
  // 否则工具面会漏掉一整段说明，而这里的守卫会直接红。
  assert.deepEqual([...ALL_KEYS].sort(), [...HELP_KEYS].sort(), 'HELP_KEYS 与本文件的 ALL_KEYS 不一致');
});

test('不同阶段的内容确实不同（防空转）', () => {
  const seen = new Map<string, HelpKey>();
  for (const key of ALL_KEYS) {
    const entry = phaseHelp(key);
    const fingerprint = `${entry.title}\n${entry.body.join('\n')}`;
    const previous = seen.get(fingerprint);
    assert.equal(previous, undefined, `${key} 与 ${previous} 的说明完全相同`);
    seen.set(fingerprint, key);
  }
  assert.equal(seen.size, ALL_KEYS.length);
});

test('helpKeyOf 覆盖全部九种状态且都能落到具体某段', () => {
  const cases: readonly [HelpContext, HelpKey][] = [
    [{ phase: 'lobby' }, 'lobby'],
    [{ phase: 'auction' }, 'auction'],
    [{ phase: 'bury', isDeclarer: true }, 'bury-declarer'],
    [{ phase: 'bury', isDeclarer: false }, 'bury-defender'],
    [{ phase: 'bury' }, 'bury-defender'],
    [{ phase: 'play', myTurn: false }, 'play-wait'],
    [{ phase: 'play', myTurn: true, leading: true }, 'play-lead'],
    [{ phase: 'play', myTurn: true, leading: false }, 'play-follow'],
    [{ phase: 'play', myTurn: true }, 'play-follow'],
    [{ phase: 'scored' }, 'scored'],
    // 观战与阶段无关：不论在哪一阶段，观战者看到的都是「观战」那一条
    [{ phase: 'lobby', spectating: true }, 'spectate'],
    [{ phase: 'auction', spectating: true }, 'spectate'],
    [{ phase: 'play', myTurn: true, spectating: true }, 'spectate'],
    [{ phase: 'scored', spectating: true }, 'spectate']
  ];
  const reached = new Set<HelpKey>();
  for (const [context, expected] of cases) {
    const key = helpKeyOf(context);
    assert.equal(key, expected, `${JSON.stringify(context)} 应为 ${expected}`);
    reached.add(key);
  }
  assert.deepEqual([...reached].sort(), [...CONTEXT_KEYS].sort(), 'helpKeyOf 没能覆盖全部阶段');
});

test('参考键只进全量读法：helpKeyOf 永不返回它们（否则弹层会多出一整段规则底料）', () => {
  // 这条守卫钉住「两类键」的分工：把参考键塞进 helpKeyOf 会让牌桌上的「?」弹层
  // 在某个阶段整段变成规则底料 —— 那是另一处（/rules）的职责。
  const contexts: readonly HelpContext[] = [
    { phase: 'lobby' },
    { phase: 'auction' },
    { phase: 'bury', isDeclarer: true },
    { phase: 'bury', isDeclarer: false },
    { phase: 'play', myTurn: false },
    { phase: 'play', myTurn: true, leading: true },
    { phase: 'play', myTurn: true, leading: false },
    { phase: 'scored' },
    { phase: 'play', myTurn: true, spectating: true }
  ];
  for (const context of contexts) {
    const key = helpKeyOf(context);
    assert.equal(
      REFERENCE_KEYS.includes(key),
      false,
      `${JSON.stringify(context)} 落到了参考键 ${key}：参考键不该出现在阶段映射里`
    );
  }
  // 反向：参考键必须真的在 HELP_KEYS 里（read_rules 全量读法要给出它们）
  for (const key of REFERENCE_KEYS) {
    assert.ok(HELP_KEYS.includes(key), `${key} 不在 HELP_KEYS 里 —— read_rules 不会给出它`);
  }
});

test('教程：每个依赖级牌的示例都点明了将牌环境', () => {
  // 级牌点数必须在讲它的那一节里写出来，不能只在别处顺带提过一句
  const trumpSection = sectionOf(page, 'trump');
  assert.ok(
    /级牌[^。]*?<b[^>]*>5<\/b>/.test(trumpSection),
    '#trump 小节没有在「级牌」那句话里写明点数是 5'
  );
  assert.ok(trumpSection.includes('本副：'), '#trump 小节的牌面示例没有带将牌环境说明');

  // 打牌推论里 ①② 的示例都依赖级牌，每块都要自带「本副：」。
  // 这两节从 6 条压缩成 3 条后，③（分牌晚出）不依赖将牌，所以下限是 2 而不是 4。
  const inference = sectionOf(page, 'inference');
  assert.ok(inference.includes('级牌 5'), '打牌推论没有在示例里写明级牌是 5');
  const envCount = (inference.match(/本副：/g) ?? []).length;
  assert.ok(envCount >= 2, `打牌推论里只有 ${envCount} 处将牌环境说明，依赖级牌的示例块应各自带一句`);
  // 光有「本副：」三个字不够，必须真的写出将牌与级牌
  assert.ok(inference.includes('trumpText('), '打牌推论的环境说明没有走 trumpText');

  // 练手题与埋底手牌通过组件渲染将牌环境，组分件里必须真的输出这句
  assert.ok(tryPlay.includes('本副：') && tryPlay.includes('trumpText(trump)'), 'TryPlay 没有渲染将牌环境');
  const playSection = sectionOf(page, 'play');
  assert.ok(
    (playSection.match(/TryPlay/g) ?? []).length >= 2,
    '打牌一节的练手题没有走 TryPlay 组件（领出那节已改成静态 ✓/✗ 对照，所以是 2 个）'
  );
  assert.ok(page.includes('LEAD_CASES'), '领出那一节的 ✓/✗ 对照没有走 scenarios 的 LEAD_CASES 数据');
  assert.ok(playSection.includes('leadCases'), '打牌一节没有渲染 LEAD_CASES 派生出来的对照');
  assert.ok(sectionOf(page, 'bury').includes('本副：'), '埋底一节的手牌示意没有带将牌环境说明');
});

test('教程：升级表只用可达分数，不再出现 59 / 69 / 79 / 89 这类边界', () => {
  assert.equal(/4[0-9]\s*-\s*59/.test(page), false, '教程仍在用 40-59 这种不可达区间');
  assert.equal(/6[0-9]\s*-\s*69/.test(page), false);
  assert.equal(/7[0-9]\s*-\s*79/.test(page), false);
  assert.equal(/8[0-9]\s*-\s*89/.test(page), false);
  assert.ok(page.includes('UPGRADE_ROWS'), '升级表没有走 scenarios 的可达区间数据');
  assert.ok(page.includes('DEFENDER_STEPS'), '闲家升级档位没有走 scenarios 数据');
  assert.ok(page.includes('LEVEL_STEPS'), '升级步进示例没有走 scenarios 数据');
  // 注：「得分只会是 5 的倍数」那句解释已按定稿删掉，表格自己说明（见 docs/rules-rewrite.md 定稿结论）
});

test('教程没有教「叫高一点能多升级」', () => {
  // 这是页面上一度同时写在两处的错误结论：前半句「升级只看抓分、与叫分无关」是对的，
  // 后半句却推出「所以要往上叫」。既然收益不随叫分变化，跳叫就是纯亏。
  assert.ok(page.includes('正常情况不跳叫'), '教程没有给出「正常情况不跳叫」这条结论');
  assert.ok(page.includes('只看你实际'), '教程没有讲明升级只看实际得分、与叫分无关');
  for (const wrong of ['牌力应该换成级数', '强牌只叫 40', '白白浪费', '价格叫高', '应该往上叫']) {
    assert.equal(page.includes(wrong), false, `教程里仍有「叫高能多升级」的错误说法：「${wrong}」`);
  }
});

test('教程：叫牌一节有阻击叫的心理博弈，且门槛算式是修正过的', () => {
  assert.ok(page.includes('阻击'), '教程没有讲阻击叫');
  assert.ok(page.includes('认领责任'), '教程没有点出「叫牌是认领责任」');
  assert.ok(page.includes('位置决定压力'), '教程没有讲清楚位置带来的压力');
  // 旧说法：闲家合计抓到 100 − 45 = 55 分就把他打输（漏掉底牌分）
  // 现在这个数字只允许以「不是…」这种被否定的形式出现，且旧结论句必须消失
  assert.equal(/闲家合计抓到[^。]*就把他打输/.test(page), false, '仍在用漏掉底牌的旧结论');
  assert.ok(page.includes('不是'), '没有把 100 − 定约 这个直觉值否定掉');
  assert.ok(page.includes('settle.protectBar') && page.includes('settle.digBar'), '门槛数值不是算出来的');
  assert.ok(page.includes('settle.naiveBar'), '没有拿直觉值做对照，门槛就说不清为什么不是 55');
});
