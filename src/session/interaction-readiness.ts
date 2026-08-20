import type { WorkbenchSnapshot } from './types.js'

export function promptUnavailableReason(snapshot: WorkbenchSnapshot): string | undefined {
  if (snapshot.phase !== 'connected' || snapshot.runtime.phase !== 'ready') {
    return 'Wait for the Harness runtime to finish connecting before sending.'
  }
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  if (active === undefined) return 'Wait for an active Harness session before sending.'
  if (active.operation !== undefined) return 'Wait for the current session operation to finish before sending.'
  if (snapshot.permissionChanging) return 'Wait for the file permission change to finish before sending.'
  if (active.running) return 'Wait for the current response to finish before sending another message.'
  if (snapshot.modelCatalog === undefined) return 'Wait for the model catalog to finish loading before sending.'
  if (snapshot.modelCatalog.routable === false) return 'Select an available model before sending.'
  return undefined
}

export function modelControlsUnavailableReason(snapshot: WorkbenchSnapshot): string | undefined {
  if (snapshot.phase !== 'connected' || snapshot.runtime.phase !== 'ready') return 'Models are available after the Harness runtime connects.'
  if (snapshot.modelCatalog === undefined) return 'The model catalog is still loading.'
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  if (active === undefined) return 'Models are available after an active Harness session is ready.'
  if (active?.running === true) return 'Finish or cancel the current response before changing the model.'
  if (active?.operation !== undefined) return 'Wait for the current session operation before changing the model.'
  if (snapshot.permissionChanging) return 'Wait for the file permission change before changing the model.'
  return undefined
}
