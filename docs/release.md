# GitHub CI 打包

## 一条命令发起打包

只需先提交业务代码，然后在 `master` 分支执行：

```powershell
npm run release
```

自动将修订号加一（例如 `1.0.0 → 1.0.1`），同步五个版本文件，创建版本提交和 `v1.0.1` 标签，将 master 与标签一起推送到 origin，触发所有平台打包。不需要指定版本。

- `npm run release -- --dry-run`：检查并显示下一版本，不修改文件、不提交、不推送。
- `npm run build:installer`：本地打包前也自动递增修订号，版本修改留在工作区，不自动提交。
- GitHub CI 使用提交中的版本；各平台任务和失败重跑不重复递增。
- 推送失败时保留版本提交和标签，按命令输出重试推送，避免再次递增。
- 本地构建失败仍保留已分配版本，下一次打包继续加一，版本号允许跳号。

版本以 `package.json` 为准，自动同步应用配置与锁文件；内部 crate 保持独立版本。`version:set` 只用于需要手动调整主版本、次版本的特殊情况。

## 工作流

工作流：`.github/workflows/release.yml`。

- Actions → Release packages → Run workflow：构建当前分支，安装包保存在各平台的 Artifacts 中。
- 推送 `v*` 标签：所有平台构建成功后，汇总为同名 GitHub Release 草稿，检查安装包后再发布。
- Windows x64：NSIS `.exe`。
- macOS Apple Silicon / Intel：各自的 `.dmg`。
- Linux x64：`.deb` 和 `.AppImage`。

macOS 的 Rust 编译与 DMG 封装分开执行。DMG 封装开启详细日志，失败时最多尝试三次，重试不重新编译；持续失败仍会使任务失败，具体原因见 `Bundle macOS disk image` 步骤的脚本输出。

修改工作流后，可在 Actions 手动选择 `master` 验证。旧任务的 Re-run 仍使用原提交中的工作流，不会应用新的修复。

当前未配置 Windows 代码签名、Apple 签名或公证。macOS / Linux 首次 CI 构建和原生功能仍需验证；网络选路等 Windows 专属能力不代表已完成跨平台适配。不要将构建成功等同于全部功能可用。

日常发布无需手动修改版本文件。GitHub 手动构建使用选定提交的版本，只生成构建产物，不自动创建发布标签。
