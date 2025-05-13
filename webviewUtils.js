const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * Creates and shows a new webview panel.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} viewType The identifier for the webview type.
 * @param {string} title The title of the panel.
 * @param {string} htmlFileName The name of the HTML file in the 'media' folder.
 * @returns {vscode.WebviewPanel} The created webview panel.
 */
function createWebviewPanel(context, viewType, title, htmlFileName) {
  const panel = vscode.window.createWebviewPanel(
    viewType,
    title,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
    }
  );

  const webviewContentPath = vscode.Uri.file(path.join(context.extensionPath, 'media', htmlFileName));
  panel.webview.html = fs.readFileSync(webviewContentPath.fsPath, 'utf8');

  return panel;
}

module.exports = {
  createWebviewPanel
}; 