/**
 * PWA 外壳守卫（ADR-0026）：manifest 与它的图标。
 *
 * 守的都是「编译不报、测试不报、只有装上才看得见」的那类缺陷：
 * - 图标引用的文件名写错（Chrome 的可安装条件只要求「至少一张 192 与一张 512 能取到」，
 *   取不到就不弹安装入口，页面照旧能用）；
 * - 图标不是**声明那个尺寸**（写 512 实际 192 也照样能加载）；
 * - `theme_color` 与 `app.html` 的 `theme-color` 漂了 —— 两个地方各说一个底色，
 *   浏览器 UI 与启动画面就不是同一个色。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const STATIC = new URL('../static/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const readStatic = (path: string): string => readFileSync(new URL(path, STATIC), 'utf8');

interface WebManifest {
  name?: string;
  short_name?: string;
  description?: string;
  lang?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  orientation?: string;
  background_color?: string;
  theme_color?: string;
  icons?: { src?: string; sizes?: string; type?: string; purpose?: string }[];
}

const manifest = JSON.parse(readStatic('manifest.webmanifest')) as WebManifest;

test('manifest 具备可安装所需的最小字段', () => {
  assert.equal(manifest.name, '六十分');
  assert.equal(manifest.short_name, '六十分');
  assert.equal(manifest.lang, 'zh-CN');
  assert.equal(manifest.start_url, '/');
  // scope 必须是 /：牌桌、教程、rules 全在同一台应用里，跳到站内别的路径不该被踢出应用窗口
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok((manifest.description ?? '').length > 0, 'manifest 缺 description（安装弹窗里会显示它）');
  assert.ok((manifest.id ?? '').length > 0, 'manifest 缺 id（缺省时 Chrome 用 start_url，改 start_url 会变成另一个应用）');
  assert.match(manifest.theme_color ?? '', /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color ?? '', /^#[0-9a-f]{6}$/i);
});

test('图标：一张 192、一张 512、一张 maskable，且文件真的存在、尺寸与声明一致', () => {
  const icons = manifest.icons ?? [];
  assert.ok(icons.length >= 3, `manifest 只声明了 ${icons.length} 张图标`);

  const any = icons.filter((icon) => (icon.purpose ?? 'any') === 'any');
  assert.ok(any.some((icon) => icon.sizes === '192x192'), '缺 192x192 的 any 图标');
  assert.ok(any.some((icon) => icon.sizes === '512x512'), '缺 512x512 的 any 图标');
  assert.ok(
    icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'),
    '缺 512x512 的 maskable 图标（Android 上会被裁成圆形/圆角，需要满铺那一张）'
  );

  for (const icon of icons) {
    const src = icon.src ?? '';
    assert.match(src, /^\/icons\/[a-z0-9-]+\.png$/, `图标路径不是本站 static/icons 下的绝对路径：${src}`);
    assert.equal(icon.type, 'image/png', `${src} 的 type 不是 image/png`);
    const bytes = readFileSync(new URL(src.slice(1), STATIC));
    // PNG 的 IHDR 就跟着 8 字节签名 + 4 字节长度 + 4 字节类型：宽高各 4 字节大端
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${src} 不是 PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(`${width}x${height}`, icon.sizes, `${src} 实际是 ${width}x${height}，与声明 ${String(icon.sizes)} 不符`);
    assert.ok(bytes.length > 1024, `${src} 只有 ${bytes.length} 字节，像是空图`);
  }
});

test('app.html 挂了 manifest，且 theme-color 与 manifest 的 theme_color 是同一个颜色', () => {
  const html = read('../src/app.html');
  assert.match(
    html,
    /<link rel="manifest" href="%sveltekit\.assets%\/manifest\.webmanifest" \/>/,
    'app.html 没有挂 manifest（缺了它浏览器根本不去取清单，PWA 无从谈起）'
  );
  const themeColor = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];
  assert.equal(themeColor, manifest.theme_color, 'theme-color 与 manifest.theme_color 漂了');
  // 清单本身也得是真的清单：`static/` 里的 JSON 不许有注释/尾逗号那类「看着像 JSON」的写法
  assert.doesNotThrow(() => JSON.parse(readStatic('manifest.webmanifest')));
});

/**
 * Service Worker 的注册点：框架不再自动注入（`serviceWorker.register: false`），
 * 由 `$lib/native-shell` 注册，且**壳里一律不注册**（ADR-0027）。
 *
 * 没有这条守卫会怎样：把注册改回自动，或把 native 判断删掉，编译、类型、其它测试
 * 全都照过，症状要等下一次部署之后才出现 —— 壳里的用户一直看到上一版页面。
 */
test('Service Worker 由客户端自己注册，且 Capacitor 壳里不注册', () => {
  const config = read('../svelte.config.js');
  assert.match(config, /serviceWorker:\s*\{\s*register:\s*false\s*\}/, '框架的自动注册没有关，壳内会绕过 native 判断');

  // 只看代码，不看注释：注释里写着「壳里不注册」不构成实现
  const shell = stripComments(read('../src/lib/native-shell.ts'));
  // native 判断必须排在注册之前：先 register 再判断等于没判断
  const nativeCheck = shell.search(/isNativeShell\(\)/);
  const register = shell.search(/navigator\.serviceWorker\.register/);
  assert.ok(nativeCheck >= 0, 'native-shell.ts 里没有壳判断');
  assert.ok(register >= 0, 'native-shell.ts 里没有注册 Service Worker');
  assert.ok(nativeCheck < register, '注册排在壳判断之前：壳里会先注册再「不注册」');

  const layout = read('../src/routes/+layout.svelte');
  assert.match(layout, /onMount\(bootShell\)/, '+layout.svelte 没有在挂载时启动 shell 引导');
});

/** 去掉块注释与整行 `//` 注释：这些守卫判的是代码形状，注释里的说明不算数。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}
