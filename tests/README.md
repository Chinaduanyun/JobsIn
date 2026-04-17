# Browser Anti-Detection Tests

测试不同方案能否让 Chrome 稳定访问 zhipin.com。

## 测试顺序

### 1. test1_pure_chrome.py — 纯 Chrome（无 CDP）
```bash
source .venv/bin/activate
python tests/test1_pure_chrome.py
```
验证纯 Chrome 能正常打开 zhipin.com → **请在打开的 Chrome 里登录**。

### 2. test2_cdp_delayed.py — CDP 连接测试
```bash
python tests/test2_cdp_delayed.py
```
验证 CDP 连接后 zhipin.com 是否会检测到。

### 3. test3_cookie_http.py — 从 profile 读 cookies
```bash
python tests/test3_cookie_http.py
```
尝试直接读 Chrome cookie 数据库（macOS 上 cookies 通常加密）。

### 4. test4_cdp_export_cookies.py — CDP 导出 cookies + HTTP 采集
```bash
python tests/test4_cdp_export_cookies.py
```
**最推荐的方案**: 用 CDP headless 导出 cookies → 断开 CDP → 用 httpx 采集。

## 预期结果

| 测试 | 预期 | 说明 |
|------|------|------|
| test1 | ✅ 正常 | 纯 Chrome = 正常浏览器 |
| test2 | ❌ 白屏 | CDP 会被检测 |
| test3 | ⚠️ cookies 加密 | macOS Keychain 保护 |
| test4 | ✅ 正常 | CDP 只做 cookie 导出，采集用 HTTP |
