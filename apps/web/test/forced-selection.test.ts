/**
 * 出牌那两手（ADR-0030）与「现在最大」的**源码**守卫。
 *
 * 行为本身分三层验：引擎的两个纯函数在 `packages/engine/test/pick.test.ts`（含穷举交叉校验），
 * `trickLeader` 在 `trick-leader.test.ts`，而出牌全流程在真页面里走过（`pnpm dev` + 浏览器）。
 * 这里只钉五条**渲染层接线**的事实 —— 它们坏了测试不会红，只有人去点、去悬停才看得见：
 *
 * 1. **选中态 = 玩家自己的选择，否则必出牌**（`#custom ?? #forced`）。写成别的形状
 *    （例如总用 `#forced`）不会报错，但玩家点过的那几张会在下一帧被必出牌覆盖掉。
 * 2. **点不动的那一下被两层拦住**：`TableClient.toggle` 直接 return（权威那一层），
 *    `HandFan` 抖一下（反馈那一层）—— 少任何一层，要么牌被选中了，要么点下去毫无反应。
 * 3. **「现在最大」淡的是根节点**，不是 `.cluster`：那个盒子带 `drop-in` 入场动画，
 *    而动画的 `both` 填充会把 `opacity` 永远钉在 1 —— 规则写得再对也压不过它（实测踩过）。
 * 4. **「点不动所以悬停不上浮」那条只写给没选中的牌**：必出牌是「既已选中、又点不动」的常态，
 *    少了 `:not([data-selected])`，鼠标移上去会把刚替你选中的牌放回底部 26px。
 * 5. **自动选中只在「归我动」那一刻发生**（`myMove` 与托盘是同一个布尔）。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const CLIENT = read('../src/lib/client/table.svelte.ts');
const PAGE = read('../src/routes/table/[code]/+page.svelte');
const FAN = read('../src/lib/components/HandFan.svelte');
const TRAY = read('../src/lib/components/ActionTray.svelte');
const CLUSTER = read('../src/lib/components/TrickCluster.svelte');
const CSS = read('../src/app.css');

test('选中态落回引擎的必出牌，但玩家点过的选择优先', () => {
  assert.ok(
    CLIENT.includes('return this.#custom ?? this.#forced;'),
    '选中态不是「玩家自己点的，否则必出牌」：自动选中会覆盖玩家已经点好的牌'
  );
  assert.match(
    CLIENT,
    /forcedPlay\(me\.hand, deal\.trump, lead\)/,
    '必出牌不是引擎算的（`forcedPlay`）：界面开始自己判规则了'
  );
});

/**
 * **回归**（ADR-0030 的修订，验收当天复现）：自动选中不能在**没有托盘**的时刻发生。
 *
 * 走火的形状有两条，根因是同一个 —— 「我的回合」被在三处各算了一遍：
 * - 别人领出的那十几秒里，蓝框（拟选）已经把该跟那一门标出来了，必出牌再把它整族上浮一次；
 * - 我自己刚出完牌之后，领出还是上一手的，`forcedPlay` 从**新**手牌里挑出一张「必出」并上浮，
 *   而那张牌与这一墩已经没有关系了。
 * 两处都是「牌自己上浮、托盘却不在」：选择态没有任何能作用于它的控件。
 *
 * 现在收成一个布尔 `myMove`（托盘、手牌可点、自动选中都读它），
 * 外加一个 `planning`（本墩已有领出 **且我还没出手**，蓝框与点得动读它）。
 */
function turnGateProblem(client: string, tray: string, page: string): string | null {
  if (!/myMove = \$derived\.by/.test(client)) {
    return '客户端没有 myMove：「我的回合」又被拆成几处各算一遍';
  }
  if (
    !/#forced = \$derived\.by\(\(\): string\[\] => \{[\s\S]*?if \(deal\.phase !== 'play' \|\| !this\.myMove\) return \[\];/.test(
      client
    )
  ) {
    return '必出牌没有挂在 myMove 上：不是我的回合也会自动选中';
  }
  if (!tray.includes('const visible = $derived(client.myMove);')) {
    return '动作托盘没有读 myMove：托盘与自动选中又会是两个判据';
  }
  if (!page.includes('const selectable = $derived(client.myMove);')) {
    return '页面没有读 myMove：手牌可点与托盘 / 自动选中会各自过期';
  }
  if (!/return !this\.#playedThisTrick;/.test(client)) {
    return '拟选窗口没有排除「我已经出手」：旧领出会继续标我的手牌';
  }
  if (!page.includes('const planning = $derived(client.planning);')) {
    return '页面自己又在算拟选窗口：蓝框与「点得动」会与自动选中错开';
  }
  return null;
}

