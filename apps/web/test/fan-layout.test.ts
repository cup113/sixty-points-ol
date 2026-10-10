/**
 * 手牌扇形布局单测：核心是「任何机型都不裁切」与「角标始终可读」两条不变量，
 * 外加一条回归——旧的固定重叠规则在 375px 上必然溢出（正是要修的问题）。
 *
 * 后半节是**出牌堆**（`computeClusterStep`）：它与手牌共用宽度口径，但契约不同
 * （手牌放不下切行，出牌堆不切行），且这是「>1 张」才会走到的路径 ——
 * 实测里 5 张顺子摊满整行 / 两簇互叠，而此前它**一条单测都没有**。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_STRIP_RATIO,
  CLUSTER_STRIP_RATIO,
  SPOT_WIDTH_MAX,
  SPOT_WIDTH_MIN,
  computeClusterStep,
  computeFanLayout,
  minStrip,
  rowWidth,
  spotBox,
  spotWidthPct
} from '../src/lib/fan-layout.ts';

const EPS = 1e-6;

/** [机型名, 手牌容器可用宽度, 牌宽]；容器宽度 = 视口 - main 内边距，桌面受 max-w-6xl 限制 */
const DEVICES: readonly [string, number, number][] = [
  ['320', 320 - 24, 50],
  ['360', 360 - 24, 50],
  ['375', 375 - 24, 50],
  ['390', 390 - 24, 50],
  ['428', 428 - 24, 50],
  ['640', 640 - 32, 68],
  ['768', 768 - 32, 68],
  ['1024', 1024 - 32, 68],
  ['1280', 1120, 68] // max-w-6xl 封顶
];

function assertInvariants(count: number, cardWidth: number, containerWidth: number): void {
  const layout = computeFanLayout({ count, cardWidth, containerWidth });
  const base = cardWidth * BASE_STRIP_RATIO;
  const strip = minStrip(cardWidth);

  assert.equal(layout.rows, Math.ceil(count / layout.perRow), '行数应等于 ceil(张数/每行张数)');
  assert.ok(layout.perRow >= 1, '每行至少一张');
  assert.ok(layout.rows * layout.perRow >= count, '总容量应覆盖所有手牌');

  if (!layout.override) {
    assert.ok(count <= 1, '仅单张或未测量时才不覆盖');
    return;
  }

  // 间距不超过设计比例，也不低于角标可读下限
  assert.ok(layout.step <= base + EPS, `step ${layout.step} 不应超过设计比例 ${base}`);
  assert.ok(layout.step >= strip - EPS, `step ${layout.step} 不应低于可读下限 ${strip}`);
  assert.ok(layout.step <= cardWidth + EPS, 'step 不应超过牌宽');

  // 每一行都必须放得下（这是「最左一张不被裁」的充要条件）
  assert.ok(
    rowWidth(layout.perRow, cardWidth, layout.step) <= containerWidth + EPS,
    `行宽 ${rowWidth(layout.perRow, cardWidth, layout.step)} 超出容器 ${containerWidth}`
  );
}

test('单张与未测量：不做内联覆盖，交给 CSS 回退值', () => {
  assert.equal(computeFanLayout({ count: 1, cardWidth: 68, containerWidth: 800 }).override, false);
  assert.equal(computeFanLayout({ count: 20, cardWidth: 0, containerWidth: 800 }).override, false);
  assert.equal(computeFanLayout({ count: 20, cardWidth: 68, containerWidth: 0 }).override, false);
});

test('桌面宽屏：维持设计稿的紧凑扇形（每张露 40%）', () => {
  const layout = computeFanLayout({ count: 17, cardWidth: 68, containerWidth: 1120 });
  assert.equal(layout.rows, 1);
  assert.equal(layout.step, 68 * BASE_STRIP_RATIO);
  assert.ok(rowWidth(17, 68, layout.step) < 1120, '紧凑扇形不应铺满整行');
});

test('17 张在各机型都放得下（问题 2 的直接回归）', () => {
  for (const [viewport, containerWidth, cardWidth] of DEVICES) {
    assertInvariants(17, cardWidth, containerWidth);
    const layout = computeFanLayout({ count: 17, cardWidth, containerWidth });
    assert.ok(
      rowWidth(layout.perRow, cardWidth, layout.step) <= containerWidth + EPS,
      `${viewport}px：17 张溢出容器`
    );
  }
});

test('20 张（埋底阶段）在各机型都放得下', () => {
  for (const [viewport, containerWidth, cardWidth] of DEVICES) {
    const layout = computeFanLayout({ count: 20, cardWidth, containerWidth });
    assertInvariants(20, cardWidth, containerWidth);
    assert.ok(
      rowWidth(layout.perRow, cardWidth, layout.step) <= containerWidth + EPS,
      `${viewport}px：20 张溢出容器`
    );
  }
});

