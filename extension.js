const vscode = require('vscode');
const path = require('path');
const parseGitConfig = require('parse-git-config').sync;
const fs = require('fs');
const { handleCleanupAndAddLinks, collectSources } = require('./diagramProcessor'); // Updated import to include collectSources

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
      // repoUrl and branch might be used elsewhere or for future features,
      // so their calculation is kept, but they are not used by the simplified createFileLinksHtml.
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
      const branch = 'main'; // adjust or derive dynamically if needed

      // Build HTML list of links
      let list = '<ul>';

      for (const uri of uris) {
        list += `<li>${createFileLinksHtml(uri, context)}</li>`; // Pass context
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
          retainContextWhenHidden: true, // Retain context when webview is hidden
          localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
        }
      );

      // Set the HTML content
      const webviewContentPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'diagramGeneratorWebview.html'));
      panel.webview.html = fs.readFileSync(webviewContentPath.fsPath, 'utf8');

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(
        async message => {
          // Delegate to helper functions based on command
          switch (message.command) {
            case 'getCallHierarchyItems':
              await handleGetCallHierarchyItems(message, panel, uri, position, context);
              break;
            case 'getRecursiveOutgoingCalls':
              await handleGetRecursiveOutgoingCalls(message, panel, uri, position, context);
              break;
            case 'generateMermaidDiagramPrompt':
              await handleGenerateMermaidDiagramPrompt(message, panel, context);
              break;
            case 'generateClaudeDiagram':
              await handleGenerateClaudeDiagram(message, panel);
              break;
            case 'openMermaidDisplay':
              await handleOpenMermaidDisplay(message, context);
              break;
            case 'openCleanedMermaidDisplay': // Added new case
              await handleOpenMermaidDisplay(message, context); // Reusing handleOpenMermaidDisplay
              break;
            case 'openFileInEditor':
              await handleOpenFileInEditor(message, context);
              break;
            case 'cleanupAndAddLinks':
              await handleCleanupAndAddLinks(message, panel, generateMethodId); // Pass generateMethodId
              break;
            default:
              console.warn('Received unknown message command:', message.command);
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(showLinksDisposable, generateDiagramDisposable);
}

// Helper function for 'getCallHierarchyItems'
async function handleGetCallHierarchyItems(message, panel, uri, position, context) {
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
}

// Helper function for 'getRecursiveOutgoingCalls'
async function handleGetRecursiveOutgoingCalls(message, panel, uri, position, context) {
  try {
    const hierarchyData = await getCallHierarchyData(uri, position, panel, context);
    if (hierarchyData) {
      panel.webview.postMessage({ command: 'recursiveOutgoingCallsData', payload: hierarchyData });
    } else {
      panel.webview.postMessage({ command: 'recursiveOutgoingCallsError', payload: 'Failed to retrieve call hierarchy data.' });
    }
  } catch (e) {
    console.error('Error building recursive call hierarchy:', e);
    vscode.window.showErrorMessage('Error building recursive call hierarchy.');
    panel.webview.postMessage({ command: 'recursiveOutgoingCallsError', payload: 'Error building recursive call hierarchy. Check the console for details.' });
  }
}

// Helper function for 'generateMermaidDiagramPrompt'
async function handleGenerateMermaidDiagramPrompt(message, panel, context) {
  try {
    if (!panel.webview.callHierarchyData) {
      panel.webview.postMessage({ command: 'mermaidDiagramPromptError', payload: 'Please generate the recursive call hierarchy first.' });
      return;
    }
    const diagramType = message.payload && message.payload.diagramType ? message.payload.diagramType : 'sequence'; // Default to sequence
    const prompt = await generateSequenceDiagramPrompt([panel.webview.callHierarchyData], panel, diagramType, context); // Pass context
    panel.webview.postMessage({ command: 'mermaidDiagramPromptData', payload: prompt });
  } catch (e) {
    console.error('Error generating Mermaid diagram prompt:', e);
    vscode.window.showErrorMessage('Error generating Mermaid diagram prompt.');
    panel.webview.postMessage({ command: 'mermaidDiagramPromptError', payload: 'Error generating Mermaid diagram prompt. Check the console for details.' });
  }
}

// Helper function for 'generateClaudeDiagram'
async function handleGenerateClaudeDiagram(message, panel) {
  try {
    const promptFromWebview = message.payload && message.payload.prompt;
    if (!promptFromWebview || promptFromWebview.trim() === '') {
      const errorMsg = 'Prompt is empty. Cannot generate Claude AI diagram.';
      if (panel.webview) {
        panel.webview.postMessage({ command: 'updateProgressStatus', payload: errorMsg });
        panel.webview.postMessage({ command: 'claudeDiagramError', payload: errorMsg });
      }
      return;
    }
    await invokeClaudeLlmWithPrompt(promptFromWebview, panel);
  } catch (e) {
    console.error('Error in generateClaudeDiagram case:', e);
    const errorMsg = `Error generating Claude AI diagram: ${e.message}`;
    vscode.window.showErrorMessage(errorMsg);
    if (panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: errorMsg });
      panel.webview.postMessage({ command: 'claudeDiagramError', payload: errorMsg });
    }
  }
}

