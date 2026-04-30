# wmux

wmux 是一个面向 AI coding agent 工作流的桌面终端复刻项目，目标参考 cmux 的核心体验：垂直工作区、分屏面板、终端/浏览器 surface、通知状态、命令面板、CLI/socket 自动化与可恢复布局。

本仓库当前先沉淀可落地方案，不追求 1:1 复制品牌和视觉，而追求达到 cmux 80%-90% 的能力覆盖。

## 文档索引

- [需求文档](docs/01-product-requirements.md)
- [cmux 能力拆解](docs/02-cmux-capability-map.md)
- [技术架构](docs/03-architecture.md)
- [UI 设计与 gpt-image-2 资产流程](docs/04-ui-design-gpt-image-2.md)
- [CLI 与 Socket API 设计](docs/05-cli-socket-api.md)
- [数据模型与配置格式](docs/06-data-model-and-config.md)
- [实施路线图](docs/07-implementation-roadmap.md)
- [验收清单](docs/08-acceptance-checklist.md)

## 推荐路线

第一阶段不要直接做原生 Swift + libghostty。为了从零开始快速落地，建议采用：

- 桌面壳：Electron
- UI：React + TypeScript + Zustand/Jotai
- 终端：node-pty + xterm.js + WebGL renderer
- 浏览器：Electron BrowserView/WebContentsView
- 自动化：本地 Unix domain socket / Windows named pipe + CLI
- 数据：SQLite + JSON 配置
- 打包：electron-builder

这条路线牺牲一部分原生轻量感，但能最快验证分屏、终端、多 surface、内置浏览器、CLI 控制和 agent 通知这些核心价值。等产品跑通后，再评估 macOS 原生重写或局部替换为 Swift/libghostty。

