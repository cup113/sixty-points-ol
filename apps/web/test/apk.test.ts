/**
 * Android 安装包守卫（ADR-0027）：Capacitor 壳的配置、Gradle 的版本与签名、
 * 图标资源，以及工作流本身的形状。
 *
 * 这里守的都是「编译不报、类型不报、装上才看得见」或「只在发布当天才炸」的东西：
 * - 壳指向哪个域名、Gitee 登录留在不在 WebView 里、断网落到哪一页；
 * - `versionCode` 的写法（Groovy 会把它派发成「调用一个还没赋值的属性」）；
 * - 缺签名材料时**不许**悄悄产出未签名的 release；
 * - 自适应图标的前景超出安全圆（启动器一裁就掉字）；
 * - 品牌色退回 `@capacitor/android` 的靛蓝；
 * - 口令进 argv、keystore 落进工作区、工作流跑到 `pull_request` 上。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

const root = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const bytes = (path: string): Buffer => readFileSync(new URL(path, root));

const CONFIG = read('apps/mobile/capacitor.config.ts');
const GRADLE = read('apps/mobile/android/app/build.gradle');
/** 只看代码，不看注释：注释里那句 `versionCode (expr)` 是说明，不是写法。 */
const GRADLE_CODE = GRADLE.split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');
const MANIFEST = read('apps/mobile/android/app/src/main/AndroidManifest.xml');
const COLORS = read('apps/mobile/android/app/src/main/res/values/colors.xml');
const ICON_BG = read('apps/mobile/android/app/src/main/res/values/ic_launcher_background.xml');
const ACTIVITY = read('apps/mobile/android/app/src/main/java/io/github/cup113/sixty/MainActivity.java');
const WEB_MANIFEST = JSON.parse(read('apps/web/static/manifest.webmanifest')) as {
  theme_color?: string;
  background_color?: string;
};

test('壳加载线上站点：地址来自环境、允许 Gitee 留在 WebView、断网有本地页', () => {
  assert.match(CONFIG, /webDir:\s*'www'/, 'webDir 不是 www');
  assert.ok(bytes('apps/mobile/www/index.html').length > 0, 'www/index.html 不存在（cap sync 会直接失败）');

  // 地址是部署事实：缺省占位 + 环境变量覆盖，绝不把某个域名硬写死在源码里
  assert.match(CONFIG, /SIXTY_SERVER_URL/, 'server.url 没有从 SIXTY_SERVER_URL 取');
  assert.match(CONFIG, /cleartext:\s*false/, '允许了明文传输');

  // Gitee 登录是整页 302 出去再回来：不放行就等于把用户甩到系统浏览器，
  // cookie 落在浏览器里，回到应用仍是未登录
  assert.match(CONFIG, /allowNavigation:\s*\[[^\]]*'gitee\.com'/, 'allowNavigation 没放行 gitee.com');
  assert.match(CONFIG, /allowNavigation:\s*\[[^\]]*'\*\.gitee\.com'/, 'allowNavigation 没放行 *.gitee.com');

  // errorPath 指向的文件必须真实存在，否则断网时是一屏 WebView 的默认错误页
  assert.match(CONFIG, /errorPath:\s*'offline\.html'/, 'errorPath 没有指向 offline.html');
  const offline = read('apps/mobile/www/offline.html');
  assert.match(offline, /重试/, 'offline.html 没有重试入口');
});