// Helper function for 'openMermaidDisplay'
async function handleOpenMermaidDisplay(message, context) {
  try {
    const mermaidCode = message.payload.mermaidCode || message.payload.cleanedMermaidCode; // Modified to accept cleanedMermaidCode
    const promptText = message.payload.promptText;

    if (!mermaidCode || mermaidCode.trim() === '') { // Added check for empty or undefined mermaidCode
      vscode.window.showErrorMessage('Error: Mermaid code is missing or empty and cannot be displayed.');
      return;
    }

    const displayPanel = vscode.window.createWebviewPanel(
      'mermaidDisplay',
      'Mermaid Diagram Display',
      vscode.ViewColumn.Beside, // Open in a new column
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
      }
    );
    displayPanel.webview.html = getMermaidDisplayWebviewContent(mermaidCode, promptText, context, displayPanel.webview);
  } catch (e) {
    console.error('Error opening Mermaid display webview:', e);
    vscode.window.showErrorMessage('Error opening Mermaid display webview. Check console for details.');
  }
}

// Helper function for 'openFileInEditor'
async function handleOpenFileInEditor(message, context) {
  if (message.payload && message.payload.filePath && message.payload.startLine) {
    await openFileAtLocation(
      context, // Pass context
      message.payload.filePath,
      message.payload.startLine,
      message.payload.endLine || message.payload.startLine
    );
  }
}

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
 * Gets or computes call hierarchy data.
 * @param {vscode.Uri} uri Document URI
 * @param {vscode.Position} position Position in the document
 * @param {vscode.WebviewPanel} panel The webview panel
 * @param {vscode.ExtensionContext} context The extension context
 * @returns {Promise<object|null>} The hierarchy data or null on failure
 */
async function getCallHierarchyData(uri, position, panel, context) {
  if (panel && panel.webview && panel.webview.callHierarchyData) {
    if (panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Reusing existing call hierarchy data.' });
    }
    return panel.webview.callHierarchyData;
  }

  if (panel && panel.webview) {
    panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Fetching call hierarchy data...' });
  }
  try {
    const initialItems = /** @type {vscode.CallHierarchyItem[]} */ (
      await vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, position)
    );
    if (!initialItems || initialItems.length === 0) {
      throw new Error('Could not prepare initial call hierarchy item.');
    }
    const rootItem = initialItems[0];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error('No workspace folder found.');
    }
    const workspacePaths = new Set(workspaceFolders.map(folder => folder.uri.fsPath));
    const processedItems = new Set();
    const callHierarchyData = await buildHierarchyRecursively(rootItem, workspacePaths, processedItems, panel, context);
    if (panel && panel.webview) {
      panel.webview.callHierarchyData = callHierarchyData; // Cache it
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Call hierarchy data fetched.' });
    }
    return callHierarchyData;
  } catch (error) {
    console.error('Error in getCallHierarchyData:', error);
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: `Error fetching call hierarchy data: ${error.message}` });
    }
    throw error; // Re-throw to be caught by caller
  }
}

