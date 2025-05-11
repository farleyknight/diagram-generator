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
            case 'getRecursiveOutgoingCalls':
              try {
                const initialItems = /** @type {vscode.CallHierarchyItem[]} */ (
                  await vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, position)
                );
                if (!initialItems || initialItems.length === 0) {
                  panel.webview.postMessage({ command: 'recursiveOutgoingCallsError', payload: 'Could not prepare initial call hierarchy item.' });
                  return;
                }
                // Assuming we start with the first item (e.g., the method under cursor)
                const rootItem = initialItems[0];
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                  panel.webview.postMessage({ command: 'recursiveOutgoingCallsError', payload: 'No workspace folder found.' });
                  return;
                }
                const workspacePaths = new Set(workspaceFolders.map(folder => folder.uri.fsPath));
                const processedItems = new Set();
                const hierarchyData = await buildHierarchyRecursively(rootItem, workspacePaths, processedItems, panel);
                panel.webview.postMessage({ command: 'recursiveOutgoingCallsData', payload: hierarchyData });
              } catch (e) {
                console.error('Error building recursive call hierarchy:', e);
                vscode.window.showErrorMessage('Error building recursive call hierarchy.');
                panel.webview.postMessage({ command: 'recursiveOutgoingCallsError', payload: 'Error building recursive call hierarchy. Check the console for details.' });
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
        vscodeApi.postMessage({ command: 'getRecursiveOutgoingCalls' });
      }

      window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        const textArea = document.getElementById('callHierarchyItems');
        const spinner = document.getElementById('loadingSpinner');
        const textAreaRecursive = document.getElementById('recursiveOutgoingCalls');
        const spinnerRecursive = document.getElementById('loadingSpinnerRecursive');
        
        if (message.command === 'callHierarchyItemsData' || message.command === 'callHierarchyItemsError') {
            if (spinner) spinner.style.display = 'none'; // Hide spinner for call hierarchy
        }
        if (message.command === 'recursiveOutgoingCallsData' || message.command === 'recursiveOutgoingCallsError') {
            if (spinnerRecursive) spinnerRecursive.style.display = 'none'; // Hide spinner for recursive calls
        }

        switch (message.command) {
          case 'callHierarchyItemsData':
            textArea.value = JSON.stringify(message.payload, null, 2);
            break;
          case 'callHierarchyItemsError':
            textArea.value = message.payload;
            break;
          case 'recursiveOutgoingCallsData':
            textAreaRecursive.value = JSON.stringify(message.payload, null, 2);
            break;
          case 'recursiveOutgoingCallsError':
            textAreaRecursive.value = message.payload;
            break;
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

/**
 * Gets class information including annotations using VS Code's symbol provider
 * @param {vscode.Uri} uri Document URI
 * @param {string} className Name of the class to find
 * @returns {Promise<{annotations: string, className: string, range: vscode.Range | null}>}
 */
async function getClassInformation(uri, className) {
	if (className === 'com') throw new Error('Invalid class name: com');

  try {
    const symbols = /** @type {vscode.DocumentSymbol[]} */ (await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      uri
    ));

    if (!symbols) return { annotations: '', className, range: null };

    // Find the class symbol
    const classSymbol = symbols.find(s =>
      s.kind === vscode.SymbolKind.Class &&
      s.name === className
    );

    if (!classSymbol) return { annotations: '', className, range: null };

    const document = await vscode.workspace.openTextDocument(uri);

    // Get the full range of possible annotation lines before the class
    const possibleAnnotationRange = new vscode.Range(
      Math.max(0, classSymbol.range.start.line - 20), // Look up to 20 lines before class
      0,
      classSymbol.range.start.line + 3, // Look 3 lines after class
      document.lineAt(classSymbol.range.start.line).text.length
    );

    // Get all text in the possible annotation range
    const textBeforeClass = document.getText(possibleAnnotationRange);

    // Process the text to find annotations
    const annotations = textBeforeClass
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Keep annotations and any metadata like access modifiers
        if (line.startsWith('@')) return true;

        // Stop at any non-annotation, non-modifier line
        if (line !== '' &&
            !line.startsWith('//') &&
            !line.match(/^(public|private|protected|abstract|final|static)\s/)) {
          return false;
        }
        return line.startsWith('public') ||
               line.startsWith('private') ||
               line.startsWith('protected');
      })
      .join('\n');

    return {
      annotations,
      className: classSymbol.name,
      range: classSymbol.range
    };
  } catch (error) {
    console.error('Error getting class information:', error);
    return { annotations: '', className, range: null };
  }
}

/**
 * Recursively builds the call hierarchy for an item, but only for local project files
 * @param {vscode.CallHierarchyItem} item The current item to process
 * @param {Set<string>} workspacePaths Set of workspace folder paths
 * @param {Set<string>} processedItems Set of already processed items to avoid cycles
 * @param {vscode.WebviewPanel | null} panel The webview panel to send progress updates to (can be null)
 * @returns {Promise<object>} The hierarchy data for this item
 */