test('版本号与签名材料都从环境变量来，不写回受版本控制的文件', () => {
  // Groovy：`versionCode (expr)` 会被派发成「调用其实还是 null 的属性」，
  // 配置期 IllegalArgumentException: Value is null。必须带等号。
  assert.match(GRADLE_CODE, /versionCode\s*=/, 'versionCode 没有用 `=` 赋值');
  assert.equal(/versionCode\s+[^=\s]/.test(GRADLE_CODE), false, '出现了 `versionCode 1` 这种空格写法');
  assert.match(GRADLE_CODE, /versionName\s*=/, 'versionName 没有用 `=` 赋值');
  assert.match(GRADLE, /SIXTY_VERSION_CODE/, 'versionCode 没有从 SIXTY_VERSION_CODE 取');
  assert.match(GRADLE, /SIXTY_VERSION_NAME/, 'versionName 没有从 SIXTY_VERSION_NAME 取');

  for (const key of ['SIXTY_KEYSTORE_PATH', 'SIXTY_KEYSTORE_PASSWORD', 'SIXTY_KEY_PASSWORD', 'SIXTY_KEY_ALIAS']) {
    assert.ok(GRADLE.includes(key), `签名配置里没有读 ${key}`);
  }
  // 别名有缺省值：它是 keystore 里的一个标签，可推导，不该让发布因它卡住
  assert.match(GRADLE, /SIXTY_KEY_ALIAS"\)\s*\?:\s*"sixty"/, '签名别名没有缺省值');
});

test('缺签名材料时 release 必须失败，而不是产出一个未签名的包', () => {
  assert.match(GRADLE, /GradleException/, '缺 key 时没有硬失败');
  assert.match(GRADLE, /taskGraph\.whenReady/, '缺少 taskGraph 级别的拦截（只在 signingConfigs 里判空挡不住 unmapped release）');
  assert.match(GRADLE, /'assembleRelease'/, '拦截名单里没有 assembleRelease');
  // 只有拿到 key 才挂签名配置：无条件挂上去会让 release 包变成「无签名」
  assert.match(GRADLE, /if\s*\(hasReleaseKey\)\s*\{\s*signingConfig\s+signingConfigs\.release/, 'release 没有按 hasReleaseKey 条件挂签名配置');

  const applicationId = /applicationId\s+"([^"]+)"/.exec(GRADLE)?.[1];
  const appId = /appId:\s*'([^']+)'/.exec(CONFIG)?.[1];
  assert.ok(applicationId, 'build.gradle 里没有 applicationId');
  assert.equal(applicationId, appId, `包名两处不一致：gradle=${String(applicationId)} capacitor=${String(appId)}（换成另一个包名 = 旧安装永远升不上来）`);
});

test('清单：只走 https、竖屏、density 在 configChanges 里', () => {
  assert.match(MANIFEST, /android:usesCleartextTraffic="false"/, '允许了明文流量');
  assert.match(MANIFEST, /android:screenOrientation="portrait"/, '没有锁竖屏（牌桌是竖屏版面）');
  const configChanges = /android:configChanges="([^"]+)"/.exec(MANIFEST)?.[1] ?? '';
  assert.ok(configChanges.split('|').includes('density'), 'configChanges 少了 density：系统改缩放会重建 WebView');
});

test('品牌色：不退回 @capacitor/android 的靛蓝，且与 manifest 同色', () => {
  const primary = /name="colorPrimary">([^<]+)</.exec(COLORS)?.[1];
  const primaryDark = /name="colorPrimaryDark">([^<]+)</.exec(COLORS)?.[1];
  assert.ok(primary, 'values/colors.xml 里没有覆盖 colorPrimary');
  assert.notEqual(primary?.toLowerCase(), '#3f51b5', 'colorPrimary 还是库里的靛蓝 #3F51B5（启动画面会漏出别人的品牌色）');
  assert.equal(primary, WEB_MANIFEST.background_color, 'colorPrimary 与 manifest.background_color 不是同一个墨绿');
  assert.equal(primaryDark, WEB_MANIFEST.theme_color, 'colorPrimaryDark 与 manifest.theme_color 不是同一个墨绿');

  const iconBg = /name="ic_launcher_background">([^<]+)</.exec(ICON_BG)?.[1];
  assert.equal(iconBg, WEB_MANIFEST.background_color, '自适应图标的背景层与 manifest.background_color 漂了');
});