test('极窄机型 20 张切多行且每行都完整', () => {
  const layout = computeFanLayout({ count: 20, cardWidth: 50, containerWidth: 296 }); // 320px 机型
  assert.equal(layout.rows, 2, '320px 上 20 张应切两行');
  assert.equal(layout.perRow, 10);
  assert.ok(rowWidth(10, 50, layout.step) <= 296 + EPS);
});

test('单行但紧凑比例放不下时，用满可用宽度（不超过设计比例）', () => {
  const layout = computeFanLayout({ count: 17, cardWidth: 50, containerWidth: 351 }); // 375px 机型
  assert.equal(layout.rows, 1);
  assert.ok(layout.step > minStrip(50), '应比可读下限更宽松（用满可用宽度）');
  assert.ok(layout.step < 50 * BASE_STRIP_RATIO, '但不超过设计比例');
  assert.ok(Math.abs(rowWidth(17, 50, layout.step) - 351) < 0.5, '应正好铺满可用宽度');
});

test('回归：旧的固定重叠规则在 375px 上必然裁掉最左一张', () => {
  const oldMobileCardWidth = 52;
  const oldStep = oldMobileCardWidth * BASE_STRIP_RATIO; // margin-left: -0.6 × 牌宽
  const oldWidth = rowWidth(17, oldMobileCardWidth, oldStep);
  const available375 = 375 - 24;
  assert.ok(
    oldWidth > available375,
    `旧规则应溢出（${oldWidth} > ${available375}）；若不溢出说明回归用例本身失效`
  );
  // 新规则同样输入下必须放得下
  const fixed = computeFanLayout({ count: 17, cardWidth: 50, containerWidth: available375 });
  assert.ok(rowWidth(fixed.perRow, 50, fixed.step) <= available375 + EPS);
});

test('参数扫描：300..1500px × 1..20 张全部满足不变量', () => {
  let checked = 0;
  for (const cardWidth of [50, 68]) {
    for (let containerWidth = 300; containerWidth <= 1500; containerWidth += 10) {
      for (let count = 1; count <= 20; count++) {
        assertInvariants(count, cardWidth, containerWidth);
        checked++;
      }
    }
  }
  assert.equal(checked, 2 * 121 * 20, '扫描规模应与预期一致');
});

/* ---------- 出牌堆（多张组合）：只收不放 ---------- */

/**
 * [场景, 出牌点预算宽度, 牌宽] —— 预算宽度按 `TrickArea` 的实际几何算出来：
 * 三点是「两翼 + 一条通栏」，两翼各占**按张数算出来的**百分比（`spotBox`：一颗 30%、
 * 五张 38%、八张及以上 44%），牌宽窄屏 38 / 桌面 56（`.cluster .card` 的 `--cw`）。
 * 下面这四行按 38%（= 五张那一档，实测锚点）取，够覆盖出牌堆的宽度契约。
 */
const CLUSTER_BUDGETS: readonly [string, number, number][] = [
  ['窄屏对方点（毡面 312 × 38%）', 312 * 0.38, 38],
  ['窄屏我方点（通栏）', 312, 38],
  ['桌面对方点（毡面 1080 × 38%）', 1080 * 0.38, 56],
  ['桌面我方点（通栏）', 1080, 56]
];

test('出牌堆：步距不超过紧凑上限（放得下也不摊开）', () => {
  // 「放得下就摊开」正是实测的缺陷：己方出牌点跨整行，5 张顺子于是摊满大半行
  // （实测步距 50.0px，而紧凑上限是 38 × 0.6 = 22.8px）。上限与手牌同一套纪律：只收不放。
  for (const [scene, budget, cardWidth] of CLUSTER_BUDGETS) {
    for (let count = 2; count <= 12; count += 1) {
      const step = computeClusterStep({ count, cardWidth, budget });
      assert.ok(
        step <= cardWidth * CLUSTER_STRIP_RATIO + EPS,
        `${scene}：${count} 张的步距 ${step} 超过紧凑上限 ${cardWidth * CLUSTER_STRIP_RATIO}`
      );
    }
  }
});

test('出牌堆：预算不小于一张牌宽时整堆必须放得下（放不下就收得更紧）', () => {
  for (const [scene, budget, cardWidth] of CLUSTER_BUDGETS) {
    for (let count = 2; count <= 12; count += 1) {
      const step = computeClusterStep({ count, cardWidth, budget });
      assert.ok(
        rowWidth(count, cardWidth, step) <= budget + EPS,
        `${scene}：${count} 张整堆宽 ${rowWidth(count, cardWidth, step)} 超出预算 ${budget}`
      );
    }
  }
});

test('出牌堆：0/1 张与未测量不写内联间距（交给 CSS 回退值）', () => {
  // 单张没有「相邻间距」可言；返回牌宽是给组件判断用的（`measured` 也要求 count > 1）
  assert.equal(computeClusterStep({ count: 1, cardWidth: 56, budget: 410 }), 56);
  assert.equal(computeClusterStep({ count: 0, cardWidth: 56, budget: 410 }), 56);
  // 未测量（预算 0）与牌宽未测量：不要算出「0 间距」把牌全叠在一起
  assert.equal(computeClusterStep({ count: 5, cardWidth: 56, budget: 0 }), 56);
  assert.equal(computeClusterStep({ count: 5, cardWidth: 0, budget: 410 }), 0);
});

