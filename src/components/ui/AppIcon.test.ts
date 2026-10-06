import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppIcon, appMonogram } from './AppIcon'

describe('AppIcon', () => {
  it('uses the first grapheme, uppercased, with a fallback for an empty name', () => {
    expect(appMonogram(' e\u0301clair')).toBe('E\u0301')
    expect(appMonogram('')).toBe('?')
  })

  it('renders a decorative monogram in the project tint and ink', () => {
    const html = renderToStaticMarkup(createElement(AppIcon, { name: 'Tempo', color: 'blue', size: 'md' }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('size-8')
    expect(html).toContain('bg-p-blue-soft')
    expect(html).toContain('var(--t-p-blue)')
    expect(html).toContain('>T</span>')
  })
})
