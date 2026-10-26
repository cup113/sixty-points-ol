# Android 安装包（TWA）

这里只有一份 `twa-manifest.template.json`：`.github/workflows/apk.yml` 用 `envsubst` 把域名、包名、
版本与 keystore 路径填进去，再交给 [bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
生成 Android 工程并签名。设计取舍见 `docs/adr/0026-pwa-twa-apk.md`，用户视角的说明见根 `README.md`。

为什么不是 `bubblewrap init`：`init` 是一条问卷（包名、图标、颜色、签名全要人答）。
模板 + `update --skipVersionUpgrade` 是同一件事的非交互写法 —— 配置进仓库、走 review，
而不是留在某个人的终端历史里。

## 一次性准备：签名 keystore

正式分发**必须**用自己的 keystore。指纹是 assetlinks 的锚点，换一次签名就等于换一个应用身份
（已装的包升级不上去，只能卸载重装）。

```bash
keytool -genkeypair -v -keystore android.keystore -storetype PKCS12 \
  -alias sixty -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 android.keystore > android.keystore.b64      # macOS: base64 -i android.keystore -o android.keystore.b64
```

**按「泄露了会怎样」分两类**，别把两者混在一起：

| Secrets（泄露 = 别人能发你的更新） | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | `android.keystore.b64` 的内容 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令 |
| `ANDROID_KEY_PASSWORD` | 密钥口令（PKCS12 里通常与上面相同） |

| Variables（可推导 / 公开，放 Secret 里只会白卡发布） | 值 |
| --- | --- |
| `ANDROID_CERT_SHA256` | 证书的 SHA-256 指纹，`BUILD-INFO.md` 里有。**钉住它**：设了之后指纹一变 CI 就硬失败；首次发布前为空，只告警 |
| `ANDROID_KEY_ALIAS` | 缺省 `sixty`。它是 keystore **里面**的一个标签，不是秘密 |
| `SIXTY_DOMAIN` | 推 `v*` 标签构建时用的域名（手动触发用输入，可留空） |
| `ANDROID_PACKAGE_ID` / `ANDROID_APP_NAME` | 标签构建用的包名 / 应用名，缺省同手动触发的默认值 |

**keystore 不进仓库**（`.gitignore` 里也留着它）。丢了就再也发不出能覆盖安装的更新 ——
与 `data/sixty.db` 一样按「丢了就麻烦」的东西备份。

没配 `ANDROID_KEYSTORE_B64` 时工作流会现场生成一次性 keystore 并告警：那种包能装、能打牌，
但指纹每次都变，assetlinks 对不上（于是带地址栏），且不能覆盖安装。只适合试装。

口令怎么进出：只经环境变量进容器、只经 `keytool -storepass:env` 进 keytool（**不进 argv**：
`-storepass xxx` 会出现在进程列表里）；keystore 解到 `$RUNNER_TEMP/twa`（工作区之外，
任何 artifact 通配都扫不到），构建结束用 `if: always()` 的步骤删掉。

## 跑一次

两条路：

- **手动**：Actions 页面 → **Android APK (TWA)** → Run workflow，填下面的输入；
- **发版**：推 `v*` 标签。域名/包名/应用名改从仓库变量读（`SIXTY_DOMAIN` 必须配，否则这个作业直接跳过），
  产物会挂到同名 Release 上（不存在就建一个只带 APK 的）。

| 输入 | 说明 |
| --- | --- |
| `domain` | 站点域名，**不要带协议**（`game.example.com`）。必须公网 HTTPS 可达 |
| `package_id` | 默认为 `io.github.cup113.sixty`。装上后再改要换包（等于另一个应用） |
| `app_name` | 桌面上的名字，默认 `六十分` |
| `orientation` | `portrait` / `any` / `default` |
| `version_name` | 留空 = `run-<短 sha>` |
| `version_code` | 留空 = 按 UTC 的 `yymmddhh` 生成。**只增不减**；同一小时重跑拿到相同的值，Android 允许「相同」覆盖安装，只在更小时才拒绝 |
| `release_tag` | 可选：把产物挂到这个 Release（不存在则创建）。这一步需要 `contents: write`，所以是单独一个作业 |

产物是 artifact `sixty-apk`：`sixty-<包名>.apk` + `BUILD-INFO.md`（含包名、SHA-256 指纹、
以及该贴进服务端的那两行环境变量）。

**验的是产物不是绿勾**：工作流最后会用 runner 上的 `apksigner verify --print-certs` 确认签的不是
`Android Debug`，再用 `aapt2 dump badging` 核对包名与 `versionCode` 就是本次输入的那些
（工具缺失时告警跳过，不让它变成假红）。手动核对同一件事：

```bash
apksigner verify --print-certs sixty-<包名>.apk
aapt2 dump badging sixty-<包名>.apk | head -1
```

## 然后让站点认这门亲

TWA 只有在 `https://<域名>/.well-known/assetlinks.json` 里认出签名指纹时才拿走地址栏。
在部署环境里配：

```bash
SIXTY_TWA_PACKAGE=io.github.cup113.sixty
SIXTY_TWA_FINGERPRINTS=AB:CD:…（BUILD-INFO.md 里那一串；多个用逗号分隔）
```

重启容器后自检：

```bash
curl -s https://game.example.com/.well-known/assetlinks.json
```

没配这两个变量时这条路由是 **404**（与 Gitee 登录「不配即隐身」同口径）；配了但写错（包名不合法、
指纹不是 SHA-256）会返回 500 —— 那是故意的：写错必须当场看得见，否则只会得到「带地址栏的 APK」，
没人会去查。

## 手工跑（不经过 Actions）

```bash
mkdir -p twa
DOMAIN=game.example.com PACKAGE_ID=io.github.cup113.sixty APP_NAME=六十分 \
ORIENTATION=portrait VERSION_NAME=run-local VERSION_CODE=$(date -u +%y%m%d%H) \
KEYSTORE_PATH=/workspace/android.keystore KEY_ALIAS=sixty \
  envsubst < deploy/twa/twa-manifest.template.json > twa/twa-manifest.json
cp android.keystore twa/

export BUBBLEWRAP_KEYSTORE_PASSWORD=… BUBBLEWRAP_KEY_PASSWORD=…
docker run --rm -v "$PWD/twa:/workspace" -w /workspace \
  -e BUBBLEWRAP_KEYSTORE_PASSWORD -e BUBBLEWRAP_KEY_PASSWORD \
  ghcr.io/googlechromelabs/bubblewrap:latest update --skipVersionUpgrade
docker run --rm -v "$PWD/twa:/workspace" -w /workspace \
  -e BUBBLEWRAP_KEYSTORE_PASSWORD -e BUBBLEWRAP_KEY_PASSWORD \
  ghcr.io/googlechromelabs/bubblewrap:latest build --skipPwaValidation
```

`update` 不能省：它从 manifest 生成 Android 工程并写下 `manifest-checksum.txt`。
少了它，`build` 会停下来问「要不要更新工程」，而 CI 里没人回答。

## 排错

| 症状 | 原因 / 处理 |
| --- | --- |
| `update` 报拉不到图标 / manifest | `domain` 不是公网可达的 HTTPS 地址。bubblewrap 要真去取一次 |
| Gradle 卡在下载依赖 | 构建机出网问题；换 runner 或给容器配代理（`-e HTTP_PROXY`） |
| 装在手机上打开带地址栏 | assetlinks 没配、指纹不匹配、或域名与 `host` 不一致。先 `curl` 那份 JSON |
| 改了域名后 App 打不开站点 | APK 与域名绑定，换域名要重打包 |
| 覆盖安装被拒 | `version_code` 没增，或签名换了（换签名只能卸载重装） |
| 装的时候被拦下 | 未签名/来源不明应用的系统校验，手机上允许一次即可 |
| 全 pass 之类的行为差异 | 无关：TWA 打开的就是线上站点，规则与网页完全同一份 |

## 不在本期范围

Play 上架（`.aab` 已经产出，需要时接 `bubblewrap play publish` 与 service account）；
iOS 商店（Safari 的「添加到主屏幕」已经够用）；推送通知（牌局不需要，而且国内 ROM 会反复弹权限）。
