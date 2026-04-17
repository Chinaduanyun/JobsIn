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

const API_BASE = 'http://localhost:27788';
const POLL_INTERVAL = 1500; // ms
let isPolling = false;
let connected = false;
let tabId = null; // 采集用的标签页

// ── 模式管理 ──────────────────────────────────
// 'auto' = 自动模式（轮询后端命令）
// 'companion' = 陪伴模式（监听用户浏览，自动保存岗位）
let currentMode = 'auto';
const savedUrls = new Set(); // 陪伴模式已保存的 URL（避免重复保存）

// ── 轮询后端命令 ──────────────────────────────

async function pollCommand() {
  if (!isPolling) return;

  try {
    const resp = await fetch(`${API_BASE}/api/extension/command`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      connected = false;
      scheduleNextPoll();
      return;
    }

    connected = true;
    const data = await resp.json();

    if (data && data.id) {
      console.log('[FindJobs] 收到命令:', data.type, data.id);
      await executeCommand(data);
    }
  } catch (err) {
    connected = false;
    console.debug('[FindJobs] 轮询失败:', err.message);
  }

  scheduleNextPoll();
}

function scheduleNextPoll() {
  if (isPolling) {
    setTimeout(pollCommand, POLL_INTERVAL);
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
      case 'ping':
        result = { success: true, data: { pong: true, timestamp: Date.now() } };
        break;
      default:
        result = { success: false, error: `未知命令: ${type}` };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  // 报告结果
  try {
    await fetch(`${API_BASE}/api/extension/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_id: id, ...result }),
    });
  } catch (err) {
    console.error('[FindJobs] 报告结果失败:', err);
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

  // 检查是否被安全拦截
  const tab = await chrome.tabs.get(tid);
  const currentUrl = tab.url || '';
  if (currentUrl.includes('verify.html') || currentUrl.includes('security.html')) {
    // 把标签页激活让用户看到
    await chrome.tabs.update(tid, { active: true });
    return { success: false, error: 'security_check', security_check: true };
  }
  if (currentUrl.includes('about:blank') && url !== 'about:blank') {
    return { success: false, error: '页面被重定向到空白页，可能被检测' };
  }

  // 额外等待 DOM 渲染
  await new Promise(r => setTimeout(r, 2000));

  try {
    const response = await sendToContent(tid, { action: 'extract_jobs' });
    return { success: true, data: response };
  } catch (err) {
    return { success: false, error: `提取失败: ${err.message}` };
  }
}

// ── 采集岗位详情 ─────────────────────────────

async function handleExtractDetail(cmd) {
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

  await new Promise(r => setTimeout(r, 1500));

  try {
    const response = await sendToContent(tid, { action: 'extract_detail' });
    return { success: true, data: response };
  } catch (err) {
    return { success: false, error: `提取失败: ${err.message}` };
  }
}

// ── 启动/停止轮询 ────────────────────────────

function startPolling() {
  if (isPolling) return;
  isPolling = true;
  console.log('[FindJobs] 开始轮询后端命令');
  pollCommand();
}

function stopPolling() {
  isPolling = false;
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
    const resp = await fetch(`${API_BASE}/api/extension/companion-save`, {
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

// ── 模式切换 ──────────────────────────────────

function setMode(mode) {
  currentMode = mode;
  chrome.storage.local.set({ mode });
  console.log('[FindJobs] 模式切换:', mode);

  if (mode === 'auto') {
    startPolling();
  } else {
    stopPolling();
  }
}

// ── 消息处理 (来自 popup) ────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_status') {
    sendResponse({ connected, polling: isPolling, tabId, mode: currentMode });
    return true;
  }
  if (message.action === 'start_polling') {
    startPolling();
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'stop_polling') {
    stopPolling();
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'set_mode') {
    setMode(message.mode);
    sendResponse({ ok: true, mode: currentMode });
    return true;
  }
});

// ── 初始化：恢复上次保存的模式 ─────────────────

chrome.storage.local.get(['mode'], (result) => {
  currentMode = result.mode || 'auto';
  console.log('[FindJobs] 初始模式:', currentMode);
  if (currentMode === 'auto') {
    startPolling();
  }
});
