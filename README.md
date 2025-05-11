# diagram-generator README

This is the README for your extension "diagram-generator". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

### Generate Mermaid Diagram (`diagram-generator.generateDiagram`)

This command opens a webview panel titled "Generate Mermaid Diagram". This panel is designed to help visualize call hierarchies within your Java code.

The webview page features:

*   A button labeled "Show Call Hierarchy Items":
    *   Clicking this button triggers a request to the extension to fetch the call hierarchy for the currently active position in your Java editor.
    *   A loading spinner is displayed while the data is being fetched.
    *   The fetched call hierarchy data (or an error message if the process fails) is then displayed in a read-only textarea.
*   A button labeled "Show Recursive Outgoing Calls":
    *   Clicking this button triggers a request to the extension to fetch and build a recursive call hierarchy starting from the item at the currently active position in your Java editor. This focuses on calls within the local project.
    *   A loading spinner is displayed while the data is being fetched and processed.
    *   The fetched recursive call hierarchy data (or an error message if the process fails) is then displayed in a separate read-only textarea.
*   A button labeled "Generate Mermaid Diagram Prompt":
    *   Clicking this button triggers a request to the extension to generate a text prompt suitable for creating a Mermaid sequence diagram. This prompt is based on the previously fetched recursive call hierarchy data.
    *   A loading spinner is displayed while the prompt is being generated.
    *   The generated prompt (or an error message if the process fails, for example, if the recursive call hierarchy hasn't been generated yet) is then displayed in a third read-only textarea.

This feature is accessible when a Java file is open and active in the editor. If no editor is active or the active file is not a Java file, an error message will be displayed.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Working with Markdown

You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
