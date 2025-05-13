const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { handleCleanupAndAddLinks, collectSources } = require('./diagramProcessor'); // Updated import to include collectSources
const { createWebviewPanel } = require('./webviewUtils'); // Added import
const {
  createFileLinksHtml,
  buildHierarchyRecursively,
  isPathInWorkspace,
  isExternalPackage,
  getClassInformation
} = require('./callHierarchyBuilder'); // Added import for call hierarchy functions

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
    'diagram-generator.generateMermaidDiagram',
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

      // Create and show a webview panel using the utility function
      const panel = createWebviewPanel(
        context,
        'generateDiagram', // Identifies the type of the webview. Used internally
        'Generate Mermaid Diagram', // Title of the panel displayed to the user
        'mermaidDiagramGenerator.html' // HTML file to load
      );

      // Set the HTML content - this is now handled by createWebviewPanel
      // const webviewContentPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'mermaidDiagramGenerator.html'));
      // panel.webview.html = fs.readFileSync(webviewContentPath.fsPath, 'utf8');

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(
        async message => {
          // Use the common handler first
          if (await handleCommonCallHierarchyMessages(message, panel, uri, position, context)) {
            return; // Message handled by common handler
          }
          switch (message.command) {
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
            case 'openGojsDiagramInNewPanel': // New case added
              await handleOpenGojsDiagramInNewPanel(message, context, panel);
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

  const generateGoJSDiagramDisposable = vscode.commands.registerCommand(
    'diagram-generator.generateGoJSDiagram',
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

      // For now, let's assume we might want a different HTML or setup for GoJS
      // Or it could reuse the same initial webview if the UI supports both.
      // This is a minimal placeholder.
      const panel = createWebviewPanel(
        context,
        'generateGoJSDiagram',
        'Generate GoJS Diagram',
        'gojsDiagramGenerator.html' // Assuming a new HTML file for GoJS, or adapt as needed
      );

      // Placeholder for GoJS specific message handling
      panel.webview.onDidReceiveMessage(
        async message => {
          // Use the common handler first
          if (await handleCommonCallHierarchyMessages(message, panel, uri, position, context)) {
            return; // Message handled by common handler
          }
          switch (message.command) {
            case 'openGojsDisplayPanel': // New case to open the GoJS display panel
              try {
                const displayPanel = vscode.window.createWebviewPanel(
                  'goJsDisplay', // Identifies the type of the webview.
                  'GoJS Diagram Display', // Title of the panel.
                  vscode.ViewColumn.Beside, // Show in a new column.
                  {
                    enableScripts: true,
                    retainContextWhenHidden: true, // Keep content when tab is hidden
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
                  }
                );

                displayPanel.webview.html = getGoJsDisplayWebviewContent(context, displayPanel.webview);
                context.subscriptions.push(displayPanel); // Ensure the panel is disposed when the extension deactivates

                // Optional: If you need to send data to this new panel immediately,
                // you might want to listen for a "ready" message from gojsDisplay.html
                // and then post data, similar to the 'initiateGoJsGeneration' example.
                // For now, we'll just open it.

              } catch (e) {
                console.error('Error opening GoJS display panel:', e);
                vscode.window.showErrorMessage('Error opening GoJS display panel. Check console for details.');
              }
              break;
            case 'initiateGoJsGeneration': // Message from gojsDiagramGenerator.html
              vscode.window.showInformationMessage('GoJS diagram generation initiated.');
              // 1. Simulate or perform actual GoJS data generation
              const sampleGoJsData = {
                nodeDataArray: [
                  { key: "Alpha", name: "Start Node" },
                  { key: "Beta", name: "Another Node" },
                  { key: "Gamma", name: "End Node" }
                ],
                linkDataArray: [
                  { from: "Alpha", to: "Beta" },
                  { from: "Beta", to: "Gamma" }
                ]
              };

              // 2. Create and show the GoJS display panel
              const displayPanel = vscode.window.createWebviewPanel(
                'goJsDisplay', // Identifies the type of the webview.
                'GoJS Diagram Display', // Title of the panel.
                vscode.ViewColumn.Beside, // Show in a new column.
                {
                  enableScripts: true,
                  localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
                }
              );

              displayPanel.webview.html = getGoJsDisplayWebviewContent(context, displayPanel.webview);
              context.subscriptions.push(displayPanel); // Ensure the panel is disposed when the extension deactivates

              // 3. Post data to the GoJS display webview once it's ready
              const gojsDisplayReadyListener = displayPanel.webview.onDidReceiveMessage(
                displayMessage => {
                  if (displayMessage.command === 'gojsDisplayReady') {
                    displayPanel.webview.postMessage({
                      command: 'loadGoJsData',
                      payload: { goJsData: sampleGoJsData }
                    });
                    // Dispose this listener once the message is sent and processed
                    gojsDisplayReadyListener.dispose();
                  }
                },
                undefined,
                context.subscriptions // Add listener to subscriptions for cleanup
              );
              break;
            case 'openGojsDiagramInNewPanel': // Add this case
              await handleOpenGojsDiagramInNewPanel(message, context, panel);
              break;
            default:
              console.warn('Received unknown message command for GoJS generator:', message.command);
          }
        },
        undefined,
        context.subscriptions
      );

      vscode.window.showInformationMessage('GoJS Diagram generator panel shown (placeholder).');
    }
  );

  context.subscriptions.push(showLinksDisposable, generateDiagramDisposable, generateGoJSDiagramDisposable);
}

// New helper function for common call hierarchy message handling
async function handleCommonCallHierarchyMessages(message, panel, uri, position, context) {
  switch (message.command) {
    case 'getCallHierarchyItems':
      await handleGetCallHierarchyItems(message, panel, uri, position, context);
      return true;
    case 'getRecursiveOutgoingCalls':
      await handleGetRecursiveOutgoingCalls(message, panel, uri, position, context);
      return true;
    default:
      return false; // Command not handled by this common handler
  }
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
  const templatePath = vscode.Uri.joinPath(context.extensionUri, 'media', 'mermaidDisplay.html');
  const templateContent = fs.readFileSync(templatePath.fsPath, 'utf8');
  const nonce = getNonce(); // Helper function to generate nonce for CSP if needed, or manage CSP directly
  const cspSource = webview.cspSource;

  return templateContent
    .replace(/\${mermaidCode}/g, mermaidCode)
    .replace(/\${promptText}/g, promptText || 'No prompt available')
    .replace(/\${cspSource}/g, cspSource);
}

/**
 * Loads and processes the webview HTML template for displaying the GoJS diagram.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {vscode.Webview} webview The webview instance to get the CSP source from.
 * @returns {string} The processed HTML content.
 */
function getGoJsDisplayWebviewContent(context, webview) {
  // Restored original implementation
  const templatePath = vscode.Uri.joinPath(context.extensionUri, 'media', 'gojsDisplay.html');
  const templateContent = fs.readFileSync(templatePath.fsPath, 'utf8');
  const cspSource = webview.cspSource;

  // Replace CSP source. GoJS data will be sent via postMessage.
  // Note: Adjusted regex from \\${cspSource} to \${\cspSource\}
  return templateContent.replace(/\${\cspSource}/g, cspSource);
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

// New handler function for 'openGojsDiagramInNewPanel'
async function handleOpenGojsDiagramInNewPanel(message, context, originalPanel) {
  try {
    const diagramData = message.payload;
    if (!diagramData || !diagramData.nodes || !diagramData.links) {
      vscode.window.showErrorMessage('Cannot open diagram: Invalid data received.');
      if (originalPanel && originalPanel.webview) {
        originalPanel.webview.postMessage({ command: 'diagramOpenError', payload: 'Invalid data received from source webview.' });
      }
      return;
    }

    const displayPanel = vscode.window.createWebviewPanel(
      'gojsDiagramView',         // Identifies the type of the webview. Used internally.
      'GoJS Diagram View',       // Title of the panel displayed to the user.
      vscode.ViewColumn.Beside,  // Show in a new column.
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] // For future use if loading local scripts/styles
      }
    );

    displayPanel.webview.html = getGoJsViewerWebviewContent(context, displayPanel.webview, diagramData);
    context.subscriptions.push(displayPanel);

    if (originalPanel && originalPanel.webview) {
      originalPanel.webview.postMessage({ command: 'diagramOpenedInNewPanel', payload: 'Diagram panel created.' });
    }
    vscode.window.showInformationMessage('GoJS Diagram View panel opened.');

  } catch (e) {
    console.error('Error opening GoJS Diagram View panel:', e);
    vscode.window.showErrorMessage('Error opening GoJS Diagram View panel. Check console for details.');
    if (originalPanel && originalPanel.webview) {
      originalPanel.webview.postMessage({ command: 'diagramOpenError', payload: `Error creating diagram panel: ${e.message}` });
    }
  }
}

