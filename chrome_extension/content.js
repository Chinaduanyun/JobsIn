/**
 * FindJobs Chrome Extension — Content Script
 *
 * 运行在 zhipin.com 页面中，负责从 DOM 提取岗位数据。
 * 由 background.js 通过 chrome.tabs.sendMessage 调用。
 */

const API_BASES = ['http://localhost:27788', 'http://127.0.0.1:27788'];
const ASSISTANT_ROOT_ID = 'findjobs-floating-assistant';
const ASSISTANT_STYLE_ID = 'findjobs-floating-assistant-style';
const JOB_DETAIL_URL_RE = /zhipin\.com\/job_detail\//;
const ASSISTANT_STORAGE_KEY = 'floatingAssistantUI';
const DEFAULT_BALL_POSITION = { x: 24, y: 120 };

let activeApiBase = API_BASES[0];

function getApiBaseCandidates() {
  return [activeApiBase, ...API_BASES.filter(base => base !== activeApiBase)];
}

async function apiFetch(path, options = {}) {
  let lastError = null;

  for (const base of getApiBaseCandidates()) {
    try {
      const response = await fetch(`${base}${path}`, options);
      activeApiBase = base;
      return response;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`请求失败: ${path}`);
}

const assistantState = {
  uiState: 'ball', // ball | menu | mode | hidden
  activeView: 'greeting', // auto | companion | greeting
  loading: false,
  error: '',
  greeting: '',
  copied: false,
  jobId: null,
  greetingMeta: null,
  drag: {
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: DEFAULT_BALL_POSITION.x,
    originY: DEFAULT_BALL_POSITION.y,
  },
  position: { ...DEFAULT_BALL_POSITION },
  modeStatus: {
    connected: false,
    polling: false,
    mode: 'auto',
  },
};

let assistantElements = null;
let assistantUrl = '';
let assistantObserverStarted = false;
let persistAssistantStateTimer = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract_jobs') {
    extractJobs().then(sendResponse);
    return true;
  }

  if (message.action === 'extract_detail') {
    const result = extractDetail();
    sendResponse(result);
    return true;
  }

  if (message.action === 'extract_full_job') {
    const result = extractFullJob();
    sendResponse(result);
    return true;
  }

  if (message.action === 'apply_job') {
    applyJob(message.greeting_text || '').then(sendResponse);
    return true;
  }

  if (message.action === 'send_chat_greeting') {
    sendGreetingOnChatPage(message.greeting_text || '').then(sendResponse);
    return true;
  }

  if (message.action === 'show_assistant') {
    showAssistant();
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'reset_assistant_position') {
    resetAssistantPosition();
    sendResponse({ ok: true });
    return true;
  }
});

initAssistantLifecycle();

function initAssistantLifecycle() {
  restoreAssistantState().finally(() => {
    syncAssistant();
    refreshExtensionStatus();
  });

  if (assistantObserverStarted) {
    return;
  }
  assistantObserverStarted = true;

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncAssistant();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', syncAssistant);
  window.addEventListener('hashchange', syncAssistant);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.mode?.newValue) {
      assistantState.modeStatus.mode = changes.mode.newValue;
      refreshExtensionStatus();
      renderAssistant();
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'pollingEnabled')) {
      refreshExtensionStatus();
    }

    if (changes[ASSISTANT_STORAGE_KEY]?.newValue) {
      const value = changes[ASSISTANT_STORAGE_KEY].newValue;
      if (!assistantState.drag.active && value?.position) {
        assistantState.position = normalizePosition(value.position);
      }
      if (value?.hidden === true) {
        assistantState.uiState = 'hidden';
      }
      renderAssistant();
    }
  });
}

async function restoreAssistantState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([ASSISTANT_STORAGE_KEY], (result) => {
      const saved = result[ASSISTANT_STORAGE_KEY];
      if (saved?.position) {
        assistantState.position = normalizePosition(saved.position);
      }
      if (saved?.hidden === true) {
        assistantState.uiState = 'hidden';
      }
      resolve();
    });
  });
}

function persistAssistantState() {
  clearTimeout(persistAssistantStateTimer);
  persistAssistantStateTimer = setTimeout(() => {
    chrome.storage.local.set({
      [ASSISTANT_STORAGE_KEY]: {
        position: assistantState.position,
        hidden: assistantState.uiState === 'hidden',
      },
    });
  }, 80);
}

