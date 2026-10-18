# Antigravity Helper for VS Code

**English** | [简体中文](https://github.com/bennyhuo/antigravity-helper/blob/main/README.zh-CN.md)

[![VS Code Marketplace](https://badgen.net/vs-marketplace/v/bennyhuo.antigravity-helper)](https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper)
[![GitHub Repository](https://img.shields.io/badge/GitHub-bennyhuo%2Fantigravity--helper-181717?logo=github)](https://github.com/bennyhuo/antigravity-helper)

Enhance the official Google Antigravity VS Code extension (`google.google-antigravity`) with missing context shortcuts: **shift-free file drag-and-drop**, **Explorer & Editor Tab right-click context menus**, and a **floating `Chat` button on text selection**.

- **VS Code Marketplace**: [https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper](https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper)
- **GitHub Repository**: [https://github.com/bennyhuo/antigravity-helper](https://github.com/bennyhuo/antigravity-helper)

---

## Features

1. **Floating `Chat` Button on Text Selection**
   - Select any code or text in the editor (via mouse drag, double-click, or keyboard selection) to display a floating **`Chat`** button right next to your selection.
   - Click **`Chat`** to immediately add the selected file line range to the Antigravity Chat input box, focus the chat input, and clear the selection.

2. **Drag and Drop Files / Folders / Tabs / Selections to Chat (No `Shift` Required)**
   - Drag and drop files or folders from the **VS Code Explorer (including multi-select)**, **Editor Tabs**, **Outline symbols**, **selected editor code**, or **macOS Finder / OS File Explorer** directly into the Antigravity Chat window **without holding `Shift`**.
   - Automatically detects and re-applies the drag-and-drop bridge whenever the Google Antigravity extension updates.

3. **Explorer Context Menu (`explorer/context`)**
   - Right-click any **file** or **folder** (supports multi-selection with `Cmd` / `Ctrl` / `Shift`) in the Explorer and select **`Add to Antigravity Chat`** to attach them as `@file` / `@directory` context in the chat input.

4. **Editor Tab Context Menu (`editor/title/context`)**
   - Right-click any Editor Tab and select **`Add to Antigravity Chat`** to attach that file to the Antigravity Chat window.

5. **Editor Selection & File Context Menu (`editor/context`)**
   - Select code in the editor (single or multi-cursor) and right-click **`Add Selection to Antigravity Chat`** to attach the exact file line range.
   - Right-click anywhere in an editor and select **`Add Current File to Antigravity Chat`** to attach the entire active file.

---

## Commands (Command Palette)

- `Antigravity: Add Selection to Antigravity Chat`
- `Antigravity: Add Current File to Antigravity Chat`
- `Antigravity: Enable File Drag-and-Drop to Antigravity Chat`
- `Antigravity: Disable File Drag-and-Drop to Antigravity Chat (Restore Original)`

---

## Installation

### From VS Code Marketplace
Search for **`Antigravity Helper`** (`bennyhuo.antigravity-helper`) in the VS Code Extensions view, or install from the [VS Code Marketplace page](https://marketplace.visualstudio.com/items?itemName=bennyhuo.antigravity-helper):

```bash
code --install-extension bennyhuo.antigravity-helper
```

### Build from Source

```bash
npm run package
code --install-extension antigravity-helper-0.1.5.vsix
```

---

## License

[MIT](./LICENSE) © [Benny Huo](https://github.com/bennyhuo)
