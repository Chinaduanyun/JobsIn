/**
 * FindJobs Chrome Extension — Background Service Worker
 *
 * 职责:
 * 1. 自动模式: 轮询后端获取采集命令 (navigate + extract)
 * 2. 陪伴模式: 监听用户浏览，在岗位详情页自动提取并保存
 * 3. 通过 chrome.tabs API 导航
 * 4. 向 content script 发消息提取 DOM 数据
 * 5. 把结果 POST 回后端
 */

const API_BASES = ['http://localhost:27788', 'http://127.0.0.1:27788'];
const POLL_INTERVAL = 1500; // ms
const REQUEST_TIMEOUT = 12000;
const POLL_ALARM_NAME = 'findjobs-command-poll';
const PENDING_RESULTS_STORAGE_KEY = 'pendingResultReports';
const MAX_PENDING_RESULT_RETRIES = 5;
let isPolling = false;
let pollInFlight = false;
let connected = false;
let tabId = null; // 采集用的标签页
let activeApiBase = API_BASES[0];
let lastBackendSeenAt = 0;
let pendingResultReports = [];

function getApiBaseCandidates() {
  return [activeApiBase, ...API_BASES.filter(base => base !== activeApiBase)];
}

async function apiFetch(path, options = {}) {
  let lastError = null;

  for (const base of getApiBaseCandidates()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      activeApiBase = base;
      lastBackendSeenAt = Date.now();
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
    }
  }

  throw lastError || new Error(`请求失败: ${path}`);
}

// ── 模式管理 ──────────────────────────────────
// 'auto' = 自动模式（轮询后端命令）
// 'companion' = 陪伴模式（监听用户浏览，自动保存岗位）
// 'greeting' = 沟通助手模式（仅页面内助手工作）
const VALID_MODES = new Set(['auto', 'companion', 'greeting']);
const POLLING_STORAGE_KEY = 'pollingEnabled';
let currentMode = 'auto';
const savedUrls = new Set(); // 陪伴模式已保存的 URL（避免重复保存）

function normalizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : 'auto';
}

function getStatus() {
  return {
    connected,
    polling: isPolling,
    tabId,
    mode: currentMode,
    activeApiBase,
    lastBackendSeenAt,
    pendingResultReports: pendingResultReports.length,
  };
}

function persistPendingResults() {
  chrome.storage.local.set({ [PENDING_RESULTS_STORAGE_KEY]: pendingResultReports });
}

async function enqueuePendingResult(report) {
  pendingResultReports = [
    ...pendingResultReports.filter(item => item.command_id !== report.command_id),
    report,
  ];
  persistPendingResults();
}

async function reportCommandResult(report) {
  const response = await apiFetch('/api/extension/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    throw new Error(`结果上报失败: ${response.status}`);
  }

  pendingResultReports = pendingResultReports.filter(item => item.command_id !== report.command_id);
  persistPendingResults();
}

async function flushPendingResults() {
  if (pendingResultReports.length === 0) return;

  const queue = [...pendingResultReports];
  for (const report of queue) {
    try {
      await reportCommandResult(report);
    } catch (err) {
      report.retry_count = (report.retry_count || 0) + 1;
      if (report.retry_count >= MAX_PENDING_RESULT_RETRIES) {
        pendingResultReports = pendingResultReports.filter(item => item.command_id !== report.command_id);
        persistPendingResults();
        console.warn('[FindJobs] 丢弃多次失败的结果上报:', report.command_id);
        continue;
      }
      pendingResultReports = pendingResultReports.map(item => item.command_id === report.command_id ? report : item);
      persistPendingResults();
      console.warn('[FindJobs] 结果补发失败，将继续重试:', err.message || err);
      break;
    }
  }
}

// ── 轮询后端命令 ──────────────────────────────

async function pollCommand() {
  if (!isPolling || pollInFlight) return;

  pollInFlight = true;
  try {
    await flushPendingResults();

    const resp = await apiFetch('/api/extension/command', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      connected = false;
      updateConnectionIcon();
      return;
    }

    const wasConnected = connected;
    connected = true;
    if (!wasConnected) updateConnectionIcon();

    const data = await resp.json();

    if (data && data.id) {
      console.log('[FindJobs] 收到命令:', data.type, data.id);
      await executeCommand(data);
    }
  } catch (err) {
    if (connected) {
      connected = false;
      updateConnectionIcon();
    }
    console.debug('[FindJobs] 轮询失败:', err.message);
  } finally {
    pollInFlight = false;
    ensurePollingAlarm();
  }
}