/**
 * Generates a Mermaid sequence diagram using the call hierarchy data and Claude AI
 * @param {vscode.TextEditor} editor The active text editor
 * @param {vscode.WebviewPanel} panel The webview panel to send progress updates to
 * @param {object} [existingHierarchyData] Optional pre-fetched hierarchy data
 * @param {vscode.ExtensionContext} context The extension context
 * @returns {Promise<string|null>} The generated Mermaid sequence diagram text or null on failure
 */
async function generateSequenceDiagram(editor, panel, existingHierarchyData, context) {
  if (!editor) {
    vscode.window.showInformationMessage('No active editor');
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'No active editor.' });
      panel.webview.postMessage({ command: 'claudeDiagramError', payload: 'No active editor.' });
    }
    return null;
  }

  let hierarchyDataToUse;
  if (existingHierarchyData) {
    hierarchyDataToUse = existingHierarchyData;
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Using pre-loaded call hierarchy data for full generation.' });
    }
  } else {
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Fetching call hierarchy data for full diagram generation...' });
    }
    try {
      hierarchyDataToUse = await getCallHierarchyData(editor.document.uri, editor.selection.active, panel, context);
    } catch (e) {
      const errorMsg = `Failed to get call hierarchy data for full generation: ${e.message}`;
      vscode.window.showErrorMessage(errorMsg);
      if (panel && panel.webview) {
        panel.webview.postMessage({ command: 'updateProgressStatus', payload: errorMsg });
        panel.webview.postMessage({ command: 'claudeDiagramError', payload: errorMsg });
      }
      return null;
    }
  }

  if (!hierarchyDataToUse) {
    const errorMsg = 'Failed to get call hierarchy data (data is null or undefined) for full generation.';
    vscode.window.showInformationMessage(errorMsg);
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: errorMsg });
      panel.webview.postMessage({ command: 'claudeDiagramError', payload: errorMsg });
    }
    return null;
  }

  try {
    const prompt = await generateSequenceDiagramPrompt([hierarchyDataToUse], panel, 'sequence', context); // Pass context
    // Call the separated LLM invocation function
    return await invokeClaudeLlmWithPrompt(prompt, panel);
  } catch (error) {
    console.error('Error in generateSequenceDiagram (outer shell):', error);
    const errorMessage = error.message || 'An unknown error occurred during the full diagram generation process.';
    vscode.window.showErrorMessage(`Error in full diagram generation: ${errorMessage}`);
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: `Error in full diagram generation: ${errorMessage}` });
      panel.webview.postMessage({ command: 'claudeDiagramError', payload: `Error in full diagram generation: ${errorMessage}` });
    }
    return null;
  }
}

/**
 * Invokes the Claude LLM with a given prompt text.
 * @param {string} promptText The prompt to send to the LLM.
 * @param {vscode.WebviewPanel} panel The webview panel to send progress updates to.
 * @returns {Promise<void>} No return value, handles streaming responses.
 */
