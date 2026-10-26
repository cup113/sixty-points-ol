/**
 * Digital Asset Links：Android 安装包（TWA）与本站之间的信任声明（ADR-0026）。
 *
 * TWA 只在 `/.well-known/assetlinks.json` 里认得出**签名证书指纹**时才拿走地址栏；
 * 认不出也不拦着用，只是退化成带浏览器 UI 的形态 —— 所以这份声明错了不会「打不开」，
 * 而是**看不出来地**降级。因此这里的配置一律从严：指纹形状不对就抛，不静默跳过。
 *
 * 与 Gitee 登录同一套口径：变量没配齐 = 整个功能隐身（路由回 404），
 * 绝不发一份空声明出去（空声明与「没这回事」语义不同，前者会被缓存）。
 */
export interface TwaConfig {
  /** Android 包名，如 `io.github.cup113.sixty` */
  readonly packageName: string;
  /** 签名证书的 SHA-256 指纹，`AB:CD:…` 形式（32 组两位大写十六进制） */
  readonly fingerprints: readonly string[];
}

/** Android 包名：至少两段，每段字母开头，只允许字母数字下划线 */
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * 指纹归一化：KeyTool / Play 控制台给的是 `AB:CD:…`，手抄时容易带上空格、小写或漏掉冒号。
 * 只认 SHA-256 这一档 —— TWA 也只接受它，放过一个 MD5 只会换来一条查不出来的降级。
 */
function normalizeFingerprint(raw: string): string {
  const hex = raw.replace(/[:\s]/g, '').toLowerCase();
  if (!SHA256_HEX.test(hex)) {
    throw new Error(
      `SIXTY_TWA_FINGERPRINTS 里有一项不是 SHA-256 指纹：${raw}（应为 32 组两位十六进制，如 AB:CD:…）`
    );
  }
  return (hex.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

/**
 * 未配置（任一为空）→ null：与 `giteeConfig` 同一口径，空串 = 没设。
 * 配了但写错 → 抛：部署错误要当场看得见，不能悄悄退化成「带地址栏的 APK」。
 */
export function twaConfig(env: Record<string, string | undefined> = process.env): TwaConfig | null {
  const packageName = env['SIXTY_TWA_PACKAGE']?.trim();
  const rawFingerprints = env['SIXTY_TWA_FINGERPRINTS']?.trim();
  if (packageName === undefined || packageName.length === 0) return null;
  if (rawFingerprints === undefined || rawFingerprints.length === 0) return null;

  if (!PACKAGE_NAME.test(packageName)) {
    throw new Error(`SIXTY_TWA_PACKAGE 不是合法的 Android 包名：${packageName}`);
  }

  const fingerprints = rawFingerprints
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(normalizeFingerprint);
  if (fingerprints.length === 0) return null;

  return { packageName, fingerprints };
}

export interface AssetLinkStatement {
  readonly relation: readonly string[];
  readonly target: {
    readonly namespace: 'android_app';
    readonly package_name: string;
    readonly sha256_cert_fingerprints: readonly string[];
  };
}

/**
 * `assetlinks.json` 的内容。`handle_all_urls` = 应用内的导航全部留在应用里（不弹浏览器）。
 */
export function assetLinks(config: TwaConfig): readonly AssetLinkStatement[] {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: config.packageName,
        sha256_cert_fingerprints: [...config.fingerprints]
      }
    }
  ];
}
