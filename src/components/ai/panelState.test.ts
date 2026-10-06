import { beforeEach, describe, expect, it } from 'vitest'
import { openAIPanel, useUI } from '../uiState'

beforeEach(() => useUI.getState().closeAll())

describe('AI panel state', () => {
  it('opens through the exported helper without stopping a repo scan', () => {
    useUI.getState().setRepoPickerOpen(true)
    openAIPanel()
    expect(useUI.getState()).toMatchObject({ aiPanelOpen: true, repoPickerOpen: true })
    expect(useUI.getState().anyModalOpen()).toBe(true)
  })
})