function ensurePollingAlarm() {
  if (!isPolling) return;
  chrome.alarms.clear(POLL_ALARM_NAME, () => {
    chrome.alarms.create(POLL_ALARM_NAME, { when: Date.now() + POLL_INTERVAL });
  });
}

// ── 连接状态图标更新 ─────────────────────────
function updateConnectionIcon() {
  if (connected) {
    chrome.action.setBadgeText({ text: ' ' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }); // green
  } else {
    chrome.action.setBadgeText({ text: ' ' });
    chrome.action.setBadgeBackgroundColor({ color: '#9ca3af' }); // gray
  }
}

// ── 执行命令 ──────────────────────────────────

async function executeCommand(cmd) {
  const { id, type } = cmd;
  let result = { success: false, error: 'unknown command type' };

  try {
    switch (type) {
      case 'navigate_and_extract_jobs':
        result = await handleExtractJobs(cmd);
        break;
      case 'navigate_and_extract_detail':
        result = await handleExtractDetail(cmd);
        break;
      case 'apply_job':
        result = await handleApplyJob(cmd);
        break;
      case 'ping':
        result = { success: true, data: { pong: true, timestamp: Date.now() } };
        break;
      default:
        result = { success: false, error: `未知命令: ${type}` };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  const report = { command_id: id, ...result, retry_count: 0 };

  // 报告结果
  try {
    await reportCommandResult(report);
  } catch (err) {
    console.error('[FindJobs] 报告结果失败，已加入重试队列:', err);
    await enqueuePendingResult(report);
  }
}

// ── 确保采集标签页存在 ────────────────────────

async function ensureTab() {
  if (tabId !== null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) return tabId;
    } catch {
      tabId = null;
    }
  }
  // 创建新标签页
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  tabId = tab.id;
  return tabId;
}

// ── 导航到 URL 并等待加载 ─────────────────────

function navigateAndWait(tid, url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('导航超时'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tid && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        // 额外等待 SPA 渲染
        setTimeout(() => resolve(), 1500);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tid, { url });
  });
}

// ── 向 content script 发消息 ──────────────────

