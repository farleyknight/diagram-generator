const vscode = require('vscode');
const path = require('path');

/**
 * Creates HTML string for a link to open the file in VS Code.
 * @param {vscode.Uri} uri The URI of the file.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {string} HTML string for an anchor tag.
 */
function createFileLinksHtml(uri, context) {
  const filename = path.basename(uri.fsPath);
  let relativePath = uri.fsPath;

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    relativePath = path.relative(workspaceRoot, uri.fsPath);
  }

  // Updated to the shorter link format
  return `<a href="#" class="code-link" data-file="${relativePath}">${filename}</a>`;
}

/**
 * Recursively builds the call hierarchy for an item, but only for local project files
 * @param {vscode.CallHierarchyItem} item The current item to process
 * @param {Set<string>} workspacePaths Set of workspace folder paths
 * @param {Set<string>} processedItems Set of already processed items to avoid cycles
 * @param {vscode.WebviewPanel | null} panel The webview panel to send progress updates to (can be null)
 * @param {vscode.ExtensionContext} context The extension context
 * @returns {Promise<object>} The hierarchy data for this item
 */
async function buildHierarchyRecursively(item, workspacePaths, processedItems, panel, context) {
  console.log('buildHierarchyRecursively called with:', {
    item: {
      name: item.name,
      detail: item.detail,
      uri: item.uri.fsPath,
      range: {
        start: item.range.start,
        end: item.range.end
      }
    },
    workspacePaths,
    processedItemsSize: processedItems.size
  });

  const itemId = `${item.uri.fsPath}:${item.range.start.line}:${item.range.start.character}`;

  if (processedItems.has(itemId)) {
    console.log('Item already processed, skipping:', itemId);
    return {
      name: item.name,
      detail: item.detail,
      location: {
        startLine: item.range.start.line + 1,
        endLine: item.range.end.line + 1,
        file: item.uri.fsPath
      },
      link: createFileLinksHtml(item.uri, context),
      source: '',
      classAnnotations: '',
      reference: "Already processed - cycle detected"
    };
  }

  processedItems.add(itemId);
  console.log('Processing item:', itemId);

  const isLocal = isPathInWorkspace(item.uri.fsPath, workspacePaths);
  const isExternal = !isLocal || isExternalPackage(item.detail);

  let source = '';
  let classAnnotations = '';

  if (!isExternal && isLocal) {
    console.log('Processing local item:', item.detail);
    console.log('Item URI:', item.uri.fsPath);
    console.log('Item range:', item.range);
    console.log('Item name:', item.name);
    console.log('Item detail:', item.detail);
    const className = item.detail?.split('.')?.pop() || '';
    console.log('Fetching class information for:', className);

    const classInfo = await getClassInformation(item.uri, className);
    classAnnotations = classInfo.annotations;

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
    link: createFileLinksHtml(item.uri, context),
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
  console.log('Outgoing calls for item:', itemId, outgoing);

  for (const call of outgoing) {
    const isCallLocal = isPathInWorkspace(call.to.uri.fsPath, workspacePaths);
    const isCallExternal = !isCallLocal || isExternalPackage(call.to.detail);

    let callSource = '';
    let callClassAnnotations = '';

    if (!isCallExternal && isCallLocal) {
      const callClassName = call.to.detail?.split('.')?.pop() || '';
      console.log('Fetching class information for outgoing call:', callClassName);

      const classInfo = await getClassInformation(call.to.uri, callClassName);
      callClassAnnotations = classInfo.annotations;

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
      link: createFileLinksHtml(call.to.uri, context),
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
      console.log('Recursively processing outgoing call:', call.to.name);
      const nestedCalls = await buildHierarchyRecursively(call.to, workspacePaths, processedItems, panel, context);
      if (nestedCalls.outgoingCalls) {
        callData.outgoingCalls = nestedCalls.outgoingCalls;
      }
    }

    methodData.outgoingCalls.push(callData);
  }

  console.log('Completed processing for item:', itemId);
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

module.exports = {
    createFileLinksHtml,
    buildHierarchyRecursively,
    isPathInWorkspace,
    isExternalPackage,
    getClassInformation
};