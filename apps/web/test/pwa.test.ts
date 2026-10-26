/**
 * PWA 外壳守卫（ADR-0026）：manifest 与它的图标、以及 manifest 与 Android 包的**一致**。
 *
 * 守的都是「编译不报、测试不报、只有装上才看得见」的那类缺陷：
 * - 图标引用的文件名写错（Chrome 的可安装条件只要求「至少一张 192 与一张 512 能取到」，
 *   取不到就不弹安装入口，页面照旧能用）；
 * - 图标不是**声明那个尺寸**（写 512 实际 192 也照样能加载）；
 * - `theme_color` 与 `app.html` 的 `theme-color` 漂了 —— 两个地方各说一个底色，
 *   浏览器 UI 与启动画面就不是同一个色；
 * - Android 包的启动底色/主题色与 manifest 漂了 —— 同一件事在三个文件里各写一遍就会漂。
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
 * Android 模板：用一组假的运行期取值填一遍，再断言形状。
 * 这样测的是「工作流真正会产出的那个 twa-manifest.json」，而不是一段说明文字。
 */
const TEMPLATE = read('../../../deploy/twa/twa-manifest.template.json');

function fillTemplate(values: Record<string, string>): Record<string, unknown> {
  const filled = TEMPLATE.replace(/\$\{([A-Z_]+)\}/g, (whole, key: string) => {
    const value = values[key];
    assert.ok(value !== undefined, `模板里的占位符 ${whole} 没有被测试填上（工作流漏了一步？）`);
    return value;
  });
  return JSON.parse(filled) as Record<string, unknown>;
}

const SAMPLE = {
  DOMAIN: 'game.example.com',
  PACKAGE_ID: 'io.github.cup113.sixty',
  APP_NAME: '六十分',
  ORIENTATION: 'portrait',
  VERSION_NAME: 'run-abc1234',
  VERSION_CODE: '26102619',
  KEYSTORE_PATH: '/workspace/android.keystore',
  KEY_ALIAS: 'sixty'
};

test('Android 模板里每个占位符都在工作流的取值表里', () => {
  const placeholders = [...TEMPLATE.matchAll(/\$\{([A-Z_]+)\}/g)].map((match) => match[1]!);
  assert.ok(placeholders.length >= 7, `只找到 ${placeholders.length} 个占位符，模板是不是退化成硬编码了`);
  const unknown = placeholders.filter((key) => !(key in SAMPLE));
  assert.deepEqual(unknown, [], `模板里有测试没覆盖的占位符：${unknown.join(', ')}`);
  // 域名必须出现在这三处，少一处就等于把 APK 指向了别的地方
  const parsed = fillTemplate(SAMPLE) as {
    host?: string;
    iconUrl?: string;
    webManifestUrl?: string;
    startUrl?: string;
  };
  assert.equal(parsed.host, SAMPLE.DOMAIN);
  assert.equal(parsed.iconUrl, `https://${SAMPLE.DOMAIN}/icons/icon-512.png`);
  assert.equal(parsed.webManifestUrl, `https://${SAMPLE.DOMAIN}/manifest.webmanifest`);
  assert.equal(parsed.startUrl, '/');
});

test('Android 包：回退形态、配色、版本与 manifest 对齐', () => {
  const parsed = fillTemplate(SAMPLE) as {
    packageId?: string;
    display?: string;
    orientation?: string;
    themeColor?: string;
    backgroundColor?: string;
    enableNotifications?: boolean;
    fallbackType?: string;
    appVersionCode?: number;
    appVersionName?: string;
    minSdkVersion?: number;
  };

  // 国内设备上常常没有支持 TWA 的浏览器：`webview` 让它在应用内打开，
  // 而不是把用户甩到系统浏览器或（缺省 customtabs 时）一个空页。
  assert.equal(parsed.fallbackType, 'webview', 'fallbackType 必须是 webview：国内很多 ROM 没有 Chrome');
  assert.equal(parsed.display, 'standalone');
  assert.equal(parsed.orientation, SAMPLE.ORIENTATION);
  assert.equal(parsed.themeColor, manifest.theme_color, 'APK 的状态栏色与 manifest.theme_color 漂了');
  assert.equal(parsed.backgroundColor, manifest.background_color, 'APK 的启动底色与 manifest.background_color 漂了');
  assert.equal(parsed.enableNotifications, false, '纸牌局不用通知，别为此申请权限（国内 ROM 会反复弹）');
  // versionCode 必须是数字：字符串形式 bubblewrap 会当成 versionName 读进去
  assert.equal(typeof parsed.appVersionCode, 'number');
  assert.equal(parsed.appVersionName, SAMPLE.VERSION_NAME);
  assert.ok((parsed.minSdkVersion ?? 0) >= 23, 'minSdk 低于 23 就装不上 TWA 需要的浏览器版本');
});

