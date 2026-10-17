// @ts-check
'use strict';

const fs = require('fs');
const vscode = require('vscode');
const {
  STATE_FILE_PATH,
  ensureDragAndDropEnabled,
  disableDragAndDrop,
  cleanupLegacyAntigravityPatches
} = require('./dragAndDropBridge');
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

  // Automatically ensure workbench overlay is applied if enabled in settings
  const config = vscode.workspace.getConfiguration('antigravityHelper');
  if (config.get('autoEnableDragAndDrop', true)) {
    ensureDragAndDropEnabled({ silent: true });
  } else {
    vscode.commands.executeCommand('setContext', 'antigravityHelper.active', false);
    cleanupLegacyAntigravityPatches();
  }

  // React to configuration changes in real time
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravityHelper.autoEnableDragAndDrop')) {
        const currentConfig = vscode.workspace.getConfiguration('antigravityHelper');
        if (currentConfig.get('autoEnableDragAndDrop', true)) {
          ensureDragAndDropEnabled({ silent: true });
        } else {
          vscode.commands.executeCommand('setContext', 'antigravityHelper.active', false);
        }
      }
    })
  );

  // Watch the state file so if `vscode:uninstall` runs while the window is still open,
  // we immediately set `antigravityHelper.active` to false even before window reload.
  const stateWatchListener = (curr) => {
    if (curr.nlink === 0) {
      vscode.commands.executeCommand('setContext', 'antigravityHelper.active', false);
    }
  };
  fs.watchFile(STATE_FILE_PATH, { persistent: false, interval: 1000 }, stateWatchListener);
  context.subscriptions.push({
    dispose() {
      fs.unwatchFile(STATE_FILE_PATH, stateWatchListener);
    }
  });
}

function deactivate() {
  try {
    vscode.commands.executeCommand('setContext', 'antigravityHelper.active', false);
  } catch (_) {}
}

module.exports = {
  activate,
  deactivate
};