function normalizePosition(position = {}) {
  const maxX = Math.max(12, window.innerWidth - 72);
  const maxY = Math.max(12, window.innerHeight - 72);
  return {
    x: clamp(Number(position.x) || DEFAULT_BALL_POSITION.x, 12, maxX),
    y: clamp(Number(position.y) || DEFAULT_BALL_POSITION.y, 12, maxY),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function syncAssistant() {
  if (assistantUrl !== window.location.href) {
    assistantUrl = window.location.href;
    resetGreetingViewState();
  }

  ensureAssistant();
  refreshExtensionStatus();
  renderAssistant();
}

function showAssistant() {
  assistantState.uiState = 'ball';
  assistantState.error = '';
  persistAssistantState();
  syncAssistant();
}

function hideAssistant() {
  assistantState.uiState = 'hidden';
  persistAssistantState();
  renderAssistant();
}

function collapseToBall() {
  assistantState.uiState = 'ball';
  assistantState.error = '';
  renderAssistant();
  persistAssistantState();
}

function openMenu() {
  assistantState.uiState = 'menu';
  assistantState.error = '';
  renderAssistant();
}

function openModeView(view) {
  assistantState.uiState = 'mode';
  assistantState.activeView = view;
  assistantState.error = '';
  switchMode(view);
  renderAssistant();
}

function backToMenu() {
  assistantState.uiState = 'menu';
  assistantState.error = '';
  renderAssistant();
}

function resetGreetingViewState() {
  assistantState.loading = false;
  assistantState.error = '';
  assistantState.greeting = '';
  assistantState.copied = false;
  assistantState.jobId = null;
  assistantState.greetingMeta = null;
}

async function refreshExtensionStatus() {
  try {
    const status = await sendRuntimeMessage({ action: 'get_status' });
    if (status) {
      assistantState.modeStatus = status;
      renderAssistant();
    }
  } catch {
    assistantState.modeStatus.connected = false;
    renderAssistant();
  }
}

async function switchMode(mode) {
  try {
    const status = await sendRuntimeMessage({ action: 'set_mode', mode });
    if (status) {
      assistantState.modeStatus = status;
      renderAssistant();
    }
  } catch (err) {
    assistantState.error = err.message || '模式切换失败';
    renderAssistant();
  }
}

async function toggleAutoPolling() {
  try {
    assistantState.error = '';
    renderAssistant();
    const action = assistantState.modeStatus.polling ? 'stop_polling' : 'start_polling';
    const status = await sendRuntimeMessage({ action });
    if (status) {
      assistantState.modeStatus = status;
    }
    renderAssistant();
  } catch (err) {
    assistantState.error = err.message || '轮询切换失败';
    renderAssistant();
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function isJobDetailPage(url = window.location.href) {
  return JOB_DETAIL_URL_RE.test(url) && !url.includes('/web/geek/chat');
}

function ensureAssistantStyle() {
  if (document.getElementById(ASSISTANT_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = ASSISTANT_STYLE_ID;
  style.textContent = `
    #${ASSISTANT_ROOT_ID} {
      position: fixed;
      left: 0;
      top: 0;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #0f172a;
    }
    #${ASSISTANT_ROOT_ID}[data-hidden="true"] {
      display: none;
    }
    #${ASSISTANT_ROOT_ID} .fj-shell {
      position: fixed;
      left: 0;
      top: 0;
      pointer-events: none;
    }
    #${ASSISTANT_ROOT_ID} .fj-ball,
    #${ASSISTANT_ROOT_ID} .fj-panel {
      pointer-events: auto;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
    }
    #${ASSISTANT_ROOT_ID} .fj-ball {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      cursor: grab;
      user-select: none;
      border: 2px solid rgba(255,255,255,0.35);
    }
    #${ASSISTANT_ROOT_ID} .fj-ball:active {
      cursor: grabbing;
    }
    #${ASSISTANT_ROOT_ID} .fj-panel {
      width: 360px;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
      background: #fff;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 18px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    #${ASSISTANT_ROOT_ID} .fj-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      gap: 10px;
    }
    #${ASSISTANT_ROOT_ID} .fj-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    #${ASSISTANT_ROOT_ID} .fj-title {
      font-size: 14px;
      font-weight: 700;
      margin: 0;
    }
    #${ASSISTANT_ROOT_ID} .fj-subtitle {
      font-size: 12px;
      color: #64748b;
      margin-top: 2px;
    }
    #${ASSISTANT_ROOT_ID} .fj-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    #${ASSISTANT_ROOT_ID} .fj-icon-btn {
      border: none;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      cursor: pointer;
      background: #e2e8f0;
      color: #0f172a;
      font-size: 14px;
      font-weight: 700;
    }
    #${ASSISTANT_ROOT_ID} .fj-body {
      padding: 14px;
      overflow: auto;
    }
    #${ASSISTANT_ROOT_ID} .fj-menu-list {
      display: grid;
      gap: 10px;
    }
    #${ASSISTANT_ROOT_ID} .fj-menu-item {
      border: 1px solid #dbeafe;
      background: #eff6ff;
      border-radius: 14px;
      padding: 12px;
      text-align: left;
      cursor: pointer;
    }
    #${ASSISTANT_ROOT_ID} .fj-menu-item strong {
      display: block;
      font-size: 14px;
      color: #1e3a8a;
      margin-bottom: 4px;
    }
    #${ASSISTANT_ROOT_ID} .fj-menu-item span {
      font-size: 12px;
      color: #475569;
      line-height: 1.5;
    }
    #${ASSISTANT_ROOT_ID} .fj-status {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 10px;
      line-height: 1.6;
    }
    #${ASSISTANT_ROOT_ID} .fj-section {
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 12px;
      background: #fff;
      margin-bottom: 10px;
    }
    #${ASSISTANT_ROOT_ID} .fj-section-title {
      font-size: 13px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    #${ASSISTANT_ROOT_ID} .fj-error {
      background: #fff1f2;
      color: #be123c;
      border: 1px solid #fecdd3;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      margin-bottom: 10px;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    #${ASSISTANT_ROOT_ID} .fj-textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.55;
      box-sizing: border-box;
      outline: none;
      margin-top: 8px;
    }
    #${ASSISTANT_ROOT_ID} .fj-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    #${ASSISTANT_ROOT_ID} .fj-button {
      appearance: none;
      border: none;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s ease, transform .15s ease, background .15s ease;
    }
    #${ASSISTANT_ROOT_ID} .fj-button:hover {
      transform: translateY(-1px);
    }
    #${ASSISTANT_ROOT_ID} .fj-button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
      transform: none;
    }
    #${ASSISTANT_ROOT_ID} .fj-button-primary {
      background: #2563eb;
      color: #fff;
      flex: 1;
    }
    #${ASSISTANT_ROOT_ID} .fj-button-secondary {
      background: #eff6ff;
      color: #1d4ed8;
    }
    #${ASSISTANT_ROOT_ID} .fj-hint {
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
    }
    #${ASSISTANT_ROOT_ID} .fj-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 700;
    }
    #${ASSISTANT_ROOT_ID} .fj-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
  `;
  document.documentElement.appendChild(style);
}

function ensureAssistant() {
  ensureAssistantStyle();

  const existing = document.getElementById(ASSISTANT_ROOT_ID);
  if (existing) {
    assistantElements = {
      root: existing,
      shell: existing.querySelector('.fj-shell'),
    };
    return;
  }

  const root = document.createElement('div');
  root.id = ASSISTANT_ROOT_ID;
  root.innerHTML = '<div class="fj-shell"></div>';
  document.documentElement.appendChild(root);

  assistantElements = {
    root,
    shell: root.querySelector('.fj-shell'),
  };
}

function renderAssistant() {
  if (!assistantElements?.root || !assistantElements?.shell) {
    return;
  }

  assistantState.position = normalizePosition(assistantState.position);
  assistantElements.root.dataset.hidden = assistantState.uiState === 'hidden' ? 'true' : 'false';

  if (assistantState.uiState === 'hidden') {
    assistantElements.shell.innerHTML = '';
    return;
  }

  if (assistantState.uiState === 'ball') {
    assistantElements.shell.style.transform = `translate(${assistantState.position.x}px, ${assistantState.position.y}px)`;
    assistantElements.shell.innerHTML = '<div class="fj-ball" title="打开 JobsIn 助手">✦</div>';
    bindBallEvents();
    return;
  }

  assistantElements.shell.innerHTML = renderPanelHtml();
  positionPanelWithinViewport();
  bindPanelEvents();
}

function bindBallEvents() {
  const ball = assistantElements.shell.querySelector('.fj-ball');
  if (!ball) return;

  ball.addEventListener('pointerdown', startBallDrag);
  ball.addEventListener('click', (event) => {
    if (assistantState.drag.moved) {
      event.preventDefault();
      event.stopPropagation();
      assistantState.drag.moved = false;
      return;
    }
    openMenu();
  });
}

function positionPanelWithinViewport() {
  const panel = assistantElements.shell.querySelector('.fj-panel');
  if (!panel) {
    assistantElements.shell.style.transform = `translate(${assistantState.position.x}px, ${assistantState.position.y}px)`;
    return;
  }

  const margin = 12;
  const panelWidth = Math.min(panel.offsetWidth || 360, window.innerWidth - margin * 2);
  const panelHeight = Math.min(panel.offsetHeight || 240, window.innerHeight - margin * 2);
  const maxX = Math.max(margin, window.innerWidth - panelWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - panelHeight - margin);
  const panelX = clamp(assistantState.position.x, margin, maxX);
  const panelY = clamp(assistantState.position.y, margin, maxY);

  assistantElements.shell.style.transform = `translate(${panelX}px, ${panelY}px)`;
}

function startBallDrag(event) {
  assistantState.drag.active = true;
  assistantState.drag.moved = false;
  assistantState.drag.startX = event.clientX;
  assistantState.drag.startY = event.clientY;
  assistantState.drag.originX = assistantState.position.x;
  assistantState.drag.originY = assistantState.position.y;

  const onMove = (moveEvent) => {
    if (!assistantState.drag.active) return;

    const deltaX = moveEvent.clientX - assistantState.drag.startX;
    const deltaY = moveEvent.clientY - assistantState.drag.startY;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      assistantState.drag.moved = true;
    }

    assistantState.position = normalizePosition({
      x: assistantState.drag.originX + deltaX,
      y: assistantState.drag.originY + deltaY,
    });
    renderAssistant();
  };

  const onUp = () => {
    assistantState.drag.active = false;
    persistAssistantState();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function bindPanelEvents() {
  const backBtn = assistantElements.shell.querySelector('[data-action="back-menu"]');
  const collapseBtn = assistantElements.shell.querySelector('[data-action="collapse-ball"]');
  const closeBtn = assistantElements.shell.querySelector('[data-action="close-assistant"]');
  const menuButtons = assistantElements.shell.querySelectorAll('[data-action="open-view"]');
  const togglePollingBtn = assistantElements.shell.querySelector('[data-action="toggle-polling"]');
  const generateBtn = assistantElements.shell.querySelector('[data-action="generate-greeting"]');
  const copyBtn = assistantElements.shell.querySelector('[data-action="copy-greeting"]');
  const textarea = assistantElements.shell.querySelector('.fj-textarea');

  backBtn?.addEventListener('click', backToMenu);
  collapseBtn?.addEventListener('click', collapseToBall);
  closeBtn?.addEventListener('click', hideAssistant);

  menuButtons.forEach((button) => {
    button.addEventListener('click', () => {
      openModeView(button.dataset.view);
    });
  });

  togglePollingBtn?.addEventListener('click', toggleAutoPolling);
  generateBtn?.addEventListener('click', generateGreetingFromPage);
  copyBtn?.addEventListener('click', copyGreetingText);

  textarea?.addEventListener('input', (event) => {
    assistantState.greeting = event.target.value;
    assistantState.copied = false;
  });
}

function renderPanelHtml() {
  const title = assistantState.uiState === 'menu'
    ? 'JobsIn 助手'
    : assistantState.activeView === 'auto'
      ? '自动模式'
      : assistantState.activeView === 'companion'
        ? '陪伴模式'
        : '沟通助手';

  const subtitle = assistantState.uiState === 'menu'
    ? '选择一个模式继续'
    : assistantState.activeView === 'auto'
      ? '后端任务自动执行'
      : assistantState.activeView === 'companion'
        ? '浏览详情页时自动保存'
        : '根据当前岗位详情生成沟通文案';

  const leftAction = assistantState.uiState === 'menu'
    ? '<button class="fj-icon-btn" data-action="collapse-ball" title="折叠回小球">—</button>'
    : '<button class="fj-icon-btn" data-action="back-menu" title="返回菜单">←</button>';

  return `
    <div class="fj-panel">
      <div class="fj-header">
        <div class="fj-title-wrap">
          ${leftAction}
          <div>
            <p class="fj-title">${escapeHtml(title)}</p>
            <p class="fj-subtitle">${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <div class="fj-header-actions">
          <button class="fj-icon-btn" data-action="collapse-ball" title="折叠回小球">○</button>
          <button class="fj-icon-btn" data-action="close-assistant" title="关闭">×</button>
        </div>
      </div>
      <div class="fj-body">
        ${assistantState.error ? `<div class="fj-error">${escapeHtml(assistantState.error)}</div>` : ''}
        ${assistantState.uiState === 'menu' ? renderMenuView() : renderModeView()}
      </div>
    </div>
  `;
}

function renderMenuView() {
  return `
    <div class="fj-menu-list">
      <button class="fj-menu-item" data-action="open-view" data-view="auto">
        <strong>自动模式</strong>
        <span>后端下发采集或投递命令后，插件自动执行。当前模式：${escapeHtml(getModeLabel(assistantState.modeStatus.mode))}</span>
      </button>
      <button class="fj-menu-item" data-action="open-view" data-view="companion">
        <strong>陪伴模式</strong>
        <span>你浏览 Boss 岗位详情页时，插件会自动提取并保存岗位信息。</span>
      </button>
      <button class="fj-menu-item" data-action="open-view" data-view="greeting">
        <strong>沟通助手</strong>
        <span>根据当前页面岗位信息和已激活简历，一键生成、编辑并复制沟通文案。</span>
      </button>
    </div>
  `;
}

function renderModeView() {
  if (assistantState.activeView === 'auto') {
    return renderAutoView();
  }
  if (assistantState.activeView === 'companion') {
    return renderCompanionView();
  }
  return renderGreetingView();
}

function renderAutoView() {
  const { connected, polling } = assistantState.modeStatus;
  return `
    <div class="fj-section">
      <p class="fj-section-title">运行状态</p>
      <div class="fj-row"><span class="fj-hint">后端连接</span><span class="fj-pill">${connected ? '已连接' : '未连接'}</span></div>
      <div class="fj-row"><span class="fj-hint">连接地址</span><span class="fj-pill">${escapeHtml(assistantState.modeStatus.activeApiBase || '未知')}</span></div>
      <div class="fj-row"><span class="fj-hint">命令通道</span><span class="fj-pill">${polling ? '运行中' : '已停止'}</span></div>
      <p class="fj-hint">自动模式用于承载后端下发的采集/投递任务；命令通道可独立开启或停止。</p>
      <div class="fj-actions">
        <button class="fj-button fj-button-primary" data-action="toggle-polling">${polling ? '停止命令通道' : '开启命令通道'}</button>
      </div>
    </div>
  `;
}

function renderCompanionView() {
  return `
    <div class="fj-section">
      <p class="fj-section-title">当前状态</p>
      <div class="fj-row"><span class="fj-hint">真实模式</span><span class="fj-pill">${escapeHtml(getModeLabel(assistantState.modeStatus.mode))}</span></div>
      <p class="fj-hint">陪伴模式开启后，你打开 Boss 岗位详情页时，插件会自动提取完整岗位并调用 <code>/api/extension/companion-save</code> 保存。</p>
      <p class="fj-hint" style="margin-top:8px;">如果同一岗位已经保存过，会自动跳过，不会重复写入。</p>
    </div>
  `;
}

function renderGreetingView() {
  const supportedPage = isJobDetailPage();
  const statusText = assistantState.loading
    ? '正在读取当前岗位并生成文案…'
    : assistantState.greeting
      ? '已生成，可直接编辑并复制使用'
      : supportedPage
        ? '基于当前岗位详情和已激活简历生成'
        : '当前页不是岗位详情页，暂不能生成';

  const metaHtml = assistantState.greetingMeta
    ? `
      <div class="fj-section" style="margin-top:10px;">
        <p class="fj-section-title">本次生成</p>
        <div class="fj-row"><span class="fj-hint">岗位记录</span><span class="fj-pill">${assistantState.jobId ? `#${assistantState.jobId}` : '未返回'}</span></div>
        <div class="fj-row"><span class="fj-hint">岗位入库</span><span class="fj-pill">${assistantState.greetingMeta.jobCreated ? '新建' : '复用'}</span></div>
        <div class="fj-row"><span class="fj-hint">分析状态</span><span class="fj-pill">${assistantState.greetingMeta.analysisCreated ? '新分析' : '复用分析'}</span></div>
      </div>
    `
    : '';

  return `
    <div class="fj-section">
      <p class="fj-section-title">生成文案</p>
      <p class="fj-status">${escapeHtml(statusText)}</p>
      <div class="fj-row"><span class="fj-hint">页面状态</span><span class="fj-pill">${supportedPage ? '可生成' : '不支持'}</span></div>
      ${assistantState.greeting ? `<textarea class="fj-textarea" placeholder="生成结果会显示在这里">${escapeHtml(assistantState.greeting)}</textarea>` : ''}
      <div class="fj-actions">
        <button class="fj-button fj-button-primary" data-action="generate-greeting" ${assistantState.loading || !supportedPage ? 'disabled' : ''}>${assistantState.loading ? '生成中…' : assistantState.greeting ? '重新生成文案' : '生成沟通文案'}</button>
        ${assistantState.greeting ? `<button class="fj-button fj-button-secondary" data-action="copy-greeting" ${assistantState.loading ? 'disabled' : ''}>${assistantState.copied ? '已复制' : '复制文案'}</button>` : ''}
      </div>
      <p class="fj-hint" style="margin-top:8px;">该助手只负责真实岗位提取、后端生成文案、页面内编辑和复制，不会自动把消息发出去。</p>
    </div>
    ${metaHtml}
  `;
}

function getModeLabel(mode) {
  return mode === 'auto' ? '自动模式' : mode === 'companion' ? '陪伴模式' : '沟通助手';
}

function resetAssistantPosition() {
  assistantState.position = normalizePosition(DEFAULT_BALL_POSITION);
  assistantState.uiState = 'ball';
  persistAssistantState();
  renderAssistant();
}

async function generateGreetingFromPage() {
  if (assistantState.loading) {
    return;
  }
  if (!isJobDetailPage()) {
    assistantState.error = '当前页面不是 Boss 岗位详情页，请进入 job_detail 页面后再生成。';
    renderAssistant();
    return;
  }

  assistantState.loading = true;
  assistantState.error = '';
  assistantState.copied = false;
  renderAssistant();

  try {
    const extracted = extractFullJob();
    if (!extracted?.success || !extracted.data) {
      throw new Error(extracted?.error || '岗位信息提取失败');
    }

    const payload = extracted.data;
    if (!payload.title) throw new Error('未提取到岗位标题');
    if (!payload.url) throw new Error('未提取到岗位链接');
    if (!payload.description) throw new Error('未提取到岗位描述，请等待页面完全加载后重试');

    const response = await apiFetch('/api/extension/generate-greeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || '生成沟通文案失败');
    }

    assistantState.greeting = result.greeting_text || '';
    assistantState.jobId = result.job_id || null;
    assistantState.greetingMeta = {
      jobCreated: Boolean(result.job_created),
      analysisCreated: Boolean(result.analysis_created),
    };
    assistantState.error = '';
    assistantState.copied = false;
  } catch (error) {
    assistantState.jobId = null;
    assistantState.greetingMeta = null;
    assistantState.error = error.message || '生成沟通文案失败';
  } finally {
    assistantState.loading = false;
    renderAssistant();
  }
}

async function copyGreetingText() {
  const text = assistantState.greeting.trim();
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    assistantState.copied = true;
    renderAssistant();
  } catch {
    assistantState.error = '复制失败，请手动选中文案复制';
    renderAssistant();
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function extractCompanyName() {
  const selector = [
    '.company-info a',
    '.company-info .company-name',
    '.company-info .name',
    '.sider-company .company-name',
    '.sider-company [href*="gongsi/"]',
    '.job-company a',
    '.job-company .name',
    '.company-name',
    'a[href*="/gongsi/"]',
  ].join(', ');

  const candidates = Array.from(document.querySelectorAll(selector));
  for (const el of candidates) {
    const text = (el.textContent || '').trim();
    if (!text) continue;
    if (text.length <= 1) continue;
    if (/公司规模|公司行业|工商信息|全部\d+条点评|招聘中/.test(text)) continue;
    return text;
  }

  const metaCandidates = [
    document.querySelector('.company-info')?.textContent || '',
    document.querySelector('.sider-company')?.textContent || '',
    document.querySelector('.job-company')?.textContent || '',
  ];

  for (const raw of metaCandidates) {
    const lines = raw
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.length <= 1) continue;
      if (/公司规模|公司行业|工商信息|全部\d+条点评|招聘中/.test(line)) continue;
      return line;
    }
  }

  return '';
}

// ── 字体解密工具 ─────────────────────────────

/**
 * Boss直聘使用自定义字体加密薪资数字。
 * 页面中的数字实际是 Unicode 私用区字符 (U+E000-U+F8FF)，
 * 通过 @font-face 渲染为数字外观。
 *
 * 解密方法：用 Canvas 渲染私用区字符和标准数字，对比像素匹配。
 */
function decodeFontEncryptedText(element) {
  const text = element.textContent || '';

  if (!/[\uE000-\uF8FF]/.test(text)) {
    return text.trim();
  }

  try {
    const style = getComputedStyle(element);
    const fontSize = '40px';
    const fontFamily = style.fontFamily;

    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');

    function getCharSignature(char, font) {
      ctx.clearRect(0, 0, 60, 60);
      ctx.font = `${fontSize} ${font}`;
      ctx.fillStyle = 'black';
      ctx.textBaseline = 'middle';
      ctx.fillText(char, 5, 30);
      const data = ctx.getImageData(0, 0, 60, 60).data;
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 60; x++) {
          const alpha = data[(y * 60 + x) * 4 + 3];
          if (alpha > 128) {
            count++;
            sumX += x;
            sumY += y;
          }
        }
      }
      return { count, avgX: count ? sumX / count : 0, avgY: count ? sumY / count : 0 };
    }

    const digitSigs = {};
    for (let d = 0; d <= 9; d++) {
      digitSigs[d] = getCharSignature(String(d), fontFamily);
    }

    let decoded = '';
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code >= 0xE000 && code <= 0xF8FF) {
        const sig = getCharSignature(char, fontFamily);
        if (sig.count === 0) {
          decoded += '?';
          continue;
        }
        let bestDigit = '?';
        let bestDiff = Infinity;
        for (let d = 0; d <= 9; d++) {
          const ds = digitSigs[d];
          if (ds.count === 0) continue;
          const countDiff = Math.abs(sig.count - ds.count) / Math.max(sig.count, ds.count);
          const xDiff = Math.abs(sig.avgX - ds.avgX) / 60;
          const yDiff = Math.abs(sig.avgY - ds.avgY) / 60;
          const diff = countDiff * 0.6 + xDiff * 0.2 + yDiff * 0.2;
          if (diff < bestDiff) {
            bestDiff = diff;
            bestDigit = String(d);
          }
        }
        decoded += bestDiff < 0.3 ? bestDigit : '?';
      } else {
        decoded += char;
      }
    }

    return decoded.trim();
  } catch (e) {
    console.warn('[FindJobs] 字体解密失败:', e);
    return text.trim();
  }
}

// ── 提取岗位列表 ─────────────────────────────

function getJobCards() {
  return Array.from(document.querySelectorAll('.job-card-wrapper, .job-card-box'));
}

function getSearchListScroller() {
  const candidates = [
    document.querySelector('.job-list-container'),
    document.querySelector('.search-job-result'),
    document.querySelector('.job-list-box'),
    document.querySelector('.job-list'),
    document.querySelector('.search-job-list'),
    document.querySelector('.left-side'),
    document.querySelector('.left-list'),
  ].filter(Boolean);

  for (const el of candidates) {
    if (el.scrollHeight - el.clientHeight > 120) {
      return el;
    }
  }

  const cards = getJobCards();
  if (!cards.length) return null;

  let node = cards[0].parentElement;
  while (node && node !== document.body) {
    if (node.scrollHeight - node.clientHeight > 120) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

function readJobsSnapshot() {
  const cards = getJobCards();

  if (!cards.length) {
    const empty = document.querySelector('.job-empty-wrapper, .empty-tips');
    if (empty) {
      return { jobs: [], empty: true, message: '无搜索结果', total_cards: 0 };
    }
    return { jobs: [], empty: false, message: '未找到岗位卡片元素', total_cards: 0 };
  }

  const jobs = cards.map(card => {
    const titleLinkEl = card.querySelector('.job-name a, a.job-name, .job-title a');
    const titleSpanEl = card.querySelector('.job-name span:first-child, .job-name-text');
    const titleEl = titleLinkEl || titleSpanEl || card.querySelector('.job-name, .job-title');
    const areaEl = card.querySelector('.job-area, .job-area-wrapper');

    const salaryEl = card.querySelector('.salary');
    let salary = '';
    if (salaryEl) {
      salary = decodeFontEncryptedText(salaryEl);
    }

    const companyEl = card.querySelector('.company-name a, .company-name');
    const tagEls = card.querySelectorAll('.tag-list li');
    const expEl = tagEls.length > 0 ? tagEls[0] : null;
    const eduEl = tagEls.length > 1 ? tagEls[1] : null;
    const skills = [];
    tagEls.forEach((el, i) => {
      if (i >= 2) skills.push(el.textContent.trim());
    });

    const hrNameEl = card.querySelector('.info-public em, .boss-name');
    const hrTitleEl = card.querySelector('.info-public .name, .boss-title');
    const hrOnlineEl = card.querySelector('.boss-online-tag, .boss-active-time');
    const companySizeEl = card.querySelector('.company-tag-list li:last-child');
    const companyIndustryEl = card.querySelector('.company-tag-list li:first-child');

    const linkEl = card.querySelector('a[href*="job_detail"], a[ka="search_list_jname"]');
    let url = '';
    if (linkEl) {
      url = linkEl.href;
      if (url.startsWith('/')) {
        url = 'https://www.zhipin.com' + url;
      }
    }

    let title = '';
    if (titleEl) {
      const clone = titleEl.cloneNode(true);
      const salaryChild = clone.querySelector('.salary');
      if (salaryChild) salaryChild.remove();
      title = clone.textContent.trim();
    }

    return {
      title,
      city: areaEl ? areaEl.textContent.trim() : '',
      salary,
      company: companyEl ? companyEl.textContent.trim() : '',
      experience: expEl ? expEl.textContent.trim() : '',
      education: eduEl ? eduEl.textContent.trim() : '',
      hr_name: hrNameEl ? hrNameEl.textContent.trim() : '',
      hr_title: hrTitleEl ? hrTitleEl.textContent.trim() : '',
      hr_active: hrOnlineEl ? hrOnlineEl.textContent.trim() : '',
      company_size: companySizeEl ? companySizeEl.textContent.trim() : '',
      company_industry: companyIndustryEl ? companyIndustryEl.textContent.trim() : '',
      url,
      tags: skills.join(','),
    };
  }).filter(j => j.title);

  return {
    jobs,
    empty: false,
    page_url: window.location.href,
    total_cards: cards.length,
  };
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const deduped = [];
  let duplicateCount = 0;

  for (const job of jobs) {
    const key = job.url || `${job.title}__${job.company}__${job.city}`;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    deduped.push(job);
  }

  return { deduped, duplicateCount };
}

async function extractJobs() {
  const initialSnapshot = readJobsSnapshot();
  if (!initialSnapshot.jobs?.length) {
    return initialSnapshot;
  }

  const scroller = getSearchListScroller();
  let scrolled = false;
  let stableRounds = 0;
  let lastCount = initialSnapshot.jobs.length;
  let lastHeight = scroller ? scroller.scrollHeight : 0;

  if (scroller) {
    for (let i = 0; i < 8; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      scrolled = true;
      await sleep(700);

      const snapshot = readJobsSnapshot();
      const currentCount = snapshot.jobs.length;
      const currentHeight = scroller.scrollHeight;

      if (currentCount > lastCount || currentHeight > lastHeight) {
        stableRounds = 0;
        lastCount = currentCount;
        lastHeight = currentHeight;
        continue;
      }

      stableRounds += 1;
      if (stableRounds >= 2) {
        break;
      }
    }
  }

  const finalSnapshot = readJobsSnapshot();
  const { deduped, duplicateCount } = dedupeJobs(finalSnapshot.jobs || []);

  return {
    jobs: deduped,
    empty: false,
    page_url: window.location.href,
    total_cards: finalSnapshot.total_cards || 0,
    initial_count: initialSnapshot.jobs.length,
    final_count: finalSnapshot.jobs.length,
    duplicate_count: duplicateCount,
    scrolled,
  };
}

// ── 提取岗位详情 ─────────────────────────────

function extractDetail() {
  const descEl = document.querySelector('.job-sec-text, .job-detail-section');
  const tagEls = document.querySelectorAll('.job-tags .tag-item, .job-keyword-list li');
  const sizeEl = document.querySelector('.sider-company p:last-child, .company-info-size');
  const industryEl = document.querySelector('.sider-company p:first-child, .company-info-industry');

  const salaryEl = document.querySelector('.salary');
  let salary = '';
  if (salaryEl) {
    salary = decodeFontEncryptedText(salaryEl);
  }

  return {
    description: descEl ? descEl.innerText.trim() : '',
    tags: Array.from(tagEls).map(el => el.textContent.trim()).join(','),
    company_size: sizeEl ? sizeEl.textContent.trim() : '',
    company_industry: industryEl ? industryEl.textContent.trim() : '',
    salary,
    page_url: window.location.href,
  };
}

// ── 陪伴模式：从详情页提取完整岗位数据 ──────────

function extractFullJob() {
  try {
    const titleEl = document.querySelector('.name h1, .job-banner .name h1, .info-primary .name h1');
    const title = titleEl ? titleEl.textContent.trim() : '';

    const salaryEl = document.querySelector('.salary, .info-primary .salary');
    let salary = '';
    if (salaryEl) {
      salary = decodeFontEncryptedText(salaryEl);
    }

    const detailItems = document.querySelectorAll('.job-primary-detail p, .detail-content .job-detail span');
    let city = '', experience = '', education = '';
    detailItems.forEach((el, i) => {
      const text = el.textContent.trim();
      if (i === 0) city = text;
      if (i === 1) experience = text;
      if (i === 2) education = text;
    });

    if (!city) {
      const cityEl = document.querySelector('.location-address, .job-primary-detail .text-city');
      city = cityEl ? cityEl.textContent.trim() : '';
    }

    const company = extractCompanyName();

    const hrNameEl = document.querySelector('.boss-info-attr .name, .detail-figure-text .name, .boss-info .name');
    const hrTitleEl = document.querySelector('.boss-info-attr .boss-title, .detail-figure-text .title, .boss-info .title');
    const hrOnlineEl = document.querySelector('.boss-online-tag, .boss-active-time');
    const hr_name = hrNameEl ? hrNameEl.textContent.trim() : '';
    const hr_title = hrTitleEl ? hrTitleEl.textContent.trim() : '';
    const hr_active = hrOnlineEl ? hrOnlineEl.textContent.trim() : '';

    const descEl = document.querySelector('.job-sec-text, .job-detail-section');
    const description = descEl ? descEl.innerText.trim() : '';

    const tagEls = document.querySelectorAll('.job-tags .tag-item, .job-keyword-list li');
    const tags = Array.from(tagEls).map(el => el.textContent.trim()).join(',');

    const sizeEl = document.querySelector('.sider-company p:last-child, .company-info-size');
    const industryEl = document.querySelector('.sider-company p:first-child, .company-info-industry');
    const company_size = sizeEl ? sizeEl.textContent.trim() : '';
    const company_industry = industryEl ? industryEl.textContent.trim() : '';

    return {
      success: true,
      data: {
        title,
        salary,
        company,
        city,
        experience,
        education,
        description,
        url: window.location.href,
        hr_name,
        hr_title,
        hr_active,
        company_size,
        company_industry,
        tags,
      },
    };
  } catch (e) {
    console.warn('[FindJobs] 陪伴模式提取失败:', e);
    return { success: false, error: e.message };
  }
}

// ── 自动投递：点击沟通并发送文案 ──────────────

async function applyJob(greetingText) {
  try {
    let chatBtn = document.querySelector('a.btn.btn-startchat');
    if (!chatBtn) chatBtn = document.querySelector('.btn-startchat');

    if (!chatBtn) {
      const candidates = document.querySelectorAll('a.btn, button.btn, .btn-startchat-wrap a');
      for (const el of candidates) {
        const t = el.innerText.trim();
        if (t.includes('立即沟通') || t.includes('继续沟通')) {
          chatBtn = el;
          break;
        }
      }
    }

    if (!chatBtn) {
      return { success: false, error: '未找到"立即沟通"按钮' };
    }

    const btnText = chatBtn.innerText.trim();
    const isFriend = chatBtn.getAttribute('data-isfriend') === 'true';
    const redirectUrl = chatBtn.getAttribute('redirect-url');
    console.log('[FindJobs] 找到按钮:', btnText, 'isFriend:', isFriend, 'redirect:', redirectUrl);

    if (isFriend || btnText.includes('继续沟通')) {
      console.log('[FindJobs] 继续沟通场景 — 先返回信号，延迟点击');
      chatBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        chatBtn.click();
        console.log('[FindJobs] 延迟点击已执行');
      }, 300);
      return {
        success: true,
        data: { sent: false, reason: 'redirecting_to_chat', message: '继续沟通，等待跳转到聊天页' },
      };
    }

    chatBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
    chatBtn.click();
    console.log('[FindJobs] 已点击按钮');

    await sleep(2000);

    const popupResult = await tryPopupGreeting(greetingText);
    if (popupResult) {
      return popupResult;
    }

    if (window.location.href.includes('/web/geek/chat')) {
      return await sendGreetingOnChatPage(greetingText);
    }

    return {
      success: true,
      data: { sent: false, reason: 'button_clicked', message: '已点击沟通按钮，但未检测到弹窗或页面跳转' },
    };
  } catch (e) {
    console.error('[FindJobs] 投递失败:', e);
    return { success: false, error: e.message };
  }
}

async function tryPopupGreeting(greetingText) {
  let input = null;

  const allInputs = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]');
  for (const el of allInputs) {
    const ph = (el.getAttribute('placeholder') || '');
    if (ph.includes('描述') || ph.includes('问题') || ph.includes('沟通') || ph.includes('打招呼') || ph.includes('说点什么')) {
      input = el;
      break;
    }
  }

  if (!input) {
    input = document.querySelector('#chat-input');
  }

  if (!input) {
    const dialogSelectors = [
      '[class*="dialog"]', '[class*="Dialog"]', '[class*="modal"]',
      '[class*="popup"]', '[role="dialog"]', '[class*="chat-box"]',
    ];
    for (const sel of dialogSelectors) {
      try {
        const containers = document.querySelectorAll(sel);
        for (const ctn of containers) {
          if (ctn.offsetParent === null && ctn.style.display === 'none') continue;
          const found = ctn.querySelector('textarea') || ctn.querySelector('input[type="text"]') || ctn.querySelector('[contenteditable="true"]');
          if (found) { input = found; break; }
        }
        if (input) break;
      } catch {}
    }
  }

  if (!input) {
    console.log('[FindJobs] 未找到弹窗输入框');
    return null;
  }

  console.log('[FindJobs] 找到弹窗输入框:', input.tagName, input.getAttribute('placeholder'));

  if (!greetingText) {
    return {
      success: true,
      data: { sent: false, reason: 'popup_opened', message: '已打开沟通弹窗，但无沟通文案' },
    };
  }

  await typeIntoInput(input, greetingText);
  await sleep(800);

  const sent = await pressEnterToSend(input);
  if (sent) {
    console.log('[FindJobs] 弹窗回车发送成功');
    return { success: true, data: { sent: true, message: '已在弹窗中发送文案' } };
  }

  const clicked = await findAndClickSend();
  if (clicked) {
    await sleep(1000);
    console.log('[FindJobs] 弹窗点击发送成功');
    return { success: true, data: { sent: true, message: '已在弹窗中点击发送' } };
  }

  return { success: true, data: { sent: false, reason: 'send_failed', message: '文案已输入但发送失败' } };
}

async function sendGreetingOnChatPage(greetingText) {
  const inputSelectors = [
    '#chat-input',
    '.chat-input',
    'div[contenteditable="true"]',
    '.input-area textarea',
    'textarea.chat-input',
    '.chat-conversation textarea',
    '.message-input textarea',
  ];

  let chatInput = null;
  let retries = 10;
  while (retries > 0 && !chatInput) {
    for (const sel of inputSelectors) {
      chatInput = document.querySelector(sel);
      if (chatInput) break;
    }
    if (!chatInput) {
      const allInputs = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
      for (const el of allInputs) {
        const ph = (el.getAttribute('placeholder') || '');
        if (ph.includes('沟通') || ph.includes('消息') || ph.includes('输入') || ph.includes('说点什么')) {
          chatInput = el;
          break;
        }
      }
    }
    if (!chatInput) {
      await sleep(1000);
      retries--;
    }
  }

  if (!chatInput) {
    return {
      success: true,
      data: { sent: false, reason: 'chat_opened', message: '已进入聊天页面，但未找到输入框' },
    };
  }

  if (!greetingText) {
    return {
      success: true,
      data: { sent: false, reason: 'no_greeting', message: '已打开聊天窗口，但无沟通文案' },
    };
  }

  await typeIntoInput(chatInput, greetingText);
  await sleep(800);

  const sent = await pressEnterToSend(chatInput);
  if (sent) {
    return { success: true, data: { sent: true, message: '聊天页文案已发送' } };
  }

  const clicked = await findAndClickSend();
  if (clicked) {
    await sleep(1000);
    return { success: true, data: { sent: true, message: '聊天页文案已点击发送' } };
  }

  return { success: true, data: { sent: false, reason: 'send_failed', message: '文案已输入但发送失败' } };
}

async function typeIntoInput(el, text) {
  el.focus();
  await sleep(100);

  const tagName = el.tagName.toUpperCase();

  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.innerText = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await sleep(100);

  try {
    document.execCommand('insertText', false, text);
    console.log('[FindJobs] 使用 execCommand 输入');
    return;
  } catch {}

  try {
    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
    if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
      el.value = text;
    } else {
      el.innerText = text;
    }
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
    console.log('[FindJobs] 使用 InputEvent 输入');
    return;
  } catch {}

  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  console.log('[FindJobs] 使用直接赋值输入');
}

function clickElement(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

  el.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
  el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
  el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
  el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
  el.dispatchEvent(new MouseEvent('click', eventOpts));
}

async function pressEnterToSend(inputEl) {
  try {
    inputEl.focus();
    await sleep(200);

    const enterOpts = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true,
    };

    inputEl.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    await sleep(50);
    inputEl.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    await sleep(50);
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { ...enterOpts, cancelable: false }));
    await sleep(800);

    console.log('[FindJobs] 已按 Enter 发送');
    return true;
  } catch (e) {
    console.warn('[FindJobs] Enter 发送失败:', e);
    return false;
  }
}

async function findAndClickSend() {
  const sendSelectors = ['.btn-send', '.send-btn', '.btn-sure', '.btn-confirm', '.submit-btn'];
  for (const sel of sendSelectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      clickElement(btn);
      console.log('[FindJobs] 通过选择器找到发送按钮:', sel);
      return true;
    }
  }

  const allClickables = document.querySelectorAll('button, a, div[class*="send"], span[class*="send"], [role="button"]');
  for (const el of allClickables) {
    const t = el.innerText.trim();
    if ((t === '发送' || t === '确定' || t === '提交') && !el.disabled) {
      clickElement(el);
      console.log('[FindJobs] 通过文本找到发送按钮:', t, el.tagName);
      return true;
    }
  }

  return false;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