/**
 * 工作流本身的守卫：签名材料怎么进出 runner，是**读一遍看不出来**的那类错 ——
 * 口令进了 argv 只是进程列表里多一行，keystore 落在工作区只是被某个通配扫进去，
 * 别名被要求成 secret 只是发布时才发现「可推导的值没配」。所以在这里钉形状。
 */
const WORKFLOW = read('../../../.github/workflows/apk.yml');

/** 去掉整行的 YAML 注释：注释里写着「别把口令放进 argv」不构成实现 */
const workflowCode = WORKFLOW.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

test('口令不进 argv：只许 -storepass:env（`-storepass xxx` 在进程列表里看得见）', () => {
  assert.ok(workflowCode.includes('-storepass:env'), '没有用 -storepass:env 传口令');
  assert.equal(
    /-storepass(?!:env)/.test(workflowCode),
    false,
    '出现了 `-storepass <值>`：口令会被写进进程列表（ps / 任务管理器都看得见）'
  );
  // PKCS12 里 key 口令与 store 口令是同一个，`-keypass` 只会多一处泄露面
  assert.equal(/-keypass/.test(workflowCode), false, '又传了 -keypass：PKCS12 下它就是 store 口令的副本');
});

test('keystore 落在 $RUNNER_TEMP（工作区之外），并且用完就删', () => {
  assert.ok(workflowCode.includes('RUNNER_TEMP'), 'keystore 没有被放到 $RUNNER_TEMP');
  assert.ok(workflowCode.includes('umask 077'), '没有收紧 umask，同机其它进程能读到 keystore');
  assert.ok(/rm -rf "\$\{?RUNNER_TEMP\}?\/twa"/.test(workflowCode), '没有清理临时目录的步骤');
  assert.ok(/if: always\(\)/.test(workflowCode), '清理步骤没有 if: always()：构建失败时它不跑');
  // 产物目录只收 dist：任何 `path: **` 都会把工作区里的东西一起收进 artifact
  const upload = /path:\s*(\S+)/.exec(workflowCode)?.[1];
  assert.equal(upload, 'dist/*', `artifact 的 path 是 ${String(upload)}，它会把 keystore / 工程一起收走`);
});

test('别名不是秘密（keystore 里的标签），指纹是公开信息（钉在变量里并断言）', () => {
  assert.ok(workflowCode.includes("vars.ANDROID_KEY_ALIAS || 'sixty'"), '别名没有回退到缺省值');
  assert.equal(
    /secrets\.ANDROID_KEY_ALIAS/.test(WORKFLOW),
    false,
    '别名又被当成 secret：它是 keystore 内部的一个标签，可推导，只会在发布时白卡一次'
  );
  assert.ok(workflowCode.includes('vars.ANDROID_CERT_SHA256'), '证书指纹没有钉在仓库变量里');
  assert.ok(
    /ANDROID_CERT_SHA256 不一致/.test(workflowCode) && /::error::/.test(workflowCode),
    '指纹不一致时没有硬失败（那样换钥匙只会在发布当天才被发现）'
  );
});

test('签名只从手动触发与 v* 标签走，永不在 pull_request 上跑', () => {
  assert.ok(/workflow_dispatch:/.test(workflowCode), '没有手动触发');
  assert.ok(/push:\s*\n\s*tags:\s*\['v\*'\]/.test(workflowCode), '标签触发没写（或写成了别的 ref）');
  assert.equal(
    /pull_request/.test(workflowCode),
    false,
    '工作流在 pull_request 上跑：fork 拿不到 secret，PR 里也不该产出可安装的包'
  );
});

test('bubblewrap 的两步都在（少了 update 会卡在交互询问上）', () => {
  assert.ok(workflowCode.includes('update --skipVersionUpgrade'), '没有先跑 update：build 会停下来问「要不要更新工程」');
  assert.ok(workflowCode.includes('build --skipPwaValidation'), '没有 build（或少了跳过 PSI 校验的开关）');
});

