/**
 * FindJobs Chrome Extension — Content Script
 *
 * 运行在 zhipin.com 页面中，负责从 DOM 提取岗位数据。
 * 由 background.js 通过 chrome.tabs.sendMessage 调用。
 */

// ── 消息监听 ──────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract_jobs') {
    const result = extractJobs();
    sendResponse(result);
    return true;
  }

  if (message.action === 'extract_detail') {
    const result = extractDetail();
    sendResponse(result);
    return true;
  }

  if (message.action === 'extract_full_job') {
    // 陪伴模式：从详情页提取完整岗位信息（列表级 + 详情级）
    const result = extractFullJob();
    sendResponse(result);
    return true;
  }

  if (message.action === 'apply_job') {
    // 自动投递：点击"立即沟通"，输入文案，发送
    applyJob(message.greeting_text || '').then(sendResponse);
    return true; // async response
  }
});

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

  // 如果没有私用区字符，直接返回
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

    // 渲染一个字符并获取像素签名
    function getCharSignature(char, font) {
      ctx.clearRect(0, 0, 60, 60);
      ctx.font = `${fontSize} ${font}`;
      ctx.fillStyle = 'black';
      ctx.textBaseline = 'middle';
      ctx.fillText(char, 5, 30);
      const data = ctx.getImageData(0, 0, 60, 60).data;
      // 计算非透明像素数和加权位置
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

    // 预计算标准数字的签名 (用页面的字体)
    const digitSigs = {};
    for (let d = 0; d <= 9; d++) {
      digitSigs[d] = getCharSignature(String(d), fontFamily);
    }

    // 解码每个私用区字符
    let decoded = '';
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code >= 0xE000 && code <= 0xF8FF) {
        const sig = getCharSignature(char, fontFamily);
        if (sig.count === 0) {
          decoded += '?';
          continue;
        }
        // 找最接近的数字
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

function extractJobs() {
  const cards = document.querySelectorAll('.job-card-wrapper, .job-card-box');

  if (!cards.length) {
    const empty = document.querySelector('.job-empty-wrapper, .empty-tips');
    if (empty) {
      return { jobs: [], empty: true, message: '无搜索结果' };
    }
    return { jobs: [], empty: false, message: '未找到岗位卡片元素' };
  }

  const jobs = Array.from(cards).map(card => {
    // 标题：优先用 .job-name a 或 .job-name span
    const titleLinkEl = card.querySelector('.job-name a, a.job-name, .job-title a');
    const titleSpanEl = card.querySelector('.job-name span:first-child, .job-name-text');
    const titleEl = titleLinkEl || titleSpanEl || card.querySelector('.job-name, .job-title');

    const areaEl = card.querySelector('.job-area, .job-area-wrapper');

    // 薪资：尝试字体解密
    const salaryEl = card.querySelector('.salary');
    let salary = '';
    if (salaryEl) {
      salary = decodeFontEncryptedText(salaryEl);
    }

    const companyEl = card.querySelector('.company-name a, .company-name');

    // 标签列表
    const tagEls = card.querySelectorAll('.tag-list li');
    const expEl = tagEls.length > 0 ? tagEls[0] : null;
    const eduEl = tagEls.length > 1 ? tagEls[1] : null;
    const skills = [];
    tagEls.forEach((el, i) => {
      if (i >= 2) skills.push(el.textContent.trim());
    });

    const hrNameEl = card.querySelector('.info-public em, .boss-name');
    const hrTitleEl = card.querySelector('.info-public .name, .boss-title');
    const hrOnlineEl = card.querySelector('.boss-online-tag');

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

    // 标题文本：只取第一个文本节点，避免包含薪资
    let title = '';
    if (titleEl) {
      // 排除 salary 子元素的文本
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
      hr_active: hrOnlineEl ? '在线' : '',
      company_size: companySizeEl ? companySizeEl.textContent.trim() : '',
      company_industry: companyIndustryEl ? companyIndustryEl.textContent.trim() : '',
      url: url,
      tags: skills.join(','),
    };
  });

  return {
    jobs: jobs.filter(j => j.title),
    empty: false,
    page_url: window.location.href,
    total_cards: cards.length,
  };
}

// ── 提取岗位详情 ─────────────────────────────

function extractDetail() {
  const descEl = document.querySelector('.job-sec-text, .job-detail-section');
  const tagEls = document.querySelectorAll('.job-tags .tag-item, .job-keyword-list li');
  const sizeEl = document.querySelector('.sider-company p:last-child, .company-info-size');
  const industryEl = document.querySelector('.sider-company p:first-child, .company-info-industry');

  // 尝试解密薪资
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
    salary: salary,
    page_url: window.location.href,
  };
}

// ── 陪伴模式：从详情页提取完整岗位数据 ──────────