test('反证：旧的自然间距（牌宽 + 6）在窄屏对方出牌点里必然放不下', () => {
  // 每次运行都重证「摊开这条老路走不通」，而不是只在一次性的注入实验里证过：
  // 旧的 natural 是 牌宽 + CLUSTER_GAP(6)，CSS 的 gap:6px 又照样生效 ⇒ 实际步距 牌宽 + 12。
  const cardWidth = 38;
  const budget = 312 * 0.38;
  const oldNatural = cardWidth + 6;
  assert.ok(
    rowWidth(5, cardWidth, oldNatural) > budget,
    `旧的自然间距应当放不下（${rowWidth(5, cardWidth, oldNatural)} vs ${budget}）：这条反证失效了`
  );
  // 同一组输入下，新算法必须放得下
  const step = computeClusterStep({ count: 5, cardWidth, budget });
  assert.ok(rowWidth(5, cardWidth, step) <= budget + EPS, '新算法在窄屏对方点放不下 5 张');
  assert.ok(step < oldNatural, '新算法的步距应当比旧的摊开间距更紧');
});

/* ---------- 出牌点的宽度预算：两翼按张数自适应 ---------- */

/**
 * 宽度是这一簇唯一的可支配资源，而需要多少只由张数决定（`牌宽 × (0.6 × (n−1) + 1)`，
 * 对 n 是线性的）。所以这里也按线性给：一颗 30%、五张 38%、八张及以上封顶 44%。
 *
 * 为什么五张那一档必须**正好**是 38%：那是实测锚点 —— 场景 11/12 量的就是 5 张顺子，
 * 在 38% 的盒子里刚好维持紧凑叠排。曲线穿过它，而不是另起一个数。
 */
test('出牌点宽度：一颗牌 30%、五张 38%（实测锚点）、八张及以上 44% 封顶', () => {
  assert.equal(spotWidthPct(1), SPOT_WIDTH_MIN);
  assert.equal(spotWidthPct(5), 38);
  assert.equal(spotWidthPct(8), SPOT_WIDTH_MAX);
  for (const count of [9, 12, 20]) {
    assert.equal(spotWidthPct(count), SPOT_WIDTH_MAX, `${count} 张应当封顶在 ${SPOT_WIDTH_MAX}%`);
  }
  assert.equal(spotWidthPct(0), SPOT_WIDTH_MIN, '0 张（还没出牌）按一颗牌算，不许算出 0 宽的盒子');
  for (let count = 1; count <= 12; count += 1) {
    assert.ok(
      spotWidthPct(count + 1) >= spotWidthPct(count),
      `${count} → ${count + 1} 张之间宽度回退了：牌更多反而盒子更窄`
    );
    assert.ok(spotWidthPct(count) <= SPOT_WIDTH_MAX && spotWidthPct(count) >= SPOT_WIDTH_MIN);
  }
});

test('出牌点几何：内侧边缘恒在 48% / 52%，加上中间空带正好一条内容槽', () => {
  for (let count = 1; count <= 12; count += 1) {
    const box = spotBox(count);
    assert.ok(
      Math.abs(box.insetPct + box.widthPct - 48) < EPS,
      `${count} 张：内侧边缘必须钉在 48%（实测 ${box.insetPct + box.widthPct}）——宽了就会顶到中线`
    );
    assert.ok(
      Math.abs(2 * box.insetPct + 2 * box.widthPct + 4 - 100) < EPS,
      `${count} 张：2 × 外缩 + 2 × 宽 + 中间空带必须正好是一条内容槽（互不相交的结构性保证）`
    );
    assert.ok(box.insetPct >= 3, `${count} 张：外侧只剩 ${box.insetPct}%，离毡面内缘太近`);
  }
});

test('反证：写死 38% 的旧几何量不到「少牌更靠中间」这件事', () => {
  // 旧版：一颗牌与八张牌拿到**一样**的盒子宽度，所以「按内容自适应」根本不存在。
  const fixed = 38;
  assert.ok(
    spotWidthPct(8) - spotWidthPct(1) >= 10,
    `8 张与 1 张的盒子宽度只差 ${spotWidthPct(8) - spotWidthPct(1)}%：等于又写死了（旧版是 ${fixed}%）`
  );
  // 一颗牌时盒子中心（在内容槽里的位置）应当比五张时更靠中间：33% vs 29%，两边都靠中线
  const center = (count: number): number => {
    const box = spotBox(count);
    return box.insetPct + box.widthPct / 2;
  };
  assert.ok(center(1) > center(5), `一颗牌时盒子中心 ${center(1)}% 应当比五张时 ${center(5)}% 更靠中线`);
  assert.ok(
    Math.abs(38 - spotWidthPct(5)) < EPS,
    '五张那一档不再是 38%：场景 11/12 量过的锚点漂了，需要重新实测'
  );
});
