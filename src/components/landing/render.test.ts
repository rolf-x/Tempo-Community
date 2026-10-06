import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LandingView from '../../views/LandingView'
import { HeartbeatLine } from './Signal'
import { ProblemStory } from './ProblemStory'
import { PROBLEMS, PROBLEM_CLOSE } from './copy'

// Exercise the complete component trees: renamed sample lookups must resolve, and
// section labels must still refer to a unique heading after the section changes.
describe('landing', () => {
  it('renders its sample visuals and gives every section a valid heading', () => {
    const html = renderToStaticMarkup(createElement(LandingView))
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    const sections = [...html.matchAll(/<section\b[^>]*aria-labelledby="([^"]+)"/g)]
    expect(sections).toHaveLength(8)
    for (const [, id] of sections) expect(html).toMatch(new RegExp(`<h[12] id="${id}"`))
    expect(html).toContain('Halden Freight')
    expect(html).toContain('Sample data')
    expect(html).not.toContain('undefined')
  })
})

it('draws the heartbeat path exactly and isolates each gradient', () => {
  // The generator, verbatim: four beats repeating every 250 units across 1000.
  let expectedPath = 'M0 60'
  for (let x = 0; x < 1000; x += 250) {
    expectedPath += ' L' + (x + 70) + ' 60 Q' + (x + 82) + ' 50 ' + (x + 94) + ' 60 L' + (x + 112) + ' 60 L' + (x + 118) + ' 68 L' + (x + 128) + ' 14 L' + (x + 138) + ' 104 L' + (x + 146) + ' 60 L' + (x + 168) + ' 60 Q' + (x + 186) + ' 40 ' + (x + 204) + ' 60 L' + (x + 250) + ' 60'
  }
  const html = renderToStaticMarkup(createElement('div', null, createElement(HeartbeatLine), createElement(HeartbeatLine)))
  const paths = [...html.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)]
  expect(paths).toHaveLength(4)
  paths.forEach(([, path]) => expect(path).toBe(expectedPath))
  expect(html.match(/viewBox="0 0 1000 120" preserveAspectRatio="none"/g)).toHaveLength(2)
  expect(html.match(/pathLength="1000"/g)).toHaveLength(2)
  const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map(([, id]) => id)
  expect(new Set(ids).size).toBe(2)
  ids.forEach((id) => expect(html).toContain(`stroke="url(#${id})"`))
})

it('keeps all approved problem statements verbatim and the closing line last', () => {
  const html = renderToStaticMarkup(createElement(ProblemStory))
  const paragraphs = [...html.matchAll(/<p class="signal-problem-line">(.*?)<\/p>/g)].map(([, line]) => line.replaceAll('&quot;', '"').replaceAll('&#x27;', "'"))
  expect(paragraphs).toEqual(PROBLEMS)
  expect(html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'")).toContain(PROBLEM_CLOSE.join(' '))
  expect(html.indexOf('signal-problem-close')).toBeGreaterThan(html.lastIndexOf('signal-problem-line'))
  expect(html.match(/class="signal-vignette" aria-hidden="true"/g)).toHaveLength(4)
})
