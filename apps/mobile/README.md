# 六十分 · Android 壳（Capacitor）

把线上站点包成一个能装进手机的 Android 安装包。**没有第二套代码**：这是一个 Capacitor
壳，启动即用系统 WebView 打开 `SIXTY_SERVER_URL` 指向的站点 —— 对局、身份、SSE、MCP
全在服务端，壳里只有一个 WebView 和一页离线兜底。

决策与取舍见 [ADR-0027](../../docs/adr/0027-capacitor-apk-shell.md)。要点：

- 这个站**没有**可打包的静态产物（`adapter-node` 构建出的是服务端），所以没有「离线也能打牌」
  这条路，`server.url` 也是 Capacitor 官方标注「不建议用于生产」的用法；
- 换掉 TWA 的理由是**不依赖设备上装了支持 TWA 的浏览器**（国内 ROM 常缺），并且图标/启动页/
  返回键/离线页都在自己手里；
- 壳里**不注册** Service Worker（`apps/web/src/lib/native-shell.ts`）：注册了会把线上页面缓存
  在 WebView 里，下一次部署后用户得彻底杀掉应用才拿到新版。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `capacitor.config.ts` | 壳的配置。`server.url` 取 `SIXTY_SERVER_URL`，缺省只是本地占位 |
| `www/` | `webDir`。`index.html` 是占位（`server.url` 下不会被加载），`offline.html` 是断网 / 内核过旧时真正显示的页 |
| `android/` | `cap add android` 生成后提交的工程，改过的每一处都在 ADR-0027 里列了 |
| `scripts/make-icons.py` | 各密度图标与启动图（Pillow，4× 超采样 → LANCZOS）。改 logo 时手跑一次 |

`android/` 里被 gitignore 掉的是生成物：`build/`、`.gradle/`、`local.properties`、
`app/src/main/assets/public/`、`app/src/main/assets/capacitor.config.json`。
**所以直接 `gradlew` 之前必须先 `sync`。**

## 本地构建

```bash
pnpm install
pnpm --filter mobile run sync          # 写 assets/capacitor.config.json + 拷 www/
apps/mobile/android/gradlew -p apps/mobile/android :app:assembleDebug
```

产物在 `apps/mobile/android/app/build/outputs/apk/`。要指向别的环境就把地址带上：

```bash
SIXTY_SERVER_URL=https://你的域名 pnpm --filter mobile run sync
```

## 三种自检（发布前跑一遍，各自证明一件事）

1. **无密钥 debug** —— 壳、清单、资源、`MainActivity` 都能编译：证明工程本身没坏。
2. **无密钥 release** —— **必须失败**，报「缺少发布签名材料……」。它证明「缺 key 时不会悄悄
   产出一个未签名的包」；这条不红就说明 Gradle 那段拦截失效了。
3. **一次性密钥 release** —— 证明环境变量的接线真的通了，并出现真实的 V2 签名：

```bash
export SIXTY_KEYSTORE_PATH="$PWD/.tmp/android.keystore"
export SIXTY_KEYSTORE_PASSWORD="$(openssl rand -hex 16)"
export SIXTY_KEY_PASSWORD="$SIXTY_KEYSTORE_PASSWORD"
export SIXTY_KEY_ALIAS=sixty
export SIXTY_VERSION_CODE=26102700 SIXTY_VERSION_NAME=local-test
KS_PASS="$SIXTY_KEYSTORE_PASSWORD" keytool -genkeypair -keystore "$SIXTY_KEYSTORE_PATH" \
  -storetype PKCS12 -alias sixty -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass:env KS_PASS -dname "CN=sixty-points-ol, OU=adhoc, O=adhoc, C=CN"

apps/mobile/android/gradlew -p apps/mobile/android :app:assembleRelease --no-daemon
"$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs \
  apps/mobile/android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME"/build-tools/*/aapt2 dump badging \
  apps/mobile/android/app/build/outputs/apk/release/app-release.apk | head -1
```

第 3 步只想验线，验完把 `.tmp/` 删掉；**不要**把一次性 keystore 留在工作区（它已经被
`.gitignore` 的 `*.keystore*` 挡掉，但那是最后一道闸，不是理由）。

## CI

`.github/workflows/apk.yml`：手动触发或推 `v*` 标签。手动触发唯一的必填项是 `url`。

| Secrets（会泄露 = 别人能发你的更新） |
| --- |
| `ANDROID_KEYSTORE_B64`（`base64 -w0 android.keystore`） |
| `ANDROID_KEYSTORE_PASSWORD` |
| `ANDROID_KEY_PASSWORD` |

| Variables（公开信息或可推导的值） |
| --- |
| `ANDROID_CERT_SHA256` —— 证书指纹，**设了就会被硬断言**；首次发布前为空时只告警 |
| `ANDROID_KEY_ALIAS` —— keystore 内部的标签，缺省 `sixty` |
| `SIXTY_SERVER_URL` —— 标签构建用的站点地址 |

没配 `ANDROID_KEYSTORE_B64` 也能跑：工作流会现场生成一次性 keystore 并告警 —— 那种包只能试装
（指纹每次都不同，两个包互相覆盖不了）。

## 排障

| 症状 | 原因与处理 |
| --- | --- |
| `Downloading https://services.gradle.org/...` 卡住或 10s 超时 | 网络到不了 Gradle 分发站。本地把 `gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 临时指向 `~/.gradle/wrapper/dists` 里已有的版本，**构建完逐字节还原**（CI 的 runner 不受影响，不要提交这次替换） |
| `No signature of method: java.lang.String.call()` | `build.gradle` 里局部变量与 `signingConfigs` 的属性重名（`keyAlias` / `keyPassword`），Groovy 会把 `keyAlias x` 派发成「调用这个 String」。变量名加前缀 |
| `IllegalArgumentException: Value is null` | `versionCode (expr)` 少了等号，Groovy 当成「调用还没赋值的属性」 |
| 启动画面 / 状态栏是靛蓝 | `res/values/colors.xml` 没覆盖 `@capacitor/android` 的 `colorPrimary` |
| 桌面图标是 Capacitor 的 logo | 没跑 `scripts/make-icons.py`（或跑完没重新 `sync`/重装） |
| 装上后一片空白又没提示 | 系统 WebView 太旧：`minWebViewVersion: 90` 以下会走 `offline.html`；仍空白就看 `adb logcat` 里的 Chromium 报错 |
| 按返回直接退出应用 | `MainActivity` 的返回回调被删了：Capacitor 8 的 `BridgeActivity` 自己不处理返回键 |
| Gitee 登录跳去浏览器、回来仍是未登录 | `allowNavigation` 里少了 `gitee.com` / `*.gitee.com`：站外链接被甩给系统浏览器，cookie 落在浏览器里 |

## 不在范围内

iOS 工程（要 macOS，iOS 用户走 PWA「添加到主屏幕」）、Play 上架、离线单机对局、
深链 OAuth 回传（App 内与系统浏览器的会话是两套 cookie，不互通）。
