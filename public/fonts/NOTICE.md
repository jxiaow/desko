# HarmonyOS Sans SC（内置子集）

- 文件：`harmonyos-sans-sc.woff2`（2.74 MB，可变字重 wght 40–900，7855 字形）
- 来源：华为开发者联盟官方字体包 `HarmonyOS Sans`（AUR `ttf-harmonyos-sans` 2026.06.12 同一 CDN 直链），
  原包 `HarmonyOS_Sans_SC.ttf`（20,617,156 B）SHA256
  `2d129ad1b7f8193b9b7be54d126d79b6d02170dd166422bea18d84b2ce55a2aa`
- 处理：`fontTools.subset` 按 GB2312 全集 + ASCII + 常用排版符号裁剪，保留 wght 变轴，转 woff2。
  表外生僻字自动回退系统字体。再生成（chars.txt 为字符清单，同法穷举 GB2312 双字节可得）：

  ```bash
  pip install fonttools brotli
  python -m fontTools.subset HarmonyOS_Sans_SC.ttf --text-file=chars.txt \
    --output-file=harmonyos-sans-sc.woff2 --flavor=woff2 --layout-features='*'
  ```
- 许可：HarmonyOS Sans 字体许可证（华为自定义许可，允许免费商用，含嵌入文档/应用分发）。
  官方条款与下载：https://developer.huawei.com/consumer/cn/design/resource/
  字体文件内嵌版权声明：`Copyright 2021-2024 Huawei Device Co., Ltd. All Rights Reserved.`