test('自动选中挂在「这一手归我动」上，与托盘是同一个布尔', () => {
  assert.equal(turnGateProblem(CLIENT, TRAY, PAGE), null);
  assert.equal(
    turnGateProblem(CLIENT.replace("if (deal.phase !== 'play' || !this.myMove) return [];", ''), TRAY, PAGE),
    '必出牌没有挂在 myMove 上：不是我的回合也会自动选中',
    '把 myMove 那道门去掉没有被判出来 —— 那正是这次复现出来的 bug'
  );
  assert.equal(
    turnGateProblem(CLIENT, TRAY.replace('$derived(client.myMove)', '$derived(true)'), PAGE),
    '动作托盘没有读 myMove：托盘与自动选中又会是两个判据'
  );
  assert.equal(
    turnGateProblem(
      CLIENT,
      TRAY,
      PAGE.replace('const planning = $derived(client.planning);', 'const planning = $derived(deal !== null);')
    ),
    '页面自己又在算拟选窗口：蓝框与「点得动」会与自动选中错开'
  );
});

test('点不动的那一下被拦两层：客户端 return + 手牌抖一下', () => {
  assert.match(
    CLIENT,
    /if \(this\.pickable !== null && !this\.pickable\.has\(key\)\) return;/,
    'TableClient.toggle 没有再拦一次：不合法的那一下会被选中'
  );
  assert.match(
    FAN,
    /if \(pickable !== null && !pickable\.has\(key\)\) \{\s*\n\s*refuse\(card\);\s*\n\s*return;/,
    'HandFan 没有拒绝那一下（应当抖一下并不调 onToggle）'
  );
  assert.ok(
    PAGE.includes('pickable={client.pickable}'),
    '同桌页没有把可点牌传给手牌区：所有牌都变成可点'
  );
});

/**
 * 回归（同一轮）：把 `transform: none` 写到**已选中**的牌上，等于把刚替你选中的那几张
 * 在鼠标移上去时放回底部 26px —— 因为必出牌正是「既已选中、又点不动」的那一族
 * （`pickableCards` 按「必出不能取消」把这几张留在可点集之外），所以
 * `[data-locked]:hover { transform: none }` 会以 (0,5,0) 压过
 * `.card[data-selected='true']` 的 (0,4,0)，正好作用在功能最常出现的那一帧上。
 * 写法上必须排掉已选中的牌；下面这条判据连「不带 :not 的旧写法」一起拦。
 */
function lockedHoverProblem(css: string): string | null {
  if (
    !/\.fan\.selectable \.card\[data-locked='true'\]:not\(\[data-selected='true'\]\):hover\s*\{\s*transform: none;/.test(
      css
    )
  ) {
    return '点不动的牌的悬停规则没有排除已选中的牌：必出牌既已选中又点不动，鼠标移上去会把牌放回底部 26px';
  }
  if (/\.fan\.selectable \.card\[data-locked='true'\]:hover/.test(css)) {
    return '还留着一条不带 :not([data-selected]) 的悬停规则';
  }
  return null;
}

test('点不动的牌悬停不上浮，但已选中的那几张不许被放下来', () => {
  assert.equal(lockedHoverProblem(CSS), null);
  // 反证要动**选择器本身**：`:not([data-selected='true'])` 在注释里也出现过一次（讲的就是这件事），
  // 按子串替换会先删掉注释里那一处，规则原样还在、判据于是「照常通过」——这条断言自己踩过一次。
  assert.match(
    lockedHoverProblem(
      CSS.replace(
        ".card[data-locked='true']:not([data-selected='true']):hover",
        ".card[data-locked='true']:hover"
      )
    ) ?? '',
    /放回底部 26px/,
    '去掉 :not([data-selected]) 没有被判出来 —— 必出牌（已选中且点不动）正是那条规则的常态对象'
  );
});

/** 淡化的落点这条判据单独成函数，好让反证真的走同一条路 */
function trailingDimProblem(cluster: string, css: string): string | null {
  if (!cluster.includes('class="trick-cluster"')) return '根节点没有 trick-cluster 这个类名，淡化规则落不到它身上';
  if (!/data-trailing=\{trailing\}/.test(cluster)) return 'TrickCluster 没有把 trailing 写成 data-trailing';
  if (/\.cluster\[data-trailing/.test(css)) {
    return '淡化写在了 .cluster 上：那盒子带 drop-in 入场动画，both 填充会把 opacity 钉在 1（实测压不过）';
  }
  if (!/\.trick-cluster\[data-trailing='true'\]\s*\{\s*opacity:\s*0\.6;/.test(css)) {
    return "app.css 里没有 .trick-cluster[data-trailing='true'] { opacity: 0.6 }";
  }
  return null;
}

test('「现在最大」的另一半：被压过去的那一簇整簇淡一档', () => {
  assert.equal(trailingDimProblem(CLUSTER, CSS), null);
  assert.equal(
    trailingDimProblem(CLUSTER, CSS.replace('.trick-cluster[data-trailing', '.cluster[data-trailing')),
    '淡化写在了 .cluster 上：那盒子带 drop-in 入场动画，both 填充会把 opacity 钉在 1（实测压不过）',
    '把落点改回 .cluster 没有被判出来 —— 那正是这次踩过的坑'
  );
});
