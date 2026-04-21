/**
 * FindJobs Chrome Extension — Popup Script
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const pollDot = document.getElementById('pollDot');
const pollText = document.getElementById('pollText');
const pollRow = document.getElementById('pollRow');
const toggleBtn = document.getElementById('toggleBtn');
const showAssistantBtn = document.getElementById('showAssistantBtn');
const resetAssistantBtn = document.getElementById('resetAssistantBtn');
const modeAutoBtn = document.getElementById('modeAuto');
const modeCompanionBtn = document.getElementById('modeCompanion');
const modeGreetingBtn = document.getElementById('modeGreeting');
const modeBadge = document.getElementById('modeBadge');
const modeDesc = document.getElementById('modeDesc');
const popupError = document.getElementById('popupError');

let currentMode = 'auto';

const MODE_DESCS = {
  auto: '自动模式：用于承载后端任务执行视图，命令通道可单独开关。',
  companion: '陪伴模式：浏览到岗位详情页后自动提取并保存。',
  greeting: '沟通助手：在页面悬浮球中生成、编辑并复制沟通文案。',
};

const MODE_LABELS = {
  auto: 'AUTO',
  companion: '陪伴',
  greeting: '沟通',
};

function showError(message = '') {
  if (!message) {
    popupError.style.display = 'none';
    popupError.textContent = '';
    return;
  }
  popupError.textContent = message;
  popupError.style.display = 'block';
}

function updateUI(status) {
  currentMode = status.mode || 'auto';

  statusDot.className = `status-dot ${status.connected ? 'dot-green' : 'dot-red'}`;
  statusText.textContent = status.connected ? '后端已连接' : '后端未连接';

  modeBadge.textContent = MODE_LABELS[currentMode] || currentMode.toUpperCase();
  modeDesc.textContent = MODE_DESCS[currentMode] || '';

  modeAutoBtn.classList.toggle('active', currentMode === 'auto');
  modeCompanionBtn.classList.toggle('active', currentMode === 'companion');
  modeGreetingBtn.classList.toggle('active', currentMode === 'greeting');

  pollRow.style.display = 'flex';
  toggleBtn.style.display = 'block';

  if (status.polling) {
    pollDot.className = 'status-dot dot-green';
    pollText.textContent = '命令通道: 运行中';
    toggleBtn.textContent = '停止命令通道';
    toggleBtn.className = 'btn danger';
  } else {
    pollDot.className = 'status-dot dot-yellow';
    pollText.textContent = '命令通道: 已停止';
    toggleBtn.textContent = '开启命令通道';
    toggleBtn.className = 'btn';
  }
}

function sendMessage(message) {
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

async function refreshStatus() {
  try {
    const response = await sendMessage({ action: 'get_status' });
    if (response) {
      updateUI(response);
      showError('');
    }
  } catch (err) {
    showError(err.message || '状态读取失败');
  }
}

async function switchMode(mode) {
  try {
    showError('');
    const response = await sendMessage({ action: 'set_mode', mode });
    updateUI(response || { mode });
  } catch (err) {
    showError(err.message || '模式切换失败');
  }
}

async function togglePolling() {
  try {
    showError('');
    const status = await sendMessage({ action: 'get_status' });
    const action = status.polling ? 'stop_polling' : 'start_polling';
    const response = await sendMessage({ action });
    updateUI(response || status);
  } catch (err) {
    showError(err.message || '轮询切换失败');
  }
}

async function invokeAssistantAction(action, successMessage = '') {
  try {
    showError('');
    const response = await sendMessage({ action });
    if (!response?.ok) {
      throw new Error(response?.error || '操作失败');
    }
    if (successMessage) {
      showError(successMessage);
      popupError.style.background = '#eff6ff';
      popupError.style.borderColor = '#bfdbfe';
      popupError.style.color = '#1e3a8a';
    }
  } catch (err) {
    popupError.style.background = '#fff1f2';
    popupError.style.borderColor = '#fecdd3';
    popupError.style.color = '#be123c';
    showError(err.message || '操作失败');
  }
}

modeAutoBtn.addEventListener('click', () => switchMode('auto'));
modeCompanionBtn.addEventListener('click', () => switchMode('companion'));
modeGreetingBtn.addEventListener('click', () => switchMode('greeting'));
toggleBtn.addEventListener('click', togglePolling);
showAssistantBtn.addEventListener('click', () => invokeAssistantAction('show_page_assistant', '页面助手已恢复，请回到 Boss 页面查看。'));
resetAssistantBtn.addEventListener('click', () => invokeAssistantAction('reset_assistant_position', '悬浮球位置已重置。'));

refreshStatus();
setInterval(refreshStatus, 2000);
