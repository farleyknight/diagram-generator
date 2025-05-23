# diagram-generator

Visualizes Java call hierarchies and generates Mermaid diagrams within Visual Studio Code.

## Features

### Generate Mermaid Diagram (`diagram-generator.generateMermaidDiagram`)

This is the primary command of the extension. When a Java file is active in the editor, right-click and select "Diagram Generator: Generate Mermaid Diagram" from the context menu, or find it in the command palette. This opens a webview panel titled "Generate Mermaid Diagram" with the following functionalities:

*   **Show Call Hierarchy Items**:
    *   Fetches and displays the direct call hierarchy for the code at the current cursor position in your active Java editor.
    *   Useful for a quick look at immediate callers and callees.
*   **Get & Cache Recursive Call Hierarchy**:
    *   Fetches and builds a comprehensive, recursive call hierarchy starting from the item at the current cursor position.
    *   This focuses on calls within your local project.
    *   The fetched data is cached in the webview for use in other operations (like prompt generation).
    *   Displays the processed hierarchy data.
*   **Generate Mermaid Diagram Prompt**:
    *   Uses the cached recursive call hierarchy data to generate a textual prompt.
    *   You can select the type of diagram to generate a prompt for:
        *   **Sequence Diagram**: Shows interactions between classes/methods over time.
        *   **Flowchart Diagram**: Visualizes control flow.
        *   **Flowchart with Links**: A flowchart where nodes can be clicked to navigate to the source code.
    *   The generated prompt is displayed in a textarea, ready for the next step.
*   **Generate Diagram with Claude AI**:
    *   Takes the generated (or manually edited) prompt from the textarea.
    *   Sends this prompt to a Claude AI language model (requires appropriate VS Code setup and access to `claude-3.5-sonnet` family models).
    *   Streams the AI-generated Mermaid diagram code back into another textarea.
    *   Progress messages are displayed throughout this process.
*   **Display Mermaid Diagram**:
    *   Once the Mermaid diagram code is generated by Claude AI, a button appears to open it in a new webview panel.
    *   This new panel renders the actual diagram.
    *   **Interactive Features in Diagram Display**:
        *   **View Source**: Shows the Mermaid code used to render the diagram.
        *   **View Prompt**: Shows the prompt that was used to generate the diagram.
        *   **Zoom and Pan**: Controls to zoom in/out and pan the diagram for better viewing.
        *   **Clickable Nodes (for Sequence and Flowchart-links diagrams)**: If the diagram type supports it and was generated with link information, clicking on class/participant nodes in the diagram will open the corresponding Java file in your editor and navigate to the relevant line.

This entire workflow is designed to be initiated from an active Java editor. Error messages will guide you if the context is incorrect (e.g., no Java file open, or issues with AI model access).

### Show Java File Links (`diagram-generator.showLinks`)

This command provides a simpler view that lists Java files in your workspace and creates links to open them. (This is an older feature and less central than the diagram generation workflow).

## Requirements

*   Java language support in VS Code.
*   For the AI-powered diagram generation:
    *   VS Code version that supports the Language Model API (`vscode.lm`).
    *   Access to a language model compatible with the `claude-3.5-sonnet` family, properly configured in your VS Code.

## Extension Settings

This extension does not currently contribute any specific VS Code settings.

## Known Issues

*   The accuracy and quality of the AI-generated diagram depend heavily on the quality of the prompt and the capabilities of the language model.
*   Recursive call hierarchy generation might be slow or resource-intensive for very large call trees.
*   External library calls are identified but not deeply analyzed for their internal structure.

## Release Notes

Users appreciate release notes as you update your extension.

### 0.0.1 (and subsequent unreleased changes)

*   Initial release with basic Java file listing.
*   Added core functionality for generating Mermaid diagrams from Java call hierarchies.
*   Implemented call hierarchy fetching (direct and recursive).
*   Added prompt generation for various Mermaid diagram types (sequence, flowchart, flowchart-links).
*   Integrated with Claude AI (claude-3.5-sonnet) for diagram code generation from prompts, including streaming responses.
*   Developed a separate webview for displaying rendered Mermaid diagrams with features like zoom/pan, view source, view prompt, and clickable nodes for code navigation.
*   Improved error handling and progress updates in the webviews.