test('返回键先在 WebView 历史里退，不写这段就是「按返回直接退出应用」', () => {
  assert.match(ACTIVITY, /OnBackPressedCallback/, 'MainActivity 没有接管返回键');
  assert.match(ACTIVITY, /canGoBack\(\)/, '没有判断 WebView 是否还有上一屏');
  assert.match(ACTIVITY, /goBack\(\)/, '没有在 WebView 里后退');
});

/**
 * 自适应图标：前景层必须落在中央 66/108 的安全圆内，否则启动器一裁就掉字。
 * 这里**真解码**像素再量，而不是相信生成脚本里的常量 —— 常量改错了图还是 PNG。
 */
test('启动图标：各密度齐全、尺寸正确、前景没出安全圆', () => {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;

  for (const [name, factor] of Object.entries(dens)) {
    const base = `apps/mobile/android/app/src/main/res/mipmap-${name}`;

    for (const file of ['ic_launcher.png', 'ic_launcher_foreground.png']) {
      const png = decodeRgba(bytes(`${base}/${file}`));
      const expected = Math.round((file === 'ic_launcher.png' ? 48 : 108) * factor);
      assert.equal(png.width, expected, `${base}/${file} 宽 ${png.width}，应为 ${expected}`);
      assert.equal(png.height, expected, `${base}/${file} 高 ${png.height}，应为 ${expected}`);
    }

    const fg = decodeRgba(bytes(`${base}/ic_launcher_foreground.png`));
    const safeRadius = (fg.width * 66) / 108 / 2;
    let far = 0;
    for (let y = 0; y < fg.height; y += 1) {
      for (let x = 0; x < fg.width; x += 1) {
        if (fg.alpha(x, y) <= 8) continue;
        far = Math.max(far, Math.hypot(x - fg.width / 2 + 0.5, y - fg.height / 2 + 0.5));
      }
    }
    assert.ok(far > 0, `${base}/ic_launcher_foreground.png 整张全透明`);
    assert.ok(far <= safeRadius, `${base} 的前景画到了 r=${far.toFixed(1)}，超出安全圆 ${safeRadius.toFixed(1)}（启动器会裁掉）`);
  }
});

/**
 * 工作流：口令怎么进出 runner 是**读一遍看不出来**的那类错 —— 口令进 argv 只是
 * 进程列表里多一行，keystore 落进工作区只是被某个通配扫进去，别名被要求成 secret
 * 只是发布时才发现「可推导的值没配」。所以在这里钉形状。
 */
const WORKFLOW = read('.github/workflows/apk.yml');

/** 去掉整行 YAML 注释：注释里写着「别把口令放进 argv」不构成实现 */
const workflowCode = WORKFLOW.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** `run: |` 块里的每一行：那里的 `${{ }}` 等于把用户输入当代码执行 */
function runBlockLines(source: string): string[] {
  const lines = source.split('\n');
  const inside: string[] = [];
  let blockIndent = -1;

  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    if (/\brun:\s*[|>]/.test(line)) {
      blockIndent = indent;
      continue;
    }
    if (blockIndent >= 0) {
      if (line.trim() === '') continue;
      if (indent <= blockIndent) blockIndent = -1;
      else inside.push(line);
    }
  }
  return inside;
}

test('输入不插进 shell：run 块里没有 ${{ }}', () => {
  const offenders = runBlockLines(workflowCode).filter((line) => line.includes('${{'));
  assert.deepEqual(offenders, [], `这些 run 行把插值写进了脚本：\n${offenders.join('\n')}`);
});

