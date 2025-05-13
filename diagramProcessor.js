const vscode = require('vscode');
const path = require('path');

/**
 * Recursively collects all non-empty sources, filenames, class names and annotations from hierarchy data
 * @param {object} data The hierarchy data object
 * @param {Array<{source: string, filename: string, className: string, methodNameSignature: string, classAnnotations: string, startLine: number}>} sources Array to collect data into
 */
function collectSources(data, sources) {
  if (data.source && typeof data.source === 'string' && data.source.trim()) {
    sources.push({
      source: data.source.trim(),
      filename: data.location.file,
      className: data.detail || 'Unknown Class',
      methodNameSignature: data.name || 'unknownMethod',
      classAnnotations: data.classAnnotations || '',
      startLine: data.location.startLine // Add startLine
    });
  }

  if (data.outgoingCalls && Array.isArray(data.outgoingCalls)) {
    for (const call of data.outgoingCalls) {
      collectSources(call, sources);
    }
  }
}

/**
 * Adds links to Mermaid code based on call hierarchy data.
 * @param {object} callHierarchyData The call hierarchy data.
 * @param {function(string, string): string} generateMethodId Function to generate method IDs.
 * @param {vscode.Webview} webview The webview to post messages to.
 * @param {string} coreMermaidContent The core Mermaid content to modify.
 * @returns {string} The modified Mermaid content with links.
 */
function addLinksFromCallHierarchy(callHierarchyData, generateMethodId, webview, coreMermaidContent) {
  if (!callHierarchyData) {
    webview.postMessage({ command: 'updateProgressStatus', payload: 'Call hierarchy data not found; cannot add links.' });
    return coreMermaidContent;
  }

  const sourcesForLinks = [];
  collectSources(callHierarchyData, sourcesForLinks);

  if (sourcesForLinks.length === 0) {
    webview.postMessage({ command: 'updateProgressStatus', payload: 'No source data collected from call hierarchy; cannot add links.' });
    return coreMermaidContent;
  }

  const linkDefinitions = sourcesForLinks.reduce((acc, sourceItem) => {
    const { filename, className, methodNameSignature, startLine } = sourceItem; // Include startLine
    if (filename && className && methodNameSignature) {
      const methodId = generateMethodId(className, methodNameSignature);
      const baseFilename = path.basename(filename);
      const absoluteFilePath = path.resolve(filename);
      // Ensure each ID is unique if multiple sources map to the same ID
      if (!acc.find(def => def.id === methodId)) {
        acc.push({
          id: methodId,
          filePath: absoluteFilePath,
          baseFilename: baseFilename,
          startLine: startLine // Add startLine
        });
      }
    }
    return acc;
  }, []);

  if (linkDefinitions.length === 0) {
    webview.postMessage({ command: 'updateProgressStatus', payload: 'No valid link definitions generated from call hierarchy.' });
    return coreMermaidContent;
  }

  const generateLinkStringCallback = (linkDef) => {
    // Add 1 to startLine because VS Code links are 1-based, and Mermaid might be 0-based
    const lineNumberForLink = linkDef.startLine !== undefined ? `:${linkDef.startLine + 1}` : '';
    return `click ${linkDef.id} href "vscode://file/${linkDef.filePath}${lineNumberForLink}" "Open ${linkDef.baseFilename}"`;
  };

  // Temporarily wrap coreMermaidContent with backticks for addLinksToMermaidDiagram
  const fullDiagramForLinking = coreMermaidContent;  
  let updatedFullDiagram = addLinksToMermaidDiagram(fullDiagramForLinking, linkDefinitions, generateLinkStringCallback);

  // Strip the temporary backticks to get the updated coreMermaidContent
  updatedFullDiagram = updatedFullDiagram
    .replace(/^```mermaid\n/, '')
    .replace(/\n```$/, '');

  webview.postMessage({ command: 'updateProgressStatus', payload: 'Clickable links added to the diagram.' });
  return updatedFullDiagram;
}

/**
 * Adds link sections to the bottom of a Mermaid diagram
 *
 * @param {string} diagram - The complete Mermaid diagram including backticks
 * @param {Array<object>} linkDefinitions - Array of objects, each containing data needed to build a link
 * @param {Function} generateLinkStringCallback - Function that takes a linkDefinition and returns a link string
 * @returns {string} - The updated diagram with links added
 */
