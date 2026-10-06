import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { useSession } from '../data/session'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); useSession.setState({ status: 'off' }) })

describe('ErrorBoundary', () => {
  it('renders its children before an error', () => {
    expect(renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', null, 'App card')))).toContain('App card')
  })

  it('renders recovery after a throwing child and logs the error', () => {
    const error = new Error('Broken page')
    const Throw = () => { throw error }
    const boundary = new ErrorBoundary({ children: createElement(Throw) })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Node has no DOM renderer. Exercise React's error lifecycle explicitly;
    // server rendering itself does not invoke error boundaries.
    expect(() => renderToStaticMarkup(boundary.render())).toThrow(error)
    boundary.state = ErrorBoundary.getDerivedStateFromError()
    const info = { componentStack: '\n    at Throw' }
    boundary.componentDidCatch(error, info)
    const html = renderToStaticMarkup(boundary.render())
    expect(html).toContain('Something broke on this page. Your data is safe.')
    expect(html).toContain('Reload')
    expect(html).toContain('Go to your apps')
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('Tempo page failed', error, info)
  })

  it.each([['signed-in', '#/portfolio'], ['signed-out', '#/']] as const)('sends %s users to %s', (status, hash) => {
    const reload = vi.fn()
    const location = { hash: '#/settings', reload }
    vi.stubGlobal('window', { location })
    useSession.setState({ status })
    const boundary = new ErrorBoundary({ children: null })
    boundary.state = ErrorBoundary.getDerivedStateFromError()
    const fallback = boundary.render() as ReturnType<ErrorBoundary['render']> & { props: { children: [unknown, { props: { children: { props: { onClick: () => void } }[] } }] } }
    const buttons = fallback.props.children[1].props.children
    buttons[0].props.onClick()
    expect(reload).toHaveBeenCalledOnce()
    buttons[1].props.onClick()
    expect(location.hash).toBe(hash)
  })
})
