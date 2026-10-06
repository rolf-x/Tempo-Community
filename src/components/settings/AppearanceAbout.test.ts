import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AboutCard } from './AppearanceAbout'

it('describes Tempo in app language', () => {
  const html = renderToStaticMarkup(createElement(AboutCard))
  expect(html).toContain('Tempo: know every app your company vibe-coded.')
  expect(html).not.toContain('project manager that sets itself up')
})
