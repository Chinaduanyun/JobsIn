/**
 * FindJobs Chrome Extension — Popup Script
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const pollDot = document.getElementById('pollDot');
const pollText = document.getElementById('pollText');
const toggleBtn = document.getElementById('toggleBtn');

function updateUI(status) {
  if (status.connected) {
    statusDot.className = 'status-dot dot-green';
    statusText.textContent = '后端已连接';
  } else {
    statusDot.className = 'status-dot dot-red';
    statusText.textContent = '后端未连接';
  }

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

// 初始化
refreshStatus();
setInterval(refreshStatus, 2000);
