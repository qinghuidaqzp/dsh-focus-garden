把专注时间种成 emoji 花朵，支持开始、暂停、恢复、取消和收获。

- 已验证 DeepSeek Harness 0.2.2-rc.2。
- 14 项自动化测试通过；三个趣味插件一起安装后，11 个原生工具均成功注册，代表性操作已在真实 Harness 中调用通过。
- 无需额外 API Key，无需 npm 账号。

桌面版先完全退出 Harness，再安装：

```sh
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-focus-garden/releases/download/v0.1.0/dsh-focus-garden-0.1.0.tgz"
```

Web 版将 `desktop` 改为 `web`。完整说明见 [README](https://github.com/qinghuidaqzp/dsh-focus-garden#readme)。

首版为对话内计时和文字花园；不弹窗、不播放声音，重启或重载插件后花园清空。

附件包含预构建安装包和 SHA-256 校验文件。
