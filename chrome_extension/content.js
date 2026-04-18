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

  if (message.action === 'send_chat_greeting') {
    // 在聊天页面发送文案 (由 background.js 在页面跳转后调用)
    sendGreetingOnChatPage(message.greeting_text || '').then(sendResponse);
    return true;
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
      hr_active: hrOnlineEl ? hrOnlineEl.textContent.trim() : '',
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

/**
 * Boss直聘投递流程:
 * 1. 在岗位详情页找到 "立即沟通" / "继续沟通" 按钮
 * 2. 点击后可能出现:
 *    a) 弹窗 (dialog/popup) — 含输入框和发送按钮 (首次沟通)
 *    b) 页面跳转到 /web/geek/chat 聊天页 (已是好友)
 * 3. 在弹窗或聊天页中输入文案并发送
 */
async function applyJob(greetingText) {
  try {
    // 1. 找"立即沟通"按钮 — 必须精确匹配，避免命中"感兴趣"等其他按钮
    let chatBtn = document.querySelector('a.btn.btn-startchat');
    if (!chatBtn) chatBtn = document.querySelector('.btn-startchat');

    // 文本精确匹配兜底 — 只找含"立即沟通"或"继续沟通"文本的 a/button
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

    // 2. "继续沟通" 场景: 点击会导致页面跳转，消息通道会断开
    //    先返回信号给 background.js，再用 setTimeout 延迟点击
    if (isFriend || redirectUrl) {
      console.log('[FindJobs] 继续沟通场景 — 先返回信号，延迟点击');
      chatBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 延迟点击，确保 sendResponse 先送达
      setTimeout(() => {
        chatBtn.click();
        console.log('[FindJobs] 延迟点击已执行');
      }, 300);
      return {
        success: true,
        data: { sent: false, reason: 'redirecting_to_chat', message: '继续沟通，等待跳转到聊天页' }
      };
    }

    // 3. "立即沟通" 场景: 点击后会弹窗，不会导航
    chatBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
    chatBtn.click();
    console.log('[FindJobs] 已点击按钮');

    // 4. 等待弹窗出现
    await sleep(2000);

    // 5. 在弹窗中输入文案并发送
    const popupResult = await tryPopupGreeting(greetingText);
    if (popupResult) {
      return popupResult;
    }

    // 6. 兜底: 可能意外跳转到聊天页 (SPA 路由)
    if (window.location.href.includes('/web/geek/chat')) {
      return await sendGreetingOnChatPage(greetingText);
    }

    // 7. 最终兜底
    return {
      success: true,
      data: { sent: false, reason: 'button_clicked', message: '已点击沟通按钮，但未检测到弹窗或页面跳转' }
    };

  } catch (e) {
    console.error('[FindJobs] 投递失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 尝试在弹窗中输入文案并发送
 * Boss直聘首次沟通时，点击"立即沟通"后会弹出一个对话框
 * 对话框中有输入框 (placeholder 含 "描述" 或 "问题") 和发送按钮
 * @returns {object|null} 成功返回结果，未找到弹窗返回 null
 */
async function tryPopupGreeting(greetingText) {
  // 直接在整个页面搜索匹配的输入框 — Boss直聘弹窗的 class 名称不确定，
  // 但输入框的 placeholder "请简短描述您的问题" 是确定的
  let input = null;

  // 方法1: 通过 placeholder 文本找 (最精确)
  const allInputs = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]');
  for (const el of allInputs) {
    const ph = (el.getAttribute('placeholder') || '');
    if (ph.includes('描述') || ph.includes('问题') || ph.includes('沟通') || ph.includes('打招呼') || ph.includes('说点什么')) {
      input = el;
      break;
    }
  }

  // 方法2: 找 #chat-input (Boss直聘聊天框常用 ID)
  if (!input) {
    input = document.querySelector('#chat-input');
  }

  // 方法3: 找弹窗/对话框容器内的输入框
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
      } catch { /* ignore */ }
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
      data: { sent: false, reason: 'popup_opened', message: '已打开沟通弹窗，但无沟通文案' }
    };
  }

  // 输入文案
  await typeIntoInput(input, greetingText);
  await sleep(800);

  // 用回车发送 — Boss直聘输入框按 Enter 即可发送
  const sent = await pressEnterToSend(input);
  if (sent) {
    console.log('[FindJobs] 弹窗回车发送成功');
    return { success: true, data: { sent: true, message: '已在弹窗中发送文案' } };
  }

  // 兜底：尝试点击发送按钮
  const clicked = await findAndClickSend();
  if (clicked) {
    await sleep(1000);
    console.log('[FindJobs] 弹窗点击发送成功');
    return { success: true, data: { sent: true, message: '已在弹窗中点击发送' } };
  }

  return { success: true, data: { sent: false, reason: 'send_failed', message: '文案已输入但发送失败' } };
}