async function buildHierarchyRecursively(item, workspacePaths, processedItems, panel) {
  const itemId = `${item.uri.fsPath}:${item.range.start.line}:${item.range.start.character}`;

  if (processedItems.has(itemId)) {
    return {
      name: item.name,
      detail: item.detail,
      location: {
        startLine: item.range.start.line + 1,
        endLine: item.range.end.line + 1,
        file: item.uri.fsPath
      },
      source: '',
      classAnnotations: '',
      reference: "Already processed - cycle detected"
    };
  }

  processedItems.add(itemId);

  const isLocal = isPathInWorkspace(item.uri.fsPath, workspacePaths);
  const isExternal = !isLocal || isExternalPackage(item.detail);

  // Only get source and class info for local, non-external package files
  let source = '';
  let classAnnotations = '';

  if (!isExternal && isLocal) {
    // Extract the class name from item.detail (format is typically "ClassName.methodName")
		const className = item.detail?.split('.')?.pop() || '';


    // Get class information including annotations
    const classInfo = await getClassInformation(item.uri, className);
    classAnnotations = classInfo.annotations;

    // Get method source
    const document = await vscode.workspace.openTextDocument(item.uri);
    source = document.getText(new vscode.Range(
      item.range.start.line, 0,
      item.range.end.line, document.lineAt(item.range.end.line).text.length
    ));
  }

  const methodData = {
    name: item.name,
    detail: item.detail,
    location: {
      startLine: item.range.start.line + 1,
      endLine: item.range.end.line + 1,
      file: item.uri.fsPath
    },
    source,
    classAnnotations,
    outgoingCalls: []
  };

  if (isExternal) {
    methodData.external = true;
  }

  const outgoing = /** @type {vscode.CallHierarchyOutgoingCall[]} */ (await vscode.commands.executeCommand(
    'vscode.provideOutgoingCalls', item
  ));

  for (const call of outgoing) {
    const isCallLocal = isPathInWorkspace(call.to.uri.fsPath, workspacePaths);
    const isCallExternal = !isCallLocal || isExternalPackage(call.to.detail);

    let callSource = '';
    let callClassAnnotations = '';

    if (!isCallExternal && isCallLocal) {
      // Extract the class name from call.to.detail
      const callClassName = call.to.detail?.split('.')?.pop() || '';

      // Get class information including annotations
      const classInfo = await getClassInformation(call.to.uri, callClassName);
      callClassAnnotations = classInfo.annotations;

      // Get method source
      const document = await vscode.workspace.openTextDocument(call.to.uri);
      callSource = document.getText(new vscode.Range(
        call.to.range.start.line, 0,
        call.to.range.end.line, document.lineAt(call.to.range.end.line).text.length
      ));
    }

    const callData = {
      name: call.to.name,
      detail: call.to.detail,
      location: {
        startLine: call.to.range.start.line + 1,
        endLine: call.to.range.end.line + 1,
        file: call.to.uri.fsPath
      },
      source: callSource,
      classAnnotations: callClassAnnotations,
      callSites: call.fromRanges.map(range => ({
        startLine: range.start.line + 1,
        endLine: range.end.line + 1
      }))
    };

    if (isCallExternal) {
      callData.external = true;
    }

    if (!isCallExternal) {
      const nestedCalls = await buildHierarchyRecursively(call.to, workspacePaths, processedItems, panel);
      if (nestedCalls.outgoingCalls) {
        callData.outgoingCalls = nestedCalls.outgoingCalls;
      }
    }

    methodData.outgoingCalls.push(callData);
  }

  return methodData;
}

/**
 * Determines if a file path is within one of the workspace folders
 * @param {string} filePath Path to check
 * @param {Set<string>} workspacePaths Set of workspace folder paths
 * @returns {boolean} True if the path is within a workspace folder
 */
function isPathInWorkspace(filePath, workspacePaths) {
  // Check if the file path starts with any of the workspace paths
  for (const workspacePath of workspacePaths) {
    if (filePath.startsWith(workspacePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Determines if a method belongs to an external package based on its detail
 * @param {string} detail The detail property of the CallHierarchyItem
 * @returns {boolean} True if the method appears to be from an external package
 */
function isExternalPackage(detail) {
  if (!detail) return false;

  // Check for standard Java packages
  if (detail.includes('java.') || detail.includes('javax.')) {
    return true;
  }

  // Common external package patterns
  const externalPackagePrefixes = [
    'java.base/',  // Java modules
    'org.springframework',
    'com.google',
    'org.apache',
    'com.fasterxml',
    'junit.',
    'org.junit',
    'org.mockito',
    'com.sun.',
    'sun.',
    'jdk.',
    'io.netty.',
    'org.slf4j',
    'org.yaml',
    'org.json',
    'com.intellij',
    'kotlin.',
    'scala.',
    'groovy.'
  ];

  return externalPackagePrefixes.some(prefix => detail.includes(prefix));
}

function deactivate() {}

module.exports = { activate, deactivate, getWebviewContent };