test('口令不进 argv：只许 -storepass:env（`-storepass xxx` 在进程列表里看得见）', () => {
  assert.ok(workflowCode.includes('-storepass:env'), '没有用 -storepass:env 传口令');
  assert.equal(/-storepass(?!:env)/.test(workflowCode), false, '出现了 `-storepass <值>`：口令会被写进进程列表');
  assert.equal(/-keypass/.test(workflowCode), false, '又传了 -keypass：PKCS12 下它就是 store 口令的副本');
  // Gradle 的签名口令也只能经环境变量
  assert.equal(/storePassword\s*=\s*['"]/.test(workflowCode), false, '口令写进了 gradle 参数');
});

test('keystore 落在 $RUNNER_TEMP（工作区之外），并且用完就删', () => {
  assert.ok(workflowCode.includes('RUNNER_TEMP'), 'keystore 没有被放到 $RUNNER_TEMP');
  assert.ok(workflowCode.includes('umask 077'), '没有收紧 umask，同机其它进程能读到 keystore');
  assert.ok(/rm -rf "\$\{?RUNNER_TEMP\}?\//.test(workflowCode), '没有清理临时目录的步骤');
  assert.ok(/if: always\(\)/.test(workflowCode), '清理步骤没有 if: always()：构建失败时它不跑');
  const upload = /path:\s*(\S+)/.exec(workflowCode)?.[1];
  assert.equal(upload, 'dist/*', `artifact 的 path 是 ${String(upload)}，它会把 keystore / 工程一起收走`);
});

test('别名不是秘密（keystore 里的标签），指纹是公开信息（钉在变量里并断言）', () => {
  assert.ok(workflowCode.includes('vars.ANDROID_KEY_ALIAS'), '别名没有从仓库变量取（缺省 sixty）');
  assert.equal(/secrets\.ANDROID_KEY_ALIAS/.test(WORKFLOW), false, '别名又被当成 secret：可推导的值只会在发布时白卡一次');
  assert.ok(workflowCode.includes('vars.ANDROID_CERT_SHA256'), '证书指纹没有钉在仓库变量里');
  assert.ok(
    /ANDROID_CERT_SHA256 不一致/.test(workflowCode) && /::error::/.test(workflowCode),
    '指纹不一致时没有硬失败（那样换钥匙只会在发布当天才被发现）'
  );
});

test('构建路线：pnpm sync + gradlew assembleRelease --no-daemon，且不自己装 Android SDK', () => {
  assert.ok(workflowCode.includes('pnpm --filter mobile run sync'), '没有先 cap sync（android 工程缺 assets/capacitor.config.json）');
  assert.ok(/gradlew[^\n]*assembleRelease/.test(workflowCode) || /assembleRelease/.test(workflowCode), '没有跑 assembleRelease');
  assert.ok(workflowCode.includes('--no-daemon'), '没有 --no-daemon：daemon 会带上首次启动时的环境变量（版本号/口令可能不生效）');
  assert.ok(workflowCode.includes('chmod +x'), '没有给 gradlew 执行位（Windows 上提交的文件默认 644）');
  assert.equal(
    /android-actions\/setup-android/.test(workflowCode),
    false,
    '用了 android-actions/setup-android：它在 ubuntu-latest 上会 `Failed to find package tools` 直接死在第一步'
  );
  // TWA 那套东西一个都不该留下
  assert.equal(/bubblewrap/i.test(workflowCode), false, '工作流里还留着 bubblewrap');
  assert.equal(/assetlinks/.test(workflowCode), false, '工作流里还留着 assetlinks 校验');
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

/** 极简 PNG 解码：只吃 8 位、非隔行的 RGBA（Pillow 输出的就是这种），够本文件用。 */
function decodeRgba(png: Buffer): { width: number; height: number; alpha: (x: number, y: number) => number } {
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG', '不是 PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '只支持 8 位深');
      assert.equal(data[9], 6, '只支持 RGBA（colorType 6）');
      assert.equal(data[12], 0, '不支持隔行 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? out[i - bpp]! : 0;
      const up = prev ? prev[i]! : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp]! : 0;
      let value = row[i]!;

      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          assert.fail(`未知的 PNG 行过滤器 ${filter}`);
      }

      out[i] = value & 0xff;
    }
  }

  return { width, height, alpha: (x, y) => pixels[y * stride + x * 4 + 3]! };
}