async function invokeClaudeLlmWithPrompt(promptText, panel) {
  if (!promptText || promptText.trim() === '') {
    const msg = 'Prompt text is empty. Cannot send to Language Model.';
    vscode.window.showErrorMessage(msg);
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: msg });
      panel.webview.postMessage({ command: 'claudeDiagramError', payload: msg });
    }
    return;
  }

  try {
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Selecting language model...' });
    }

    if (!vscode.lm) {
      const msg = 'Language Model API (vscode.lm) is not available. Please ensure your VS Code version supports it and the API is enabled.';
      vscode.window.showErrorMessage(msg);
      if (panel && panel.webview) {
        panel.webview.postMessage({ command: 'updateProgressStatus', payload: msg });
        panel.webview.postMessage({ command: 'claudeDiagramError', payload: msg });
      }
      return;
    }

    const models = await vscode.lm.selectChatModels({ family: 'claude-3.5-sonnet' });

    if (!models || models.length === 0) {
      const errorMsg = 'No language models available for claude-3.5-sonnet family. Please check your VS Code setup and language model access.';
      vscode.window.showErrorMessage(errorMsg);
      if (panel && panel.webview) {
        panel.webview.postMessage({ command: 'updateProgressStatus', payload: errorMsg });
        panel.webview.postMessage({ command: 'claudeDiagramError', payload: errorMsg });
      }
      return;
    }

    const [model] = models;
    const messages = [vscode.LanguageModelChatMessage.User(promptText)];
    const tokenSource = new vscode.CancellationTokenSource();

    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Sending provided prompt to language model...' });
    }
    const response = await model.sendRequest(messages, {
      justification: 'Generate a Mermaid sequence diagram from user-provided prompt (originally from Java call hierarchy)'
    }, tokenSource.token);

    let hasReceivedData = false;
    if (panel && panel.webview) {
      // Initial message before streaming starts, handled by the webview's 'claudeDiagramTokenChunk'
    }
    for await (const textChunk of response.text) {
      if (panel && panel.webview) {
        panel.webview.postMessage({ command: 'claudeDiagramTokenChunk', payload: textChunk });
      }
      hasReceivedData = true;
    }

    if (!hasReceivedData) {
      const errorMsg = 'No response or empty response from language model.';
      vscode.window.showInformationMessage(errorMsg);
      if (panel && panel.webview) {
        panel.webview.postMessage({ command: 'updateProgressStatus', payload: errorMsg });
        panel.webview.postMessage({ command: 'claudeDiagramError', payload: errorMsg });
      }
      return;
    }

    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'claudeDiagramStreamEnd' });
    }
  } catch (error) {
    console.error('Error in invokeClaudeLlmWithPrompt:', error);
    const errorMessage = error.message || 'An unknown error occurred during diagram generation with the language model.';
    vscode.window.showErrorMessage(`Error generating diagram with LLM: ${errorMessage}`);
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: `Error generating diagram with LLM: ${errorMessage}` });
      panel.webview.postMessage({ command: 'claudeDiagramError', payload: `Error generating diagram with LLM: ${errorMessage}` });
    }
  }
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
      link: createFileLinksHtml(item.uri, context), // Pass context
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
    link: createFileLinksHtml(item.uri, context), // Pass context
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
      link: createFileLinksHtml(call.to.uri, context), // Pass context
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
      const nestedCalls = await buildHierarchyRecursively(call.to, workspacePaths, processedItems, panel, context);
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

/**
 * Generates a prompt for sequence diagram generation based on call hierarchy data
 * @param {object[]} hierarchyData The call hierarchy data
 * @param {vscode.WebviewPanel | null} panel The webview panel to send progress updates to. Can be null if no progress updates are needed.
 * @param {string} diagramType The type of diagram to generate ('sequence', 'flowchart', or 'flowchart-links').
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<string>} The generated prompt
 */
async function generateSequenceDiagramPrompt(hierarchyData, panel, diagramType = 'sequence', context) { // Add context
  if (panel && panel.webview) {
    panel.webview.postMessage({ command: 'updateProgressStatus', payload: `Generating ${diagramType} diagram prompt...` });
  }

  const sources = [];
  for (const data of hierarchyData) {
    collectSources(data, sources);
  }

  if (sources.length === 0) {
    if (panel && panel.webview) {
      panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Prompt generation failed: No source code found.' });
    }
    throw new Error('No source code found to generate diagram');
  }

  let promptHeader = '';

  if (diagramType === 'flowchart') {
    promptHeader =
    'Please create a Mermaid Flowchart using these Java classes. ' +
    'Use flowchart LR (left to right) direction. ' +
    'For each class provided, use its name (e.g., ProductController.java) as the node ID and the displayed text in the diagram. ' +
    'Group related methods by class using subgraphs if it makes sense. ' +
    'Show the control flow between methods/classes. ' +
    'Style external calls differently using dashed lines. ' +
    'Show URLs and REST API calls. Show SQL queries. ' +
    'Use the symbols provided. For example,  Symbol: PC' +
    'Include control flow (if/else, for/while) and add notes for important logic.\n';
  } else if (diagramType === 'flowchart-links') {
    promptHeader =
    'Please create a Mermaid Flowchart using these Java classes. ' +
    'Use flowchart LR (left to right) direction. ' +
    'For each class provided below: ' +
    '  - Use its name (e.g., ProductController.java) as the node ID in the diagram. ' +
    '  - The text displayed for the node should also be the class name. ' +
    '  - IMPORTANT: Create a click interaction for each class node using the "Link:" information provided for it. ' +
    '    The format MUST be: click ClassName.java href "vscode://file//ABSOLUTE/PATH/TO/ClassName.java" "Open ClassName.java". ' +
    '    Example: For a class ProductController.java with link information ' +
    '    Link: click ProductController.java href "vscode://file//path/to/ProductController.java" "Open ProductController.java", ' +
    '    the diagram code must include the line: click ProductController.java href "vscode://file//path/to/ProductController.java" "Open ProductController.java".\n' +
    'Show the control flow between methods/classes. ' +
    'Style external calls differently using dashed lines.\n';
  } else if (diagramType === 'sequence') { // Default to sequence diagram with links
    // NOTE: Mermaid sequence diagrams might not support 'click' directives for participants.
    // The following prompt attempts to use them, but verify Mermaid documentation for current support.
    promptHeader =
    'Please create a Mermaid Sequence Diagram using these Java classes. ' +
    'The first entry begins the diagram. ' +
    'For each class provided, use its name (e.g., ProductController.java) as the participant alias and description in the diagram. ' +
    'Feel free to add multiple levels (6 or more) if it makes sense. ' +
    'Please include each method call in your diagram. ' +
    'Include "Note over" in several places to call out what functionality is doing. ' +
    'Include if/else conditions, and include details about SQL queries. \n';
  }

  const prompt = [promptHeader];

  buildPromptFromSources(prompt, sources);

  if (panel && panel.webview) {
    panel.webview.postMessage({ command: 'updateProgressStatus', payload: `${diagramType} diagram prompt generated.` });
  }
  return prompt.join('\n');
}

