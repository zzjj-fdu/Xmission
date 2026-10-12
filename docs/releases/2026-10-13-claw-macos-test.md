# Xmission · OpenClaw 配置测试版（macOS）

本测试包最低支持 macOS 13.5，Universal DMG 同时包含 Apple Silicon 与 Intel 两种架构。

OpenClaw 配置新增阶段进度、中途取消与重试；运行环境自动在后台准备，无需预先安装 Node。取消后的不完整解压可在重试时修复。

窗口/桌面图标依附与开机启动仍为 Windows 功能。Mac 使用 ad-hoc 临时签名，尚未通过 Apple Developer ID 签名和公证。完整 Mac 交互仍需真实设备验收。

构建附件生成前会验证两种架构、签名、DMG 完整性、托管运行环境，以及空数据启动。
