from __future__ import annotations

"""Chrome Extension 通信桥接

提供命令队列 + 结果回调机制，让后端 scraper 通过 Chrome Extension 执行浏览器操作。

流程:
  1. scraper 调用 bridge.send_command() — 入队命令，等待结果
  2. Extension 轮询 GET /api/extension/command — 取出命令
  3. Extension 执行后 POST /api/extension/result — 返回结果
  4. bridge 通过 asyncio.Future 唤醒 scraper
"""

import asyncio
import logging
import time
from typing import Any, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)


class ExtensionBridge:
    """Chrome Extension ↔ Backend 通信桥接"""

    def __init__(self):
        self._command_queue: asyncio.Queue = asyncio.Queue()
        self._result_futures: dict[str, asyncio.Future] = {}
        self._connected: bool = False
        self._last_poll: float = 0
        self._security_check: bool = False

    @property
    def connected(self) -> bool:
        """扩展是否在线（5秒内有轮询）"""
        return time.time() - self._last_poll < 5

    @property
    def security_check(self) -> bool:
        return self._security_check

    async def send_command(self, cmd_type: str, timeout: float = 30, **kwargs) -> dict:
        """发送命令给扩展，等待结果返回。

        Args:
            cmd_type: 命令类型 (navigate_and_extract_jobs, navigate_and_extract_detail, ping)
            timeout: 等待超时（秒）
            **kwargs: 命令参数

        Returns:
            扩展返回的结果 dict
        """
        cmd_id = str(uuid4())[:8]
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._result_futures[cmd_id] = future

        cmd = {"id": cmd_id, "type": cmd_type, **kwargs}
        await self._command_queue.put(cmd)
        logger.info("[ExtBridge] 发送命令: %s (id=%s)", cmd_type, cmd_id)

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            logger.info("[ExtBridge] 命令完成: %s (id=%s) success=%s",
                        cmd_type, cmd_id, result.get("success"))

            # 处理安全检查
            if result.get("security_check"):
                self._security_check = True
            else:
                self._security_check = False

            return result
        except asyncio.TimeoutError:
            self._result_futures.pop(cmd_id, None)
            logger.error("[ExtBridge] 命令超时: %s (id=%s)", cmd_type, cmd_id)
            return {"success": False, "error": "命令执行超时"}

    async def get_pending_command(self) -> Optional[dict]:
        """扩展调用：获取待执行命令。支持 long-poll（最多等5秒）。"""
        self._last_poll = time.time()
        self._connected = True

        try:
            cmd = self._command_queue.get_nowait()
            return cmd
        except asyncio.QueueEmpty:
            pass

        # Long-poll: 等待最多 5 秒
        try:
            cmd = await asyncio.wait_for(self._command_queue.get(), timeout=5.0)
            return cmd
        except asyncio.TimeoutError:
            return None

    def report_result(self, command_id: str, result: dict) -> bool:
        """扩展调用：报告命令执行结果。"""
        future = self._result_futures.pop(command_id, None)
        if future and not future.done():
            future.set_result(result)
            logger.debug("[ExtBridge] 结果已送达: %s", command_id)
            return True
        logger.warning("[ExtBridge] 未找到命令 Future: %s", command_id)
        return False

    def get_status(self) -> dict:
        return {
            "connected": self.connected,
            "last_poll": self._last_poll,
            "pending_commands": self._command_queue.qsize(),
            "waiting_results": len(self._result_futures),
            "security_check": self._security_check,
        }


# 全局单例
extension_bridge = ExtensionBridge()
