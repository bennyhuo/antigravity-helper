// @ts-check
'use strict';

const {
  installRuntimeVscodeHook,
  ensureDragAndDropEnabled,
  disableDragAndDrop
} = require('./dragAndDropBridge');

// Install the runtime Module._load hook as early as possible
installRuntimeVscodeHook();

const vscode = require('vscode');
const {
  addFileToChat,
  addCurrentFileToChat,
  addSelectionToChat,
  handleWebviewDrop,
  recordSelectionSnapshot,
  processedDropIds
} = require('./contextCommands');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Share deduplication set across the Extension Host
  globalThis.__agyHelperProcessedDrops = processedDropIds;

  if (vscode.window.activeTextEditor) {
    recordSelectionSnapshot(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      recordSelectionSnapshot(e.textEditor);
    }),
    vscode.commands.registerCommand('antigravity-helper.addFileToChat', addFileToChat),
    vscode.commands.registerCommand('antigravity-helper.addSelectionToChat', addSelectionToChat),
    vscode.commands.registerCommand('antigravity-helper.addCurrentFileToChat', addCurrentFileToChat),
    vscode.commands.registerCommand('antigravity-helper.handleWebviewDrop', handleWebviewDrop),
    vscode.commands.registerCommand('antigravity-helper.enableDragAndDrop', () =>
      ensureDragAndDropEnabled({ silent: false })
    ),
    vscode.commands.registerCommand('antigravity-helper.disableDragAndDrop', disableDragAndDrop)
  );

  // Automatically ensure drag-and-drop bridge is applied if enabled in settings
  const config = vscode.workspace.getConfiguration('antigravityHelper');
  if (config.get('autoEnableDragAndDrop', true)) {
    ensureDragAndDropEnabled({ silent: true });
  }

  // Re-check if extensions change (e.g., Google Antigravity updates to a new version)
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      const currentConfig = vscode.workspace.getConfiguration('antigravityHelper');
      if (currentConfig.get('autoEnableDragAndDrop', true)) {
        ensureDragAndDropEnabled({ silent: true });
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