/**
 * Builds the prompt string from collected sources.
 * @param {string[]} prompt The initial prompt array to append to.
 * @param {Array<{source: string, filename: string, className: string, methodNameSignature: string, classAnnotations: string}>} sources Array of collected source data.
 */
function buildPromptFromSources(prompt, sources) {
  sources.forEach(({source, filename, className, methodNameSignature, classAnnotations}) => {
    const methodAnnotations = source.split('\n')
      .filter(line => line.trim().startsWith('@'))
      .join('\n');
    const methodCode = source.split('\n')
      .filter(line => !line.trim().startsWith('@'))
      .join('\n');

    prompt.push('################################');
    const baseFilename = path.basename(filename); // e.g., ProductController.java
    const absoluteFilePath = path.resolve(filename); // Ensures it's absolute

    // Generate and add the ID using both className (item.detail) and methodNameSignature (item.name)
    const methodId = generateMethodId(className, methodNameSignature);
    prompt.push(`ID: ${methodId}`);

    // Always provide the link information for each source entry
    const clickLink = `click ${methodId} href "vscode://file/${absoluteFilePath}" "Open ${baseFilename}"`;
    prompt.push(`Link: ${clickLink}`);
    
    prompt.push(`Class: ${className}`); // Actual class name from source

    if (classAnnotations) {
      prompt.push('Class Annotations:');
      prompt.push(classAnnotations);
    }
    if (methodAnnotations) {
      prompt.push('Method Annotations:');
      prompt.push(methodAnnotations);
    }
    prompt.push(methodCode);
  });
  prompt.push('################################');
}

/**
 * Generates a unique ID for a method based on its class detail and method signature.
 * Example: classNameDetail="com.example.testfixture.ProductController", methodNameSignature="updateStock(Long): void" => "PC_updateStock"
 * Example: classNameDetail="Product", methodNameSignature="getName()" => "P_getName"
 * @param {string} classNameDetail The detail string of the class (e.g., "com.example.testfixture.ProductController" or "Product").
 * @param {string} methodNameSignature The full signature of the method (e.g., "updateStock(Long, Map<String, Integer>) : ResponseEntity<Product>").
 * @returns {string} The generated ID.
 */