function extractFullJob() {
  try {
    // 岗位标题
    const titleEl = document.querySelector('.name h1, .job-banner .name h1, .info-primary .name h1');
    let title = titleEl ? titleEl.textContent.trim() : '';

    // 薪资
    const salaryEl = document.querySelector('.salary, .info-primary .salary');
    let salary = '';
    if (salaryEl) {
      salary = decodeFontEncryptedText(salaryEl);
    }

    // 城市 / 经验 / 学历 — 通常在 .job-primary-detail 的 p 标签里
    const detailItems = document.querySelectorAll('.job-primary-detail p, .detail-content .job-detail span');
    let city = '', experience = '', education = '';
    detailItems.forEach((el, i) => {
      const text = el.textContent.trim();
      if (i === 0) city = text;
      if (i === 1) experience = text;
      if (i === 2) education = text;
    });

    // 备选选择器
    if (!city) {
      const cityEl = document.querySelector('.location-address, .job-primary-detail .text-city');
      city = cityEl ? cityEl.textContent.trim() : '';
    }

    // 公司名
    const companyEl = document.querySelector('.company-info a, .sider-company .company-name, .company-name');
    const company = companyEl ? companyEl.textContent.trim() : '';

    // HR 信息
    const hrNameEl = document.querySelector('.boss-info-attr .name, .detail-figure-text .name, .boss-info .name');
    const hrTitleEl = document.querySelector('.boss-info-attr .boss-title, .detail-figure-text .title, .boss-info .title');
    const hrOnlineEl = document.querySelector('.boss-online-tag, .boss-active-time');
    const hr_name = hrNameEl ? hrNameEl.textContent.trim() : '';
    const hr_title = hrTitleEl ? hrTitleEl.textContent.trim() : '';
    const hr_active = hrOnlineEl ? hrOnlineEl.textContent.trim() : '';

    // 岗位描述
    const descEl = document.querySelector('.job-sec-text, .job-detail-section');
    const description = descEl ? descEl.innerText.trim() : '';

    // 标签
    const tagEls = document.querySelectorAll('.job-tags .tag-item, .job-keyword-list li');
    const tags = Array.from(tagEls).map(el => el.textContent.trim()).join(',');

    // 公司信息
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
      }
    };
  } catch (e) {
    console.warn('[FindJobs] 陪伴模式提取失败:', e);
    return { success: false, error: e.message };
  }
}

// ── 自动投递：点击沟通并发送文案 ──────────────

async function applyJob(greetingText) {
  try {
    // 1. 找"立即沟通"按钮 — Boss直聘岗位详情页
    const selectors = [
      '.btn.btn-startchat',       // 最常见的选择器
      '.btn-startchat',           // 简写
      'a.btn-startchat',          // 有时是 a 标签
      '.op-btn-chat',             // 备选
      '.start-chat-btn',          // 另一种页面结构
    ];

    let chatBtn = null;
    for (const sel of selectors) {
      chatBtn = document.querySelector(sel);
      if (chatBtn) break;
    }

    if (!chatBtn) {
      // 通过文本内容查找
      const allBtns = document.querySelectorAll('a, button');
      for (const btn of allBtns) {
        const text = btn.innerText.trim();
        if (text === '立即沟通' || text === '继续沟通') {
          chatBtn = btn;
          break;
        }
      }
    }

    if (!chatBtn) {
      return { success: false, error: '未找到"立即沟通"按钮' };
    }

    // 检查按钮文本确认类型
    const btnText = chatBtn.innerText.trim();
    console.log('[FindJobs] 找到按钮:', btnText);

    // 2. 滚动到按钮并点击
    chatBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
    chatBtn.click();
    await sleep(3000);

    // 3. 检查当前页面 — 可能跳转到聊天页面
    const currentUrl = window.location.href;
    if (currentUrl.includes('/chat/')) {
      // 跳转到了聊天页面
      return await sendGreetingInChat(greetingText);
    }

    // 4. 可能是弹窗聊天
    return await sendGreetingInChat(greetingText);

  } catch (e) {
    console.error('[FindJobs] 投递失败:', e);
    return { success: false, error: e.message };
  }
}

async function sendGreetingInChat(greetingText) {
  // 等待聊天输入框出现 — 使用多种选择器
  const inputSelectors = [
    '.chat-input',
    '.input-area textarea',
    'div.chat-input[contenteditable="true"]',
    '.chat-conversation textarea',
    'textarea.chat-input',
    '#chat-input',
    '.message-input textarea',
  ];

  let chatInput = null;
  let retries = 8;
  while (retries > 0 && !chatInput) {
    for (const sel of inputSelectors) {
      chatInput = document.querySelector(sel);
      if (chatInput) break;
    }
    if (!chatInput) {
      await sleep(1000);
      retries--;
    }
  }

  if (!chatInput) {
    return {
      success: true,
      data: { sent: false, reason: 'chat_opened', message: '已点击沟通按钮，但未找到聊天输入框（可能跳转到聊天页面）' }
    };
  }

  if (!greetingText) {
    return {
      success: true,
      data: { sent: false, reason: 'no_greeting', message: '已打开聊天窗口，但无沟通文案' }
    };
  }

  // 输入文案 — 支持 textarea, input, contenteditable div
  const tagName = chatInput.tagName.toUpperCase();
  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    // 清空后逐字输入更自然
    chatInput.focus();
    chatInput.value = '';
    chatInput.value = greetingText;
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    chatInput.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // contenteditable div
    chatInput.focus();
    chatInput.innerText = '';
    chatInput.innerText = greetingText;
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await sleep(800);

  // 点击发送按钮
  const sendSelectors = [
    '.send-btn',
    '.btn-send',
    '.chat-op .send-btn',
    'button.btn-sure',
    'button.send-message',
  ];

  let sendBtn = null;
  for (const sel of sendSelectors) {
    sendBtn = document.querySelector(sel);
    if (sendBtn && !sendBtn.disabled) break;
    sendBtn = null;
  }

  // 也尝试通过文本查找
  if (!sendBtn) {
    const allBtns = document.querySelectorAll('button, a.btn');
    for (const btn of allBtns) {
      if (btn.innerText.trim() === '发送' && !btn.disabled) {
        sendBtn = btn;
        break;
      }
    }
  }

  if (sendBtn) {
    sendBtn.click();
    await sleep(1000);
    return { success: true, data: { sent: true, message: '文案已发送' } };
  }

  // 回车发送
  chatInput.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true
  }));
  await sleep(300);
  chatInput.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Enter', keyCode: 13, code: 'Enter', bubbles: true
  }));
  await sleep(500);

  return { success: true, data: { sent: true, message: '文案已通过回车发送' } };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