function sendToContent(tid, message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('content script 响应超时'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tid, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── 采集岗位列表 ─────────────────────────────

async function handleExtractJobs(cmd) {
  const { url } = cmd;
  const tid = await ensureTab();

  try {
    await navigateAndWait(tid, url);
  } catch (err) {
    return { success: false, error: `导航失败: ${err.message}` };
  }

  const tab = await chrome.tabs.get(tid);
  const currentUrl = tab.url || '';
  if (currentUrl.includes('verify.html') || currentUrl.includes('security.html')) {
    await chrome.tabs.update(tid, { active: true });
    return { success: false, error: 'security_check', security_check: true };
  }
  if (currentUrl.includes('about:blank') && url !== 'about:blank') {
    return { success: false, error: '页面被重定向到空白页，可能被检测' };
  }

  await chrome.tabs.update(tid, { active: true });
  await new Promise(r => setTimeout(r, 2500));

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await sendToContent(tid, { action: 'extract_jobs' }, 45000);
      if (response?.jobs?.length || response?.empty) {
        return { success: true, data: response };
      }
      lastError = new Error(response?.message || '未提取到岗位卡片');
    } catch (err) {
      lastError = err;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  return { success: false, error: `提取失败: ${lastError?.message || '未知错误'}` };
}

// ── 采集岗位详情 ─────────────────────────────

async function handleExtractDetail(cmd) {
  const { url } = cmd;
  const tid = await ensureTab();

  try {
    await navigateAndWait(tid, url, 30000);
  } catch (err) {
    return { success: false, error: `导航失败: ${err.message}` };
  }

  const tab = await chrome.tabs.get(tid);
  const currentUrl = tab.url || '';
  if (currentUrl.includes('verify.html') || currentUrl.includes('security.html')) {
    await chrome.tabs.update(tid, { active: true });
    return { success: false, error: 'security_check', security_check: true };
  }
  if (currentUrl.includes('about:blank') && url !== 'about:blank') {
    return { success: false, error: '页面被重定向到空白页，可能被检测' };
  }

  await chrome.tabs.update(tid, { active: true });
  await new Promise(r => setTimeout(r, 2500));

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await sendToContent(tid, { action: 'extract_detail' }, 30000);
      if (response?.description || response?.company_size || response?.company_industry || response?.salary) {
        return { success: true, data: response };
      }
      lastError = new Error('详情页内容尚未就绪');
    } catch (err) {
      lastError = err;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  return { success: false, error: `提取失败: ${lastError?.message || '未知错误'}` };
}

// ── 自动投递 ──────────────────────────────────

async function handleApplyJob(cmd) {
  const { url, greeting_text } = cmd;
  const tid = await ensureTab();

  try {
    await navigateAndWait(tid, url);
  } catch (err) {
    return { success: false, error: `导航失败: ${err.message}` };
  }

  const tab = await chrome.tabs.get(tid);
  const currentUrl = tab.url || '';
  if (currentUrl.includes('verify.html') || currentUrl.includes('security.html')) {
    await chrome.tabs.update(tid, { active: true });
    return { success: false, error: 'security_check', security_check: true };
  }

  // 等待页面完全加载
  await new Promise(r => setTimeout(r, 2000));

  try {
    const response = await sendToContent(tid, {
      action: 'apply_job',
      greeting_text: greeting_text || '',
    }, 20000);

    // 检查是否需要在聊天页继续操作 (继续沟通场景 — 页面跳转)
    if (response && response.data && response.data.reason === 'redirecting_to_chat') {
      return await handleChatPageGreeting(tid, greeting_text);
    }

    return { success: true, data: response };
  } catch (err) {
    // 页面跳转导致 content script 被销毁 — 多种错误形式:
    // 1. Chrome 原生: "back/forward cache", "message channel is closed", "Receiving end does not exist"
    // 2. 自定义超时: "content script 响应超时" (content script 收到消息但中途被销毁)
    const msg = err.message || '';
    console.log('[FindJobs] apply_job 异常:', msg);

    // 检查是否跳转到了聊天页
    try {
      const tab = await chrome.tabs.get(tid);
      if (tab.url && tab.url.includes('/web/geek/chat')) {
        console.log('[FindJobs] 检测到已在聊天页，继续发送文案');
        return await handleChatPageGreeting(tid, greeting_text);
      }
    } catch { /* tab 可能已关闭 */ }

    // 等一下再检查，可能还在跳转中
    await waitForNavigation(tid, '/web/geek/chat', 5000);
    try {
      const tab2 = await chrome.tabs.get(tid);
      if (tab2.url && tab2.url.includes('/web/geek/chat')) {
        return await handleChatPageGreeting(tid, greeting_text);
      }
    } catch { /* ignore */ }

    return { success: false, error: `投递操作失败: ${msg}` };
  }
}

/**
 * 在聊天页发送打招呼文案
 */
async function handleChatPageGreeting(tid, greeting_text) {
  console.log('[FindJobs] 等待聊天页加载...');

  // 先确认已到聊天页 (可能正在跳转中)
  await waitForNavigation(tid, '/web/geek/chat', 10000);

  // 等 content script 注入并初始化
  await new Promise(r => setTimeout(r, 2000));

  // 最多重试 3 次发送 (content script 可能还没准备好)
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const chatResponse = await sendToContent(tid, {
        action: 'send_chat_greeting',
        greeting_text: greeting_text || '',
      }, 15000);
      return { success: true, data: chatResponse };
    } catch (err) {
      lastErr = err;
      console.log(`[FindJobs] 聊天页发送尝试 ${attempt + 1} 失败: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return { success: false, error: `聊天页发送失败: ${lastErr?.message}` };
}

/**
 * 等待标签页导航到包含指定路径的 URL
 */
function waitForNavigation(tid, urlContains, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // 超时不算失败，可能已经在目标页了
    }, timeoutMs);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tid && changeInfo.status === 'complete' && tab.url && tab.url.includes(urlContains)) {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        setTimeout(() => resolve(), 1500);
      }
    }

    // 先检查当前是否已在目标页
    chrome.tabs.get(tid).then(tab => {
      if (tab.url && tab.url.includes(urlContains)) {
        clearTimeout(timer);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

// ── 启动/停止轮询 ────────────────────────────

function startPolling() {
  if (isPolling) return;
  isPolling = true;
  chrome.storage.local.set({ [POLLING_STORAGE_KEY]: true });
  ensurePollingAlarm();
  console.log('[FindJobs] 开始轮询后端命令');
  pollCommand();
}

function stopPolling() {
  isPolling = false;
  chrome.alarms.clear(POLL_ALARM_NAME);
  chrome.storage.local.set({ [POLLING_STORAGE_KEY]: false });
  console.log('[FindJobs] 停止轮询');
}

// ── 陪伴模式：监听标签页 URL 变化 ──────────────

function isJobDetailUrl(url) {
  return url && /zhipin\.com\/job_detail\//.test(url);
}

// 已经在处理中的 tab，防止重复触发
const processingTabs = new Set();

async function onCompanionTabUpdated(tid, changeInfo, tab) {
  if (currentMode !== 'companion') return;
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !isJobDetailUrl(tab.url)) return;
  if (savedUrls.has(tab.url)) return;
  if (processingTabs.has(tid)) return;

  processingTabs.add(tid);
  console.log('[FindJobs][陪伴] 检测到岗位详情页:', tab.url);

  // 等待页面渲染
  await new Promise(r => setTimeout(r, 2000));

  try {
    const response = await sendToContent(tid, { action: 'extract_full_job' }, 10000);

    if (!response || !response.success || !response.data || !response.data.title) {
      console.warn('[FindJobs][陪伴] 提取失败或无标题');
      return;
    }

    // POST 到后端保存
    const resp = await apiFetch('/api/extension/companion-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response.data),
    });

    if (resp.ok) {
      const result = await resp.json();
      if (result.saved) {
        savedUrls.add(tab.url);
        console.log('[FindJobs][陪伴] ✅ 岗位已保存:', response.data.title, '(id=' + result.job_id + ')');
        // 通过 badge 提示用户
        chrome.action.setBadgeText({ text: '✓', tabId: tid });
        chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId: tid });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '', tabId: tid });
        }, 3000);
      } else if (result.reason === 'duplicate') {
        savedUrls.add(tab.url);
        console.log('[FindJobs][陪伴] 岗位已存在，跳过');
        chrome.action.setBadgeText({ text: '⊘', tabId: tid });
        chrome.action.setBadgeBackgroundColor({ color: '#eab308', tabId: tid });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '', tabId: tid });
        }, 2000);
      }
    }
  } catch (err) {
    console.error('[FindJobs][陪伴] 保存失败:', err);
  } finally {
    processingTabs.delete(tid);
  }
}

chrome.tabs.onUpdated.addListener(onCompanionTabUpdated);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM_NAME) return;
  if (!isPolling) return;
  pollCommand();
});

// ── 模式切换 ──────────────────────────────────

function setMode(mode) {
  currentMode = normalizeMode(mode);
  chrome.storage.local.set({ mode: currentMode });
  console.log('[FindJobs] 模式切换:', currentMode);
}

// ── 消息处理 (来自 popup) ────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_status') {
    sendResponse(getStatus());
    return true;
  }
  if (message.action === 'start_polling') {
    startPolling();
    sendResponse({ ok: true, ...getStatus() });
    return true;
  }
  if (message.action === 'stop_polling') {
    stopPolling();
    sendResponse({ ok: true, ...getStatus() });
    return true;
  }
  if (message.action === 'set_mode') {
    setMode(message.mode);
    sendResponse({ ok: true, ...getStatus() });
    return true;
  }
  if (message.action === 'show_page_assistant') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: '未找到当前标签页' });
        return;
      }

      try {
        await sendToContent(tab.id, { action: 'show_assistant' }, 5000);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || '页面助手显示失败' });
      }
    });
    return true;
  }
  if (message.action === 'reset_assistant_position') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: '未找到当前标签页' });
        return;
      }

      try {
        await sendToContent(tab.id, { action: 'reset_assistant_position' }, 5000);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || '悬浮球位置重置失败' });
      }
    });
    return true;
  }
});

// ── 初始化：恢复上次保存的模式 ─────────────────

chrome.storage.local.get(['mode', POLLING_STORAGE_KEY, PENDING_RESULTS_STORAGE_KEY], async (result) => {
  currentMode = normalizeMode(result.mode);
  pendingResultReports = Array.isArray(result[PENDING_RESULTS_STORAGE_KEY]) ? result[PENDING_RESULTS_STORAGE_KEY] : [];
  console.log('[FindJobs] 初始模式:', currentMode);
  updateConnectionIcon(); // 初始灰色

  if (result[POLLING_STORAGE_KEY] === false) {
    stopPolling();
    return;
  }

  startPolling();
  await flushPendingResults();
});

chrome.runtime.onStartup?.addListener(async () => {
  if (!isPolling) return;
  ensurePollingAlarm();
  await flushPendingResults();
  pollCommand();
});
