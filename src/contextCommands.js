// @ts-check
'use strict';

const vscode = require('vscode');

/** @type {Set<string>} */
const processedDropIds = new Set();

/**
 * Snapshot of the most recent non-empty text selection in a code editor,
 * used as a fallback when clicking a floating widget button.
 * @type {{ items: Array<{ type: string, uri: string, range: { startLineNumber: number, endLineNumber: number } }>, timestamp: number } | null}
 */
let lastSelectionSnapshot = null;

/**
 * Record the current non-empty selection from a text editor.
 * @param {vscode.TextEditor | undefined} editor
 */
function recordSelectionSnapshot(editor) {
  if (!editor || !editor.document || !editor.document.uri) {
    return;
  }
  const scheme = editor.document.uri.scheme;
  if (scheme === 'output' || scheme === 'debug' || scheme === 'vscode-terminal') {
    return;
  }
  const nonEmptySelections = (editor.selections || [editor.selection]).filter(
    (sel) => sel && !sel.isEmpty
  );
  if (nonEmptySelections.length === 0) {
    return;
  }
  const uriStr = editor.document.uri.toString();
  const items = nonEmptySelections.map((sel) => {
    const startLineNumber = sel.start.line + 1;
    const endLineNumber =
      sel.end.character === 0 && sel.end.line > sel.start.line
        ? sel.end.line
        : sel.end.line + 1;
    return {
      type: 'file',
      uri: uriStr,
      range: {
        startLineNumber,
        endLineNumber
      }
    };
  });
  lastSelectionSnapshot = {
    items,
    timestamp: Date.now()
  };
}

/**
 * Resolve the active URI from the active text editor or active tab.
 * @returns {vscode.Uri | undefined}
 */
function getActiveResourceUri() {
  if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) {
    return vscode.window.activeTextEditor.document.uri;
  }
  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  if (activeTab && activeTab.input && typeof activeTab.input === 'object') {
    const input = /** @type {any} */ (activeTab.input);
    if (input.uri instanceof vscode.Uri) {
      return input.uri;
    }
    if (input.modified instanceof vscode.Uri) {
      return input.modified;
    }
  }
  return undefined;
}

/**
 * Focus the Antigravity chat input box.
 */
async function focusAntigravityChat() {
  try {
    await vscode.commands.executeCommand('antigravity.toggleChatFocus', 'focus');
  } catch (_) {
    try {
      await vscode.commands.executeCommand('antigravity.panel.focus');
    } catch (__) {
      // Ignore focus errors if panel command is unavailable
    }
  }
}

/**
 * Send context items to Antigravity Chat and focus the input box.
 * @param {Array<any>} items
 */
async function sendContextToAntigravity(items) {
  if (!items || items.length === 0) {
    return;
  }
  try {
    await vscode.commands.executeCommand('antigravity.addContext', items);
    await focusAntigravityChat();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `Antigravity Helper: Failed to add context to Antigravity Chat (${message}). Please make sure the Google Antigravity extension is installed and enabled.`
    );
  }
}

/**
 * Command handler for `antigravity-helper.addFileToChat`
 * Invoked from Explorer context menu (single or multi-select) or Editor tab title context menu.
 * @param {vscode.Uri | undefined} clickedUri
 * @param {vscode.Uri[] | undefined} selectedUris
 */
async function addFileToChat(clickedUri, selectedUris) {
  /** @type {vscode.Uri[]} */
  let targetUris = [];

  if (Array.isArray(selectedUris) && selectedUris.length > 0) {
    targetUris = selectedUris.filter((u) => u instanceof vscode.Uri);
  } else if (clickedUri instanceof vscode.Uri) {
    targetUris = [clickedUri];
  } else {
    const activeUri = getActiveResourceUri();
    if (activeUri) {
      targetUris = [activeUri];
    }
  }

  if (targetUris.length === 0) {
    vscode.window.showWarningMessage('Antigravity Helper: No file or folder selected to add to chat.');
    return;
  }

  const seen = new Set();
  const items = [];
  for (const uri of targetUris) {
    const uriStr = uri.toString();
    if (!seen.has(uriStr)) {
      seen.add(uriStr);
      items.push({
        type: 'file',
        uri: uriStr
      });
    }
  }

  await sendContextToAntigravity(items);
}

/**
 * Command handler for `antigravity-helper.addCurrentFileToChat`
 * Invoked from Editor right-click context menu or Command Palette.
 */
async function addCurrentFileToChat() {
  const activeUri = getActiveResourceUri();
  if (!activeUri) {
    vscode.window.showWarningMessage('Antigravity Helper: No active file to add to chat.');
    return;
  }

  await sendContextToAntigravity([
    {
      type: 'file',
      uri: activeUri.toString()
    }
  ]);
}

/**
 * Collapse non-empty selections in the active / visible text editors so that
 * after adding code to Antigravity Chat, the highlight and floating popup are dismissed.
 * @param {vscode.TextEditor | undefined} [preferredEditor]
 */
