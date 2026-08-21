# DeDge DeepSeek Harness v0.1.12

This test build focuses on compact, predictable sidebar interaction.

## Changes

- Added a title-bar close button and `Esc` handling to the embedded settings panel.
- Reserved a stable 24 px slot for the Vision model button so long Harness model labels cannot push it out of the composer.
- Collapsing an Assistant, User, or System message segment now also hides the following reasoning and tool entries. Expanding the segment restores the individual nested detail controls.

## Compatibility

- Bundled DeepSeek Harness: `0.1.0-rc.7`
- Test target: Windows 10/11 x64
- API keys remain in VS Code SecretStorage and are not packaged in the VSIX.
