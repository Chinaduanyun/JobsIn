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
from collections import deque
from typing import Any, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

EXTENSION_LONG_POLL_TIMEOUT = 5.0
EXTENSION_CONNECTED_GRACE = 18.0
LATE_RESULT_HISTORY_LIMIT = 100


class ExtensionBridge:
    """Chrome Extension ↔ Backend 通信桥接"""

    def __init__(self):
        self._command_queue: asyncio.Queue = asyncio.Queue()
        self._result_futures: dict[str, asyncio.Future] = {}
        self._last_poll: float = 0
        self._last_result: float = 0
        self._security_check: bool = False
        self._expired_commands: dict[str, float] = {}
        self._late_result_ids: deque[str] = deque(maxlen=LATE_RESULT_HISTORY_LIMIT)

    @property
    def connected(self) -> bool:
        """扩展是否在线（最近一段时间内有轮询或结果回传）"""
        latest_activity = max(self._last_poll, self._last_result)
        return time.time() - latest_activity < EXTENSION_CONNECTED_GRACE

    @property
    def security_check(self) -> bool:
        return self._security_check

    async def send_command(self, cmd_type: str, timeout: float = 30, **kwargs) -> dict:
        """发送命令给扩展，等待结果返回。"""
        self._prune_expired_commands()

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

            if result.get("security_check"):
                self._security_check = True
            else:
                self._security_check = False

            return result
        except asyncio.TimeoutError:
            self._result_futures.pop(cmd_id, None)
            self._expired_commands[cmd_id] = time.time()
            logger.error("[ExtBridge] 命令超时: %s (id=%s)", cmd_type, cmd_id)
            return {"success": False, "error": "命令执行超时", "transport_error": True}

    async def get_pending_command(self) -> Optional[dict]:
        """扩展调用：获取待执行命令。支持 long-poll（最多等5秒）。"""
        self._last_poll = time.time()
        self._prune_expired_commands()

        try:
            cmd = self._command_queue.get_nowait()
            return cmd
        except asyncio.QueueEmpty:
            pass

        try:
            cmd = await asyncio.wait_for(self._command_queue.get(), timeout=EXTENSION_LONG_POLL_TIMEOUT)
            return cmd
        except asyncio.TimeoutError:
            return None

    def report_result(self, command_id: str, result: dict) -> str:
        """扩展调用：报告命令执行结果。"""
        now = time.time()
        self._last_result = now
        self._prune_expired_commands(now)

        future = self._result_futures.pop(command_id, None)
        if future and not future.done():
            future.set_result(result)
            logger.debug("[ExtBridge] 结果已送达: %s", command_id)
            return "received"

        if command_id in self._expired_commands:
            self._late_result_ids.append(command_id)
            self._expired_commands.pop(command_id, None)
            logger.warning("[ExtBridge] 收到超时后的晚到结果: %s", command_id)
            return "late_result"

        logger.warning("[ExtBridge] 未找到命令 Future: %s", command_id)
        return "unknown_command"

    def get_status(self) -> dict:
        self._prune_expired_commands()
        return {
            "connected": self.connected,
            "last_poll": self._last_poll,
            "last_result": self._last_result,
            "pending_commands": self._command_queue.qsize(),
            "waiting_results": len(self._result_futures),
            "expired_commands": len(self._expired_commands),
            "late_results": len(self._late_result_ids),
            "security_check": self._security_check,
        }

    def _prune_expired_commands(self, now: Optional[float] = None) -> None:
        now = now or time.time()
        stale_before = now - EXTENSION_CONNECTED_GRACE * 3
        expired_ids = [cmd_id for cmd_id, expired_at in self._expired_commands.items() if expired_at < stale_before]
        for cmd_id in expired_ids:
            self._expired_commands.pop(cmd_id, None)


# 全局单例
extension_bridge = ExtensionBridge()