function clearEditorSelections(preferredEditor) {
  /** @type {Set<vscode.TextEditor>} */
  const editors = new Set();
  if (preferredEditor) {
    editors.add(preferredEditor);
  }
  if (vscode.window.activeTextEditor) {
    editors.add(vscode.window.activeTextEditor);
  }
  for (const vis of vscode.window.visibleTextEditors || []) {
    editors.add(vis);
  }
  for (const ed of editors) {
    try {
      if (ed && ed.selection) {
        const hasNonEmpty =
          !ed.selection.isEmpty ||
          (Array.isArray(ed.selections) && ed.selections.some((s) => s && !s.isEmpty));
        if (hasNonEmpty) {
          const pos = ed.selection.active;
          ed.selection = new vscode.Selection(pos, pos);
        }
      }
    } catch (_) {}
  }
  lastSelectionSnapshot = null;
}

/**
 * Command handler for `antigravity-helper.addSelectionToChat`
 * Invoked from Editor right-click context menu or floating `Chat` button when text is selected.
 */
async function addSelectionToChat() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document) {
    const nonEmptySelections = (editor.selections || [editor.selection]).filter(
      (sel) => sel && !sel.isEmpty
    );

    if (nonEmptySelections.length > 0) {
      const uriStr = editor.document.uri.toString();
      const items = nonEmptySelections.map((sel) => {
        const startLineNumber = sel.start.line + 1;
        // If selection ends at column 0 of a subsequent line, don't include that trailing empty line
        const endLineNumber =
          sel.end.character === 0 && sel.end.line > sel.start.line
            ? sel.end.line
            : sel.end.line + 1;

        return {
          type: 'file',
          uri: uriStr,
          range: {
            startLineNumber,
            endLineNumber
          }
        };
      });

      clearEditorSelections(editor);
      await sendContextToAntigravity(items);
      return;
    }
  }

  // Fallback to recent selection snapshot (e.g. if clicking floating widget unfocused the editor)
  if (lastSelectionSnapshot && Date.now() - lastSelectionSnapshot.timestamp < 15000) {
    const items = lastSelectionSnapshot.items;
    clearEditorSelections(editor);
    await sendContextToAntigravity(items);
    return;
  }

  if (!editor || !editor.document) {
    vscode.window.showWarningMessage('Antigravity Helper: No active text editor.');
    return;
  }

  // Fallback to native insertSnippet or current file if nothing is selected
  try {
    await vscode.commands.executeCommand('antigravity.insertSnippet');
  } catch (_) {
    await addCurrentFileToChat();
  }
}

/**
 * Handle items dropped onto the Antigravity Chat webview or floating selection button clicks.
 * Deduplicates by `dropId` so runtime hooks and file patches never double-process an action.
 * @param {{ type?: string, dropId?: string, items?: Array<{ type: string, uri: string, range?: { startLineNumber: number, endLineNumber: number } }>, text?: string }} msg
 */
async function handleWebviewDrop(msg) {
  if (!msg || typeof msg !== 'object') {
    return;
  }

  if (msg.dropId) {
    if (processedDropIds.has(msg.dropId)) {
      return;
    }
    processedDropIds.add(msg.dropId);
    if (processedDropIds.size > 200) {
      const oldest = processedDropIds.values().next().value;
      if (oldest) {
        processedDropIds.delete(oldest);
      }
    }
  }

  if (msg.type === 'agyHelper.addSelection') {
    await addSelectionToChat();
    return;
  }

  if (Array.isArray(msg.items) && msg.items.length > 0) {
    await sendContextToAntigravity(msg.items);
    return;
  }

  if (typeof msg.text === 'string' && msg.text.trim()) {
    const rawText = msg.text;
    const editor = vscode.window.activeTextEditor;

    // Check if the user dragged the currently selected text from the active editor
    if (editor && editor.document && !editor.selection.isEmpty) {
      const selectedText = editor.document.getText(editor.selection);
      const normSelected = selectedText.replace(/\r\n/g, '\n').trim();
      const normDropped = rawText.replace(/\r\n/g, '\n').trim();
      if (normSelected && normSelected === normDropped) {
        const sel = editor.selection;
        const startLineNumber = sel.start.line + 1;
        const endLineNumber =
          sel.end.character === 0 && sel.end.line > sel.start.line
            ? sel.end.line
            : sel.end.line + 1;

        await sendContextToAntigravity([
          {
            type: 'file',
            uri: editor.document.uri.toString(),
            range: {
              startLineNumber,
              endLineNumber
            }
          }
        ]);
        return;
      }
    }

    // Check if the dropped text is a file:// URI or an absolute file path
    const trimmed = rawText.trim();
    if (trimmed.startsWith('file://')) {
      await sendContextToAntigravity([{ type: 'file', uri: trimmed }]);
      return;
    }
    if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
      try {
        const uri = vscode.Uri.file(trimmed);
        await vscode.workspace.fs.stat(uri);
        await sendContextToAntigravity([{ type: 'file', uri: uri.toString() }]);
        return;
      } catch (_) {
        // Not an existing file path, treat as plain text
      }
    }

    await sendContextToAntigravity([rawText]);
  }
}

module.exports = {
  addFileToChat,
  addCurrentFileToChat,
  addSelectionToChat,
  handleWebviewDrop,
  recordSelectionSnapshot,
  processedDropIds
};
