// Approved landing copy, shared by the classic and v2 designs.
import { aiMode, mcpEnabled } from '../../lib/aiMode'

/** Built with VITE_AI_MODE=mcp: Claude only, no AI keys, so the AI lines say that. */
const CLAUDE_ONLY = aiMode() === 'mcp'
/** VITE_AI_MODE=both: Claude (MCP) and the API key side by side; the AI lines say both. */
const CLAUDE_AND_KEY = mcpEnabled() && !CLAUDE_ONLY
export const HERO_BODY = 'Your teams build tools by the dozen, each one in an afternoon. Nobody keeps the list. Tempo reads your GitHub, writes down what every app does and who owns it, and puts the apps with no owner or an exposed key at the top.'
export const MICROLINE = 'Self-hosted · Read-only · Set up in 2 minutes'
export const NUMBERS = [
  { big: '2 minutes', text: 'from sign-in to your full list' },
  { big: '0 cards', text: 'to write. Tempo drafts them from your repos' },
  { big: '0 lines', text: 'of your code stored' },
  { big: '$0', text: 'for Tempo itself. It runs on your own accounts, every feature included' },
]
export const PROBLEMS = [
  'Three teams built the same expense tool.',
  'The person who built the onboarding app left. Nobody knows how to run it.',
  'An API key sits in a repo anyone can open.',
  'Nobody knows which apps changed this week.',
]
/** The problem section's closing pair: the first line clears the reader, the second names the gap. */
export const PROBLEM_CLOSE = ['Nobody did anything wrong.', "Nobody's keeping track."] as const
/** One short label per problem, in the colour of the flag Tempo raises for it (brand v2.1 lit cards). */
export const PROBLEM_TAGS = ['Duplicate', 'No owner', 'Exposed key', 'Changed']
export const BENEFITS = [
  { title: 'Every app on one card.', body: 'What it does and who owns it, written from the repo. Search by what the app does, not what someone named it.' },
  { title: 'Finds duplicates and apps gone quiet.', body: 'Tempo spots apps that do the same job and apps with no commits in 14 days. Merge them or switch them off.' },
  { title: 'Flags the risks, with the fix.', body: 'Each sync flags secret files left in repos and apps nobody owns. It tells you what to do next: rotate the key, then remove the file.' },
  { title: 'When people leave, their apps stay.', body: 'Tempo flags the app when its owner leaves and drafts a handover pack on request: how to run it and which keys to change.' },
  { title: 'See what changed.', body: 'Commits, pull requests and issues stay attached to the app they belong to.' },
]
export const STEPS = [
  { title: 'Sign in with GitHub.', body: 'You choose the repos. Access is read-only.' },
  { title: 'Tick your apps,', body: 'newest first.' },
  { title: 'Approve the cards.', body: "Tempo drafts each one. You keep what's right." },
]
/** After the list exists. Optional, so they sit below the three steps instead of posing as steps 4 to 6. */
export const LATER_STEPS = [
  CLAUDE_ONLY
    ? { title: 'Connect Claude.', body: 'It drafts and updates the cards. You check each one.' }
    : CLAUDE_AND_KEY
      ? { title: 'Connect Claude or add an API key.', body: 'Claude drafts the cards when you ask it to. A key lets Tempo write them on its own. You check each one.' }
      : { title: 'Pick your AI.', body: 'Claude, OpenAI, Gemini, Grok or a model on your own machine.' },
  { title: 'Invite the owners.', body: 'They sign in with GitHub and see their apps.' },
]
export const WHAT_YOU_GET = { title: 'Tempo writes your app\u00A0list and keeps it current.', body: 'Every app gets a card written from its repo. One click updates them all.' }
export const HOW_TITLE = "Your list in three steps. The rest when you're ready."
export const QUESTIONS = [
  { question: 'Does Tempo see our code?', answer: 'Tempo reads repo details, the README, commits, pull requests and issues. It never changes a repo or stores your code. Your GitHub token stays in your browser.' },
  CLAUDE_ONLY
    ? { question: 'Which AI does it use?', answer: 'Claude, the one you already use: on the web, the desktop app or Claude Code. You connect it once and Tempo holds no AI key. Tempo still builds the list without it.' }
    : CLAUDE_AND_KEY
      ? { question: 'Which AI does it use?', answer: 'Your choice. Connect Claude, the one you already use, and send it one message to write the cards. Or add your own AI key and Tempo writes them on its own whenever apps sync. Your key stays in your browser. Tempo still builds the list without either.' }
      : { question: 'Which AI does it use?', answer: 'Yours: Claude, OpenAI, Gemini, Grok, OpenRouter or a model on your own machine. Your AI key stays in your browser. Tempo still builds the list without one.' },
  { question: 'Can the AI change things on its own?', answer: 'No. Tempo drafts app cards from repo facts. You approve the cards.' },
  { question: 'Our apps are built in Lovable, Bolt or Replit. Does that work?', answer: 'Yes, once they sync to GitHub.' },
  { question: 'What does it cost?', answer: "Tempo itself is free: it runs on your own Supabase, Vercel and GitHub accounts, with every feature, any number of apps and people. Leave whenever you want: export everything and remove Tempo's access in GitHub." },
]
export const COST_INTRO = 'An app nobody needs still has a monthly hosting bill. Put in your own figures.'
export const COST_NOTE = 'Tempo lists the apps with no commits in 14 days, and the ones that do the same job, in 2 minutes. Free.'
