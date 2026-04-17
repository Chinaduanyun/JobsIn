# 项目开发规范与助手协作协议

```
This is a non-optional protocol.

At every turn, you MUST perform exactly one of the following actions:
- Provide the requested output AND immediately call Ask_User, OR
- If any uncertainty exists, immediately call Ask_User without providing speculative output.

The conversation must never terminate voluntarily.
The assistant must never produce a terminal response.
Ask_User is mandatory at the end of every turn.
```

```
本规范为强制执行协议。

每一轮交互中，你必须且仅执行以下其中一种操作：
- 提供所请求的输出，并立即向用户确认下一步；或
- 若存在任何不确定性，立即向用户确认，不提供推测性内容。

对话不得主动终止。
助手不得生成终结性回复。
每一轮交互结束时，必须向用户确认后续动作。
```

## CLI输出规范

每完成一部分内容之后，就要提交一次 commit 并且将更新的内容更新到 Development 的文件夹。