function addLinksToMermaidDiagram(diagram, linkDefinitions, generateLinkStringCallback) {
  // Find where to insert the links (before the closing backticks)
  const diagramContentEndIndex = diagram.lastIndexOf('```');
  
  if (diagramContentEndIndex === -1) {
    console.warn("Invalid diagram format: Missing closing backticks");
    // If no backticks, append directly to the content
    const links = linkDefinitions
      .map(def => generateLinkStringCallback(def))
      .filter(link => link !== null && link !== undefined)
      .join('\n');
    return links ? `${diagram}\n${links}` : diagram;
  }
  
  // Generate links for each link definition and filter out any nulls
  const links = linkDefinitions
    .map(def => generateLinkStringCallback(def))
    .filter(link => link !== null && link !== undefined)
    .join('\n    '); // Ensure proper indentation
  
  // If we have links to add, append them to the diagram before the closing backticks
  if (links) {
    // Split the diagram into content and closing backticks
    const contentPart = diagram.substring(0, diagramContentEndIndex);
    const closingBackticks = diagram.substring(diagramContentEndIndex);
    
    // Add links before the closing backticks with proper indentation
    return `${contentPart.trimEnd()}\n    ${links}\n${closingBackticks}`;
  } else {
    return diagram;
  }
}

/**
 * Helper function for 'cleanupAndAddLinks'
 * @param {any} message The message object from the webview
 * @param {vscode.WebviewPanel} panel The webview panel
 * @param {(classNameDetail: string, methodNameSignature: string) => string} generateMethodId Function to generate method IDs
 */
async function handleCleanupAndAddLinks(message, panel, generateMethodId) {
  try {
    const mermaidCodeFromPayload = message.payload.mermaidCode;
    if (!mermaidCodeFromPayload || mermaidCodeFromPayload.trim() === '') {
      panel.webview.postMessage({ command: 'cleanupAndAddLinksError', payload: 'Mermaid code is empty. Cannot process.' });
      return;
    }

    let coreMermaidContent;
    let prefix = '';
    let suffix = '';

    const backtickRegex = /^(\\s*\\`\\`\\`mermaid\\s*\\n?)([\\s\\S]*?)(\\n?\\s*\\`\\`\\`\\s*)$/;
    const match = mermaidCodeFromPayload.match(backtickRegex);

    if (match) {
      prefix = match[1];
      coreMermaidContent = match[2];
      suffix = match[3];
    } else {
      coreMermaidContent = mermaidCodeFromPayload;
    }

    // Add quotes around strings in brackets if not already quoted
    coreMermaidContent = coreMermaidContent.replace(/\[(.*?)\]/g, (match, contentOriginal) => {
      const content = contentOriginal.trim();
      if ((content.startsWith('"') && content.endsWith('"')) || (content.startsWith('("') && content.endsWith('")'))) {
        return `[${contentOriginal}]`;
      }
      if (content.startsWith('[') && content.endsWith(']')) {
        return `[${contentOriginal}]`;
      }
      return `["${content}"]`;
    });

    // Remove trailing whitespace from each line of the core content
    coreMermaidContent = coreMermaidContent.split('\n').map(line => line.trimEnd()).join('\n');

    // Add links based on call hierarchy data
    coreMermaidContent = addLinksFromCallHierarchy(panel.webview.callHierarchyData, generateMethodId, panel.webview, coreMermaidContent);

    // Reassemble the full code, placing modified coreContent back within prefix/suffix if they existed
    const finalProcessedMermaidCode = prefix + coreMermaidContent + suffix;

    panel.webview.postMessage({ command: 'cleanupAndAddLinksData', payload: finalProcessedMermaidCode });
    panel.webview.postMessage({ command: 'updateProgressStatus', payload: 'Diagram cleaned and links processed. Ready for display or further LLM processing.' });

  } catch (e) {
    console.error('Error in cleanupAndAddLinks:', e);
    vscode.window.showErrorMessage('Error processing Mermaid diagram for cleanup.');
    panel.webview.postMessage({ command: 'cleanupAndAddLinksError', payload: `Error processing diagram: ${e.message}` });
  }
}

module.exports = {
  handleCleanupAndAddLinks,
  collectSources,
  addLinksFromCallHierarchy,
  addLinksToMermaidDiagram
};
