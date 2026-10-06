import type { Provider } from '../types'

export interface AIErrorCopy {
  message: string
  details: string
}

const rawMessage = (error: unknown) => {
  if (error instanceof Error) {
    const details = 'details' in error && typeof error.details === 'string' ? error.details : error.message
    return details.trim() || error.message || 'Unknown AI error'
  }
  return typeof error === 'string' && error.trim() ? error.trim() : 'Unknown AI error'
}

/** One recovery sentence for the UI, with the untouched diagnostic kept for its Details disclosure. */
export function explainAIError(error: unknown, provider?: Provider): AIErrorCopy {
  const details = rawMessage(error)
  const text = details.toLowerCase()

  if (/zoderror|invalid_type|validation (?:failed|error)|didn't (?:answer|match).*expected (?:format|shape)|expected shape/.test(text)) {
    return { message: 'The AI answered in a format Tempo could not use; try again.', details }
  }
  if (
    /spawn[^\n]*enoent|enoent[^\n]*spawn|could not start claude|local bridge|\/api\/claude|econnrefused|connection refused|fetch failed[^\n]*(?:localhost|127\.0\.0\.1)/.test(text)
    || provider === 'local' && /failed to fetch|couldn't reach|networkerror|network request failed|forbidden/.test(text)
  ) {
    return { message: 'The local AI bridge is unavailable; start Tempo locally and make sure Claude Code is installed.', details }
  }
  if (/timeout|timed out|too long|aborterror|\baborted\b/.test(text)) {
    return { message: 'The AI took too long to answer; try again.', details }
  }
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|(?:api )?key[^\n]*(?:invalid|rejected)|didn't accept this key/.test(text)) {
    return { message: 'The AI provider rejected the API key; check it in Settings and try again.', details }
  }
  if (/\b429\b|rate.?limit|busy\. try again in a minute/.test(text)) {
    return { message: 'The AI provider is rate-limiting requests; wait a moment and try again.', details }
  }
  if (/out of credit|insufficient[_ -]?quota|credit balance|billing/.test(text)) {
    return { message: 'The AI account is out of credit; add credit and try again.', details }
  }
  if (/can't reach ollama|cannot reach ollama/.test(text)) {
    return { message: 'Tempo could not reach Ollama; start it and try again.', details }
  }
  return { message: 'The AI request failed; try again or check the connection in Settings.', details }
}