function generateMethodId(classNameDetail, methodNameSignature) {
  if (!classNameDetail || typeof classNameDetail !== 'string' || !methodNameSignature || typeof methodNameSignature !== 'string') {
    return 'UNKNOWN_ID';
  }

  // Extract simple class name from classNameDetail
  // e.g., "com.example.testfixture.ProductController" -> "ProductController"
  // e.g., "ProductController" -> "ProductController"
  const classParts = classNameDetail.split('.');
  const simpleClassName = classParts.length > 0 ? classParts[classParts.length - 1] : '';

  if (!simpleClassName) return 'UNKNOWN_CLASS_PART_FOR_ID';

  // Create class abbreviation: extract uppercase letters. If none, first letter capitalized.
  let classAbbreviation;
  const uppercaseLetters = simpleClassName.replace(/[^A-Z]/g, '');
  if (uppercaseLetters) {
    classAbbreviation = uppercaseLetters;
  } else if (simpleClassName.length > 0) {
    classAbbreviation = simpleClassName.charAt(0).toUpperCase();
  } else {
    // This case should ideally not be reached if simpleClassName is validated
    classAbbreviation = 'UNK';
  }

  // Extract actual method name from methodNameSignature
  // e.g., "updateStock(Long, Map<String, Integer>) : ResponseEntity<Product>" -> "updateStock"
  // e.g., "Product(String)" (constructor) -> "Product"
  const methodName = methodNameSignature.split(/[\\(<:]/)[0].trim();

  if (!methodName) return `${classAbbreviation}_UNKNOWN_METHOD_PART_FOR_ID`;

  return `${classAbbreviation}_${methodName}`;
}

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

/**
 * Loads and processes the webview HTML template for displaying the Mermaid diagram.
 * @param {string} mermaidCode The Mermaid sequence diagram code to insert.
 * @param {string} promptText The prompt used to generate the diagram.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {vscode.Webview} webview The webview instance to get the CSP source from.
 * @returns {string} The processed HTML content.
 */
function getMermaidDisplayWebviewContent(mermaidCode, promptText, context, webview) {
  const templatePath = vscode.Uri.joinPath(context.extensionUri, 'media', 'mermaidDisplayWebview.html');
  const templateContent = fs.readFileSync(templatePath.fsPath, 'utf8');
  const nonce = getNonce(); // Helper function to generate nonce for CSP if needed, or manage CSP directly
  const cspSource = webview.cspSource;

  return templateContent
    .replace(/\${mermaidCode}/g, mermaidCode)
    .replace(/\${promptText}/g, promptText || 'No prompt available')
    .replace(/\${cspSource}/g, cspSource);
}

/**
 * Convert SSH or Git URLs to HTTPS
 * @param {string} url
 */
function toHTTPS(url) {
  if (url.startsWith('git@')) {
    const [, hostPath] = url.split('@');
    const [host, repo] = hostPath.split(':');
    return `https://${host}/${repo.replace(/\.git$/, '')}`;
  }
  return url.replace(/\.git$/, '');
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

// Helper function to generate a nonce (if you choose to use nonces for CSP)
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Opens a file in the editor at a specific location.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} relativeFilePath Relative path to the file from the workspace root.
 * @param {number} startLine One-based line number for the start of the selection.
 * @param {number} endLine One-based line number for the end of the selection.
 */
async function openFileAtLocation(context, relativeFilePath, startLine, endLine) {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Cannot open file: No workspace folder found.');
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const absoluteFilePath = path.resolve(workspaceRoot, relativeFilePath);

    const uri = vscode.Uri.file(absoluteFilePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Convert to zero-based line numbers for VS Code API
    const startPos = Math.max(0, startLine - 1);
    const endPos = endLine ? Math.max(startPos, endLine - 1) : startPos;
    
    const lineText = editor.document.lineAt(endPos).text;
    const range = new vscode.Range(
      new vscode.Position(startPos, 0), // Start of the line
      new vscode.Position(endPos, lineText.length) // End of the line
    );
    
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  } catch (error) {
    console.error(`Error opening file ${relativeFilePath}:`, error);
    vscode.window.showErrorMessage(`Could not open file: ${relativeFilePath}. ${error.message || String(error)}`);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  getWebviewContent,
  getCallHierarchyData,
  generateSequenceDiagram, // Kept for potential other uses or direct full generation
  invokeClaudeLlmWithPrompt, // New function for direct LLM call with prompt
  generateSequenceDiagramPrompt,
  getMermaidDisplayWebviewContent, // Export new function
  openFileAtLocation, // Exported for external use
  buildPromptFromSources, // Export new function
  generateMethodId // Export new function
};
