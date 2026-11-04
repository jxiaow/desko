# README 界面截图

这些图片由当前应用前端在 Playwright 的隔离内存后端中渲染，使用虚构的小记、账号和会话数据，不读取桌面档案。验证码为固定演示值，用量为模拟记录的统计结果。图片不做界面重绘或后期拼接。

| 文件 | 内容 |
| --- | --- |
| `notes-paper.png` | 纸色小记工作台 |
| `notes-ink.png` | 墨色小记工作台 |
| `codex-usage.png` | Codex 今日用量与模型排行 |
| `codex-sessions.png` | Codex 项目会话列表 |
| `mfa.png` | 验证码列表 |

在仓库根目录安装依赖后，使用 Windows PowerShell 执行：

```powershell
$env:README_SCREENSHOTS = "1"
$env:PW_CHANNEL = "msedge"
npx playwright test readme-screenshots --workers=1 --retries=0
Remove-Item Env:README_SCREENSHOTS
```

脚本会启动或复用 `127.0.0.1:1430` 的 E2E 服务，以 1280 × 800 视口生成图片。机器需要已安装 Edge；如果使用 Chrome，可将 `PW_CHANNEL` 改为 `chrome`。

演示数据和截图步骤见 [readme-screenshots.spec.ts](../../e2e/specs/readme-screenshots.spec.ts)。普通测试运行会跳过截图生成，只有显式设置 `README_SCREENSHOTS=1` 才会覆盖图片。
