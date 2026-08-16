// Expose only the host state used by service-level tests. Other accidental API use
// still fails loudly instead of silently behaving unlike VS Code.
export const workspace = { workspaceFolders: undefined }
