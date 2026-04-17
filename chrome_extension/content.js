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
});

// ── 提取岗位列表 ─────────────────────────────

function extractJobs() {
  const cards = document.querySelectorAll('.job-card-wrapper, .job-card-box');

  if (!cards.length) {
    // 检查是否是空结果
    const empty = document.querySelector('.job-empty-wrapper, .empty-tips');
    if (empty) {
      return { jobs: [], empty: true, message: '无搜索结果' };
    }
    return { jobs: [], empty: false, message: '未找到岗位卡片元素' };
  }

  const jobs = Array.from(cards).map(card => {
    const nameEl = card.querySelector('.job-name, .job-title');
    const areaEl = card.querySelector('.job-area, .job-area-wrapper');
    const salaryEl = card.querySelector('.salary');
    const companyEl = card.querySelector('.company-name a, .company-name');

    // 标签列表: 通常 [经验, 学历, ...技能标签]
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
      // 确保是完整 URL
      if (url.startsWith('/')) {
        url = 'https://www.zhipin.com' + url;
      }
    }

    return {
      title: nameEl ? nameEl.textContent.trim() : '',
      city: areaEl ? areaEl.textContent.trim() : '',
      salary: salaryEl ? salaryEl.textContent.trim() : '',
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

  return {
    description: descEl ? descEl.innerText.trim() : '',
    tags: Array.from(tagEls).map(el => el.textContent.trim()).join(','),
    company_size: sizeEl ? sizeEl.textContent.trim() : '',
    company_industry: industryEl ? industryEl.textContent.trim() : '',
    page_url: window.location.href,
  };
}
