const vscode = require('vscode');
const path = require('path');
const parseGitConfig = require('parse-git-config').sync;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const showLinksDisposable = vscode.commands.registerCommand(
    'diagram-generator.showLinks',
    async () => {
      // Create and show a webview panel
      const panel = vscode.window.createWebviewPanel(
        'diagramLinks',
        'Java Source Links',
        vscode.ViewColumn.One,
        {
          enableScripts: true, // Enable scripts for command execution
          enableCommandUris: true, // Explicitly enable command URIs
          localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))] // Example, adjust if not using media folder
        }
      );

      // Discover Java files in workspace
      const uris = await vscode.workspace.findFiles(
        '**/*.java',
      );                                                                   

      // Parse .git/config for remote.origin.url
      let repoUrl = '';
      try {
        const cfg = parseGitConfig();                                   
        const raw = cfg.remote?.origin?.url;
        if (raw) {
          repoUrl = toHTTPS(raw);                                       
        }
      } catch (err) {
        console.error('Git parse error:', err);
      }

      // Build HTML list of links
      let list = '<ul>';
      const branch = 'main'; // adjust or derive dynamically if needed

      for (const uri of uris) {
        const rel = vscode.workspace.asRelativePath(uri);               
        const openCmd = `command:vscode.open?${encodeURIComponent(
          JSON.stringify([uri])
        )}`;

        list += `<li>
          <a href="${openCmd}">${rel}</a>
          ${repoUrl ? ` — <a href="${repoUrl}/blob/${branch}/${rel}" target="_blank">GitHub</a>` : ''}
        </li>`;
      }

      list += '</ul>';
      panel.webview.html = getWebviewContent(list);
    }
  );

  const generateDiagramDisposable = vscode.commands.registerCommand(
    'diagram-generator.generateDiagram',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor found. Please open a Java file.');
        return;
      }
      if (editor.document.languageId !== 'java') {
        vscode.window.showErrorMessage('This command can only be run on Java files.');
        return;
      }

      const uri = editor.document.uri;
      const position = editor.selection.active;

      // Create and show a webview panel
      const panel = vscode.window.createWebviewPanel(
        'generateDiagram', // Identifies the type of the webview. Used internally
        'Generate Mermaid Diagram', // Title of the panel displayed to the user
        vscode.ViewColumn.One, // Editor column to show the new webview panel in.
        {
          // Enable scripts in the webview
          enableScripts: true,
          localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
        }
      );

      // Set the HTML content
      panel.webview.html = getWebviewContentForDiagram();

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(
        async message => {
          switch (message.command) {
            case 'getCallHierarchyItems':
              try {
                const items = /** @type {vscode.CallHierarchyItem[]} */ (
                  await vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, position)
                );
                panel.webview.postMessage({ command: 'callHierarchyItemsData', payload: items });
              } catch (e) {
                console.error('Error preparing call hierarchy:', e);
                vscode.window.showErrorMessage('Error fetching call hierarchy items.');
                panel.webview.postMessage({ command: 'callHierarchyItemsError', payload: 'Error fetching call hierarchy items. Check the console for details.' });
              }
              return;
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(showLinksDisposable, generateDiagramDisposable);
}
exports.activate = activate;

// Renamed getHtml to getWebviewContent to avoid confusion and for clarity
function getWebviewContent(body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src vscode-resource: 'unsafe-inline'; style-src vscode-resource: 'unsafe-inline'; img-src vscode-resource: data:;">
    <title>Generate Mermaid Diagram</title>
</head>
<body>${body}</body>
</html>`;
}

function getWebviewContentForDiagram() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src vscode-resource: 'unsafe-inline' 'self'; style-src vscode-resource: 'unsafe-inline'; img-src vscode-resource: data:;">
    <title>Generate Mermaid Diagram</title>
    <style>
      .spinner {
        display: inline-block;
        border: 3px solid #f3f3f3; /* Light grey */
        border-top: 3px solid #3498db; /* Blue */
        border-radius: 50%;
        width: 16px;
        height: 16px;
        animation: spin 1s linear infinite;
        margin-left: 10px;
        vertical-align: middle;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
    <script>
      const vscodeApi = acquireVsCodeApi();

      function showCallHierarchyItems() {
        const spinner = document.getElementById('loadingSpinner');
        spinner.style.display = 'inline-block'; // Show spinner
        vscodeApi.postMessage({ command: 'getCallHierarchyItems' });
      }

      function showRecursiveOutgoingCalls() {
        const spinnerRecursive = document.getElementById('loadingSpinnerRecursive');
        spinnerRecursive.style.display = 'inline-block'; // Show spinner
        // vscodeApi.postMessage({ command: 'getRecursiveOutgoingCalls' }); // Logic to be added later
      }

      window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        const textArea = document.getElementById('callHierarchyItems');
        const spinner = document.getElementById('loadingSpinner');
        const textAreaRecursive = document.getElementById('recursiveOutgoingCalls');
        const spinnerRecursive = document.getElementById('loadingSpinnerRecursive');
        
        if (spinner) spinner.style.display = 'none'; // Hide spinner
        if (spinnerRecursive) spinnerRecursive.style.display = 'none'; // Hide spinner for recursive calls

        switch (message.command) {
          case 'callHierarchyItemsData':
            textArea.value = JSON.stringify(message.payload, null, 2);
            break;
          case 'callHierarchyItemsError':
            textArea.value = message.payload;
            break;
          // Cases for recursive outgoing calls to be added later
        }
      });
    </script>
</head>
<body>
    <h1>Generate Mermaid Diagram</h1>
    <button onclick="showCallHierarchyItems()">Show Call Hierarchy Items</button>
    <div id="loadingSpinner" class="spinner" style="display:none;"></div>
    <br>
    <textarea id="callHierarchyItems" style="width:100%; height:200px;" readonly></textarea>
    <br><br>
    <button onclick="showRecursiveOutgoingCalls()">Show Recursive Outgoing Calls</button>
    <div id="loadingSpinnerRecursive" class="spinner" style="display:none;"></div>
    <br>
    <textarea id="recursiveOutgoingCalls" style="width:100%; height:200px;" readonly></textarea>
</body>
</html>`;
}

/**
 * Convert SSH or Git URLs to HTTPS
 * @param {string} url
 */
function toHTTPS(url) {
  if (url.startsWith('git@')) {
    const [, hostPath] = url.split('@');
    const [host, repo] = hostPath.split(':');
    return `https://${host}/${repo.replace(/\\.git$/, '')}`;
  }
  return url.replace(/\\.git$/, '');
}

function deactivate() {}

module.exports = { activate, deactivate, getWebviewContent };
