/**
 * Digital Asset Links 的配置解析与声明形状（ADR-0026）。
 *
 * 这一份之所以要单独测，是因为它错了**不会报错**：TWA 认不出指纹时不拦着用，
 * 只是悄悄退化成「带浏览器地址栏的窗口」。所以：
 * - 没配齐 → null（路由回 404，与 Gitee 登录「不配即隐身」同口径）；
 * - 配了但写错 → 抛（部署错误必须当场看得见，不能静默降级）；
 * - 手抄指纹常见的大小写/空格/漏冒号 → 归一化成 TWA 认的唯一格式。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { assetLinks, twaConfig } from '../src/lib/server/assetlinks.ts';

/** 一条真指纹的样子：32 组两位大写十六进制，冒号分隔 */
const FINGERPRINT = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const HEX = FINGERPRINT.replace(/:/g, '');

test('没配 / 只配一半 / 空串 → null（整个功能隐身，不是发一份空声明）', () => {
  assert.equal(twaConfig({}), null);
  assert.equal(twaConfig({ SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty' }), null);
  assert.equal(twaConfig({ SIXTY_TWA_FINGERPRINTS: FINGERPRINT }), null);
  assert.equal(
    twaConfig({ SIXTY_TWA_PACKAGE: '', SIXTY_TWA_FINGERPRINTS: '' }),
    null,
    '空串 = 没设：compose 里写 `X=` 很常见'
  );
  assert.equal(
    twaConfig({ SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty', SIXTY_TWA_FINGERPRINTS: '  ' }),
    null
  );
});

test('配齐了就解析出包名与归一化后的指纹', () => {
  const config = twaConfig({ SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty', SIXTY_TWA_FINGERPRINTS: FINGERPRINT });
  assert.deepEqual(config, { packageName: 'io.github.cup113.sixty', fingerprints: [FINGERPRINT] });
});

test('指纹归一化：小写、带空格、漏冒号都认，输出恒为 TWA 认的那一种写法', () => {
  const variants = [FINGERPRINT.toLowerCase(), HEX, HEX.replace(/(.{2})/g, '$1 ').trim()];
  for (const variant of variants) {
    const config = twaConfig({ SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty', SIXTY_TWA_FINGERPRINTS: variant });
    assert.deepEqual(config?.fingerprints, [FINGERPRINT], `没归一化：${variant.slice(0, 24)}…`);
  }
});

test('多个指纹：逗号分隔，顺序保留（debug 与 release 各一条是常见情形）', () => {
  const other = 'FF'.repeat(32).match(/.{2}/g)!.join(':');
  const config = twaConfig({
    SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty',
    SIXTY_TWA_FINGERPRINTS: `${FINGERPRINT}, ${other.toLowerCase()}`
  });
  assert.deepEqual(config?.fingerprints, [FINGERPRINT, other]);
});

test('写错就抛，绝不静默跳过', () => {
  // MD5 只有 32 个十六进制字符：TWA 根本不接受，放过它等于留一条查不出来的降级
  assert.throws(
    () => twaConfig({ SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty', SIXTY_TWA_FINGERPRINTS: 'ab'.repeat(16) }),
    /SIXTY_TWA_FINGERPRINTS/
  );
  assert.throws(
    () => twaConfig({ SIXTY_TWA_PACKAGE: 'io.github.cup113.sixty', SIXTY_TWA_FINGERPRINTS: `${FINGERPRINT},zz` }),
    /SIXTY_TWA_FINGERPRINTS/
  );
  // 包名：一段（缺站点后缀）、首字符是数字、含连字符，都不合法
  for (const packageName of ['sixty', '1.sixty', 'io.github.sixty-points', 'io..sixty', '.sixty']) {
    assert.throws(
      () => twaConfig({ SIXTY_TWA_PACKAGE: packageName, SIXTY_TWA_FINGERPRINTS: FINGERPRINT }),
      /SIXTY_TWA_PACKAGE/,
      `包名 ${packageName} 不该被接受`
    );
  }
});

test('声明的形状：handle_all_urls + android_app 目标', () => {
  const statements = assetLinks({ packageName: 'io.github.cup113.sixty', fingerprints: [FINGERPRINT] });
  assert.equal(statements.length, 1);
  const [statement] = statements;
  assert.deepEqual(statement?.relation, ['delegate_permission/common.handle_all_urls']);
  assert.deepEqual(statement?.target, {
    namespace: 'android_app',
    package_name: 'io.github.cup113.sixty',
    sha256_cert_fingerprints: [FINGERPRINT]
  });
  // 必须是能原样序列化的纯数据（路由直接 json() 它）
  assert.deepEqual(JSON.parse(JSON.stringify(statements)), statements);
});