// New helper function to generate HTML for the GoJS diagram viewer panel
function getGoJsViewerWebviewContent(context, webview, diagramData) {
  const gojsCdn = 'https://unpkg.com/gojs@2.3/release/go.js'; // Specify a version
  const nonce = getNonce(); // Assuming getNonce() function exists

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource} https:;">
    <title>GoJS Diagram View</title>
    <script nonce="${nonce}" src="${gojsCdn}"></script>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; }
        #myDiagramDiv { width: 100%; height: 100%; border: none; }
    </style>
</head>
<body>
    <div id="myDiagramDiv"></div>
    <script nonce="${nonce}">
        if (typeof go !== 'undefined') {
            initDiagram();
        } else {
            const goJsScriptTag = document.querySelector('script[src="${gojsCdn}"]');
            if (goJsScriptTag) {
                goJsScriptTag.onload = initDiagram;
            } else {
                document.body.innerText = "Error: GoJS library not found.";
            }
        }

        function initDiagram() {
            try {
                const $ = go.GraphObject.make;
                const diagram = $(go.Diagram, "myDiagramDiv", {
                    initialContentAlignment: go.Spot.Center,
                    "undoManager.isEnabled": true,
                    layout: $(go.LayeredDigraphLayout)
                });

                const nodeDataArray = ${JSON.stringify(diagramData.nodes || [])};
                const linkDataArray = ${JSON.stringify(diagramData.links || [])};
                
                diagram.nodeTemplate =
                    $(go.Node, "Auto",
                        $(go.Shape, "RoundedRectangle", { strokeWidth: 0, fill: "lightblue" }),
                        $(go.TextBlock,
                            { margin: 8, font: "bold 12px sans-serif" },
                            new go.Binding("text", "name"))
                    );

                diagram.linkTemplate =
                    $(go.Link,
                        { routing: go.Link.AvoidsNodes, corner: 5 },
                        $(go.Shape),
                        $(go.Shape, { toArrow: "Standard" })
                    );
                
                diagram.model = new go.GraphLinksModel(nodeDataArray, linkDataArray);
            } catch (e) {
                console.error("Error initializing GoJS diagram:", e);
                document.getElementById("myDiagramDiv").innerText = "Error initializing GoJS diagram: " + e.message;
            }
        }
    </script>
</body>
</html>`;
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
  getGoJsDisplayWebviewContent, // Export new function for GoJS display
  openFileAtLocation, // Exported for external use
  buildPromptFromSources, // Export new function
  generateMethodId, // Export new function
  getGoJsViewerWebviewContent // Export new function for GoJS viewer
};
