/**
 * FindJobs Chrome Extension — Background Service Worker
 *
 * 职责:
 * 1. 轮询后端获取采集命令 (navigate + extract)
 * 2. 通过 chrome.tabs API 导航
 * 3. 向 content script 发消息提取 DOM 数据
 * 4. 把结果 POST 回后端
 */

const API_BASE = 'http://localhost:27788';
const POLL_INTERVAL = 1500; // ms
let isPolling = false;
let connected = false;
let tabId = null; // 采集用的标签页

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

// ── 消息处理 (来自 popup) ────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get_status') {
    sendResponse({ connected, polling: isPolling, tabId });
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
});

// ── 自动启动轮询 ─────────────────────────────

startPolling();
