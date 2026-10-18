# Antigravity Helper for VS Code

[English](https://github.com/bennyhuo/antigravity-helper/blob/main/README.md) | **简体中文**

[![VS Code Marketplace](https://badgen.net/vs-marketplace/v/bennyhuo.antigravity-helper)](https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper)
[![GitHub Repository](https://img.shields.io/badge/GitHub-bennyhuo%2Fantigravity--helper-181717?logo=github)](https://github.com/bennyhuo/antigravity-helper)

补齐 Google Antigravity VS Code 插件（`google.google-antigravity`）缺失的文件与代码片段快捷添加功能：**选中文本悬浮 `Chat` 按钮**、**免按 `Shift` 直接拖拽文件到聊天框**、以及 **资源管理器 / 标签页 / 编辑器右键菜单添加上下文**。

- **VS Code 插件市场**：[https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper](https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper)
- **GitHub 仓库**：[https://github.com/bennyhuo/antigravity-helper](https://github.com/bennyhuo/antigravity-helper)

---

## 核心功能

1. **选中文本悬浮 `Chat` 按钮**
   - 在编辑器中通过鼠标拖拽、双击或键盘选中任意代码片段后，选区附近会自动弹出 **`Chat`** 悬浮按钮。
   - 点击 **`Chat`** 即可将选中的代码行范围直接添加到 Antigravity 聊天输入框、自动聚焦输入框并取消当前选区。

2. **直接将文件 / 文件夹 / 标签页 / 选中代码拖拽到聊天窗口（免按 `Shift`）**
   - 支持直接从 **VS Code 资源管理器（含多选）**、**编辑器标签页**、**大纲（Outline）符号**、**编辑器选中的代码** 或 **系统访达（Finder）** 将文件/目录拖入 Antigravity 聊天面板（**全程无需按住 `Shift` 键**）。
   - 当 Google Antigravity 插件自动更新后，本插件会自动检测并重新注入拖拽支持。

3. **资源管理器右键添加文件 / 文件夹到聊天窗口（`explorer/context`）**
   - 在左侧资源管理器（Explorer）中右键任意**文件**或**文件夹**（支持按住 `Cmd` / `Shift` **多选**多个文件或目录），点击 **「添加到 Antigravity 聊天窗口」**（`Add to Antigravity Chat`），即可直接作为 `@file` / `@directory` 上下文添加到 Antigravity 输入框并自动聚焦。

4. **编辑器标签页右键添加文件到聊天窗口（`editor/title/context`）**
   - 在编辑器顶部的 Tab 标签页上右键，点击 **「添加到 Antigravity 聊天窗口」**，即可将该文件添加到聊天窗口。

5. **选中文件内容右键添加到聊天窗口（`editor/context`）**
   - 在编辑器中选中代码片段（支持单选及多光标多选），右键点击 **「将选中内容添加到 Antigravity 聊天窗口」**（`Add Selection to Antigravity Chat`），即可将精确的文件行范围添加到聊天窗口。
   - 在编辑器任意位置右键，也可以点击 **「将当前文件添加到 Antigravity 聊天窗口」**（`Add Current File to Antigravity Chat`）添加整个文件。

---

## 命令列表（Command Palette）

- `Antigravity: Add Selection to Antigravity Chat`（将选中内容添加到 Antigravity 聊天窗口）
- `Antigravity: Add Current File to Antigravity Chat`（将当前文件添加到 Antigravity 聊天窗口）
- `Antigravity: Enable File Drag-and-Drop to Antigravity Chat`（启用拖拽文件到 Antigravity 聊天窗口）
- `Antigravity: Disable File Drag-and-Drop to Antigravity Chat (Restore Original)`（禁用拖拽文件到 Antigravity 聊天窗口并恢复原版文件）

---

## 安装方式

### 从 VS Code 插件市场安装
在 VS Code 扩展面板搜索 **`Antigravity Helper`**（`bennyhuo.antigravity-helper`），或访问 [VS Code 插件市场页面](https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper)，也可以通过命令行安装：

```bash
code --install-extension bennyhuo.antigravity-helper
```

### 本地打包与安装

```bash
npm run package
code --install-extension antigravity-helper-0.1.5.vsix
```

---

## 开源协议

[MIT](./LICENSE) © [Benny Huo](https://github.com/bennyhuo)
