/**
 * FindJobs Chrome Extension — Popup Script
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const pollDot = document.getElementById('pollDot');
const pollText = document.getElementById('pollText');
const toggleBtn = document.getElementById('toggleBtn');
const modeAutoBtn = document.getElementById('modeAuto');
const modeCompanionBtn = document.getElementById('modeCompanion');
const modeDesc = document.getElementById('modeDesc');
const autoSection = document.getElementById('autoSection');

let currentMode = 'auto';

const MODE_DESCS = {
  auto: '自动采集：后端下发任务，插件自动执行',
  companion: '陪伴浏览：打开岗位详情页即自动收藏保存',
};

function updateUI(status) {
  if (status.connected) {
    statusDot.className = 'status-dot dot-green';
    statusText.textContent = '后端已连接';
  } else {
    statusDot.className = 'status-dot dot-red';
    statusText.textContent = '后端未连接';
  }

  // 更新模式
  currentMode = status.mode || 'auto';
  modeAutoBtn.classList.toggle('active', currentMode === 'auto');
  modeCompanionBtn.classList.toggle('active', currentMode === 'companion');
  modeDesc.textContent = MODE_DESCS[currentMode];
  modeDesc.className = currentMode === 'companion' ? 'mode-desc companion' : 'mode-desc';

  // 自动模式才显示轮询控制
  autoSection.style.display = currentMode === 'auto' ? 'block' : 'none';

  if (status.polling) {
    pollDot.className = 'status-dot dot-green';
    pollText.textContent = '轮询: 运行中';
    toggleBtn.textContent = '停止轮询';
    toggleBtn.className = 'btn btn-red';
  } else {
    pollDot.className = 'status-dot dot-yellow';
    pollText.textContent = '轮询: 已停止';
    toggleBtn.textContent = '开始轮询';
    toggleBtn.className = 'btn btn-green';
  }
}

// 获取状态
function refreshStatus() {
  chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
    if (response) {
      updateUI(response);
    }
  });
}

// 切换轮询
toggleBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'get_status' }, (status) => {
    const action = status.polling ? 'stop_polling' : 'start_polling';
    chrome.runtime.sendMessage({ action }, () => {
      setTimeout(refreshStatus, 500);
    });
  });
});

// 模式切换
function switchMode(mode) {
  chrome.runtime.sendMessage({ action: 'set_mode', mode }, () => {
    setTimeout(refreshStatus, 300);
  });
}

modeAutoBtn.addEventListener('click', () => switchMode('auto'));
modeCompanionBtn.addEventListener('click', () => switchMode('companion'));

// 初始化
refreshStatus();
setInterval(refreshStatus, 2000);
