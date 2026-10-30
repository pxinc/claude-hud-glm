export const messages = {
  en: {
    fiveHour: '5h used', week: 'Week used', shortWeek: 'wk', used: 'GLM used',
    resetDue: 'reset due', stale: 'stale', loading: 'loading', minutesAgo: '{n}m ago',
    invalidUrl: 'invalid URL', missingToken: 'missing API key', cacheError: 'cache error',
    timeout: 'timeout', rateLimited: 'rate limited', authFailed: 'authentication failed',
    apiError: 'API error', badResponse: 'invalid response', quotaUnavailable: 'quota unavailable',
    networkError: 'network error', refreshPending: 'refresh incomplete', unknownError: 'unknown error',
    settingsChanged: 'Settings changed; no changes were written.',
    incompatibleHud: 'Incompatible Claude HUD; settings were not changed. See the tested versions in the project documentation.',
    layoutRequired: 'Enable the Claude HUD expanded layout and Context; run /claude-hud:configure first.',
    unsupportedWindows: 'The installer supports macOS and Linux; Windows is not supported.',
    setupUsage: 'Usage: bun setup.mjs install|uninstall|check',
    hudCheckPassed: 'Claude HUD compatibility check passed: {path}',
    notInstalled: 'Not installed; no restoration is needed.',
    alreadyRestored: 'The previous status line is already restored.',
    restoreConflict: 'The status line changed after installation; check install-state.json before restoring.',
    restored: 'Restored the previous status line. Other settings are unchanged; runtime files and backup remain.',
    installConflict: 'An installation record exists and the status line has changed; check the backup before installing.',
    installed: 'Installed: the status line redraws about every 15 seconds; GLM quota is queried at most once per five minutes. Restart Claude Code if the window does not update.',
    hudNotInstalled: 'Claude HUD is not installed. Install it and complete setup first.',
    hudNotFound: 'No compatible Claude HUD source was found. See the tested versions in the project documentation.',
  },
  'zh-Hans': {
    fiveHour: '5h已用', week: '周已用', shortWeek: '周', used: 'GLM已用',
    resetDue: '待重置', stale: '过期', loading: '更新中', minutesAgo: '{n}m前',
    invalidUrl: '地址无效', missingToken: '未配置密钥', cacheError: '本地缓存异常',
    timeout: '超时', rateLimited: '限流', authFailed: '鉴权失败',
    apiError: '接口异常', badResponse: '数据格式变化', quotaUnavailable: '未识别配额',
    networkError: '网络异常', refreshPending: '刷新未完成', unknownError: '未知错误',
    settingsChanged: '配置已变化，停止写入。',
    incompatibleHud: 'claude-hud 接口不兼容，未修改配置；请查看项目文档中的已验证版本。',
    layoutRequired: '需要启用 claude-hud expanded 布局并显示 Context；请先运行 /claude-hud:configure。',
    unsupportedWindows: '安装器支持 macOS 和 Linux；不支持 Windows。',
    setupUsage: '用法：bun setup.mjs install|uninstall|check',
    hudCheckPassed: 'claude-hud 接口检查通过：{path}',
    notInstalled: '尚未安装，无需恢复。',
    alreadyRestored: '状态栏已恢复。',
    restoreConflict: '状态栏在安装后被修改；停止自动恢复，请检查 install-state.json。',
    restored: '已恢复原状态栏，其他设置保留。脚本和备份保留以便再次安装。',
    installConflict: '已有安装记录且状态栏被修改；请先检查备份，不会覆盖新配置。',
    installed: '已安装：状态栏约每 15 秒重绘，GLM 额度最多每 5 分钟查询一次。当前窗口未更新时重启 Claude Code。',
    hudNotInstalled: 'claude-hud 未安装。请先安装 claude-hud 并完成 setup。',
    hudNotFound: '未找到兼容的 claude-hud 源码；请查看项目文档中的已验证版本。',
  },
  'zh-Hant': {
    fiveHour: '5h已用', week: '週已用', shortWeek: '週', used: 'GLM已用',
    resetDue: '待重置', stale: '過期', loading: '更新中', minutesAgo: '{n}m前',
    invalidUrl: '網址無效', missingToken: '未設定金鑰', cacheError: '本機快取異常',
    timeout: '逾時', rateLimited: '請求受限', authFailed: '驗證失敗',
    apiError: 'API 異常', badResponse: '資料格式變更', quotaUnavailable: '無法識別額度',
    networkError: '網路異常', refreshPending: '更新未完成', unknownError: '未知錯誤',
    settingsChanged: '設定已變更，停止寫入。',
    incompatibleHud: 'claude-hud 介面不相容，設定未變更；請查看專案文件中的已驗證版本。',
    layoutRequired: '請啟用 claude-hud expanded 版面並顯示 Context，先執行 /claude-hud:configure。',
    unsupportedWindows: '安裝程式支援 macOS 和 Linux；不支援 Windows。',
    setupUsage: '用法：bun setup.mjs install|uninstall|check',
    hudCheckPassed: 'claude-hud 相容性檢查通過：{path}',
    notInstalled: '尚未安裝，無須還原。',
    alreadyRestored: '狀態列已還原。',
    restoreConflict: '安裝後狀態列已變更；停止自動還原，請檢查 install-state.json。',
    restored: '已還原原狀態列，其他設定不變。保留程式與備份以便重新安裝。',
    installConflict: '已有安裝紀錄且狀態列已變更；請先檢查備份，不會覆寫新設定。',
    installed: '已安裝：狀態列約每 15 秒重繪，GLM 額度最多每 5 分鐘查詢一次。若視窗未更新，請重新啟動 Claude Code。',
    hudNotInstalled: '尚未安裝 claude-hud。請先安裝並完成 setup。',
    hudNotFound: '找不到相容的 claude-hud 原始碼；請查看專案文件中的已驗證版本。',
  },
};

function languageFromLocale(value) {
  if (!value || typeof value !== 'string') return null;
  const tag = value.trim().replace(/\..*$/, '').replace(/@.*$/, '').replace(/_/g, '-');
  try {
    const locale = new Intl.Locale(tag);
    if (locale.language === 'en') return 'en';
    if (locale.language === 'zh') return locale.maximize().script === 'Hant' ? 'zh-Hant' : 'zh-Hans';
  } catch { /* C/POSIX and invalid locale tags fall back to English. */ }
  return null;
}

export function resolveLanguage(env = process.env) {
  const override = env.CLAUDE_HUD_GLM_LANG?.trim();
  if (override && override.toLowerCase() !== 'auto') return languageFromLocale(override) || 'en';
  const locale = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find(value => typeof value === 'string' && value.trim());
  return languageFromLocale(locale) || 'en';
}

export function t(key, language = resolveLanguage(), values = {}) {
  let text = messages[language]?.[key] ?? messages.en[key];
  if (text === undefined) throw new Error(`Missing translation: ${key}`);
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

const legacyErrors = {
  '超时': 'timeout', '限流': 'rateLimited', '鉴权失败': 'authFailed',
  '接口异常': 'apiError', '数据格式变化': 'badResponse', '未识别配额': 'quotaUnavailable',
  '网络异常': 'networkError', '刷新未完成': 'refreshPending', '过期': 'stale',
};

export function errorText(code, language = resolveLanguage()) {
  const key = legacyErrors[code] || code;
  if (typeof key === 'string' && /^HTTP\d{3}$/.test(key)) return key;
  return t(Object.hasOwn(messages.en, key) ? key : 'unknownError', language);
}