/**
 * 在聊天页面 (/web/geek/chat) 输入文案并发送
 */
async function sendGreetingOnChatPage(greetingText) {
  // 等待聊天输入框出现
  const inputSelectors = [
    '#chat-input',                          // czc-good-job 验证的选择器
    '.chat-input',
    'div[contenteditable="true"]',          // Boss直聘聊天框通常是 contenteditable div
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
      // 也通过 placeholder 找
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
      data: { sent: false, reason: 'chat_opened', message: '已进入聊天页面，但未找到输入框' }
    };
  }

  if (!greetingText) {
    return {
      success: true,
      data: { sent: false, reason: 'no_greeting', message: '已打开聊天窗口，但无沟通文案' }
    };
  }

  // 输入文案
  await typeIntoInput(chatInput, greetingText);
  await sleep(800);

  // 用回车发送 — Boss直聘聊天页按 Enter 即可发送
  const sent = await pressEnterToSend(chatInput);
  if (sent) {
    return { success: true, data: { sent: true, message: '聊天页文案已发送' } };
  }

  // 兜底：点击发送按钮
  const clicked = await findAndClickSend();
  if (clicked) {
    await sleep(1000);
    return { success: true, data: { sent: true, message: '聊天页文案已点击发送' } };
  }

  return { success: true, data: { sent: false, reason: 'send_failed', message: '文案已输入但发送失败' } };
}

/**
 * 向输入元素中输入文本
 * 使用 execCommand('insertText') 模拟真实键盘输入，
 * 确保 React/Vue 等框架能正确检测到输入变化
 */
async function typeIntoInput(el, text) {
  el.focus();
  await sleep(100);

  const tagName = el.tagName.toUpperCase();

  // 先清空
  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.innerText = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await sleep(100);

  // 方法1: execCommand — 最接近真实键盘输入，框架能检测到
  try {
    document.execCommand('insertText', false, text);
    console.log('[FindJobs] 使用 execCommand 输入');
    return;
  } catch { /* fallback */ }

  // 方法2: InputEvent (现代方式)
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
  } catch { /* fallback */ }

  // 方法3: 直接赋值 + 事件
  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    // 修改 React 内部值
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

/**
 * 点击发送按钮 — 使用完整的鼠标事件序列
 * 模拟真实用户点击: pointerdown → mousedown → pointerup → mouseup → click
 */
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

/**
 * 在输入框中按 Enter 键发送消息
 * Boss直聘的输入框按回车就能发送，这是最可靠的发送方式
 */
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

/**
 * 在页面中查找发送按钮并点击
 * @returns {boolean} 是否找到并点击了发送按钮
 */
async function findAndClickSend() {
  // 精确选择器
  const sendSelectors = ['.btn-send', '.send-btn', '.btn-sure', '.btn-confirm', '.submit-btn'];
  for (const sel of sendSelectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      clickElement(btn);
      console.log('[FindJobs] 通过选择器找到发送按钮:', sel);
      return true;
    }
  }

  // 文本查找 — 扩大搜索范围，包括 div/span/a 等任意可点击元素
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
