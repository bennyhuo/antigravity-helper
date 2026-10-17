// @ts-check
'use strict';

const { restoreAllPatchesSync } = require('./dragAndDropBridge');

try {
  const res = restoreAllPatchesSync();
  if (res.restored) {
    console.log('Antigravity Helper: Successfully restored original files.');
  }
} catch (_) {
  // Ignore errors during extension uninstall hook
}
