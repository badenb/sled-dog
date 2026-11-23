import { describe, expect, it } from 'vitest'
import { escapeLike, highlightSegments, likePattern, matchedIn, refOf, snippet, tokenize } from '../shared/search'

describe('tokenize', () => {
  it('splits words and keeps quoted phrases together', () => {
    expect(tokenize('login redirect')).toEqual(['login', 'redirect'])
    expect(tokenize('"login redirect" safari')).toEqual(['login redirect', 'safari'])
    expect(tokenize('  spaced    out  ')).toEqual(['spaced', 'out'])
  })
  it('runs an unclosed quote to the end', () => {
    expect(tokenize('fix "third party cookies')).toEqual(['fix', 'third party cookies'])
  })
  it('drops empty phrases and duplicates, ignoring case', () => {
    expect(tokenize('"" a')).toEqual(['a'])
    expect(tokenize('Login login LOGIN')).toEqual(['Login'])
  })
  it('returns nothing for an empty or whitespace-only query', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
  it('keeps punctuation inside a term (it is only ever data)', () => {
    expect(tokenize(`it's 100% a_b ' OR 1=1 --`)).toEqual(["it's", '100%', 'a_b', "'", 'OR', '1=1', '--'])
  })
})

describe('LIKE escaping', () => {
  it('makes %, _ and backslash match themselves', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('c:\\dir')).toBe('c:\\\\dir')
    expect(escapeLike('plain')).toBe('plain')
  })
  it('builds a lowercase contains-pattern', () => {
    expect(likePattern('Login_Redirect%')).toBe('%login\\_redirect\\%%')
  })
})

describe('refOf', () => {
  it('reads ticket and subtask references, with or without the prefix for a plain number', () => {
    expect(refOf('SD-12')).toEqual({ ticket: 12, subtask: null })
    expect(refOf('sd-12.2')).toEqual({ ticket: 12, subtask: 2 })
    expect(refOf('12')).toEqual({ ticket: 12, subtask: null })
  })
  it('treats a bare dotted number as text (a version), not a subtask', () => {
    expect(refOf('3.14')).toBeNull()
    expect(refOf('1.2.3')).toBeNull()
  })
  it('does not read other words as references', () => {
    for (const t of ['XSD-12', 'SD-', 'SD12', 'sd-12x', '12a', 'login', 'SD-1.']) expect(refOf(t), t).toBeNull()
  })
})

describe('snippet', () => {
  const body = 'Safari blocks third-party cookies, so the login redirect loops forever until the cookie is set on the first-party domain.'
  it('shows the text around the first match, with ellipses where it was cut', () => {
    const s = snippet(body, ['redirect'], 60)!
    expect(s).toContain('redirect')
    expect(s.startsWith('…')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(64)
  })
  it('matches ignoring case, and uses the earliest of several terms', () => {
    expect(snippet(body, ['DOMAIN', 'safari'], 40)).toMatch(/^Safari/)
  })
  it('returns null when nothing matches, and collapses whitespace', () => {
    expect(snippet(body, ['nothing-here'])).toBeNull()
    expect(snippet('a\n\n  b\tc', ['b'])).toBe('a b c')
  })
})

describe('matchedIn', () => {
  const ticket = {
    number: 12, title: 'Fix login redirect', body: 'Cookies are blocked.', assignee: 'baden',
    subtasks: [{ ref: 'SD-12.1', title: 'API changes', assignee: 'dana', pullRequests: [{ number: 50, title: 'Add checkout endpoint', key: 'acme/web#50' }] }],
    steps: [{ title: 'Design review' }, { title: 'QA' }],
    pullRequests: [{ number: 41, title: 'Safari workaround', key: 'acme/web#41' }],
  }
  it('lists every part of the ticket that contains a term, the ticket first', () => {
    expect(matchedIn(ticket, ['login'])).toEqual(['title'])
    expect(matchedIn(ticket, ['cookies'])).toEqual(['description'])
    expect(matchedIn(ticket, ['baden'])).toEqual(['assignee'])
  })
  it('finds matches inside subtasks, steps and pull requests', () => {
    expect(matchedIn(ticket, ['api'])).toEqual(['subtask SD-12.1'])
    expect(matchedIn(ticket, ['checkout'])).toEqual(['subtask SD-12.1']) // via the subtask's PR
    expect(matchedIn(ticket, ['design'])).toEqual(['step "Design review"'])
    expect(matchedIn(ticket, ['safari'])).toEqual(['pull request #41'])
  })
  it('finds a PR by its repo and number', () => {
    expect(matchedIn(ticket, ['web#41'])).toEqual(['pull request #41'])
  })
  it('reports a reference match, and requires the subtask to exist for SD-n.m', () => {
    expect(matchedIn(ticket, ['SD-12'])).toEqual(['reference'])
    expect(matchedIn(ticket, ['SD-12.1'])).toEqual(['reference'])
    expect(matchedIn(ticket, ['SD-12.9'])).toEqual([])
    expect(matchedIn(ticket, ['SD-13'])).toEqual([])
  })
  it('combines several terms and fields', () => {
    expect(matchedIn(ticket, ['login', 'cookies', 'qa'])).toEqual(['title', 'description', 'step "QA"'])
  })
  it('says nothing for no match', () => {
    expect(matchedIn(ticket, ['zebra'])).toEqual([])
  })
})


describe('highlightSegments', () => {
  const joined = (segments: { text: string }[]) => segments.map(s => s.text).join('')
  it('marks every occurrence of a term, ignoring case, and loses no text', () => {
    const segments = highlightSegments('Fix Login redirect; login again', ['login'])
    expect(segments.filter(s => s.hit).map(s => s.text)).toEqual(['Login', 'login'])
    expect(joined(segments)).toBe('Fix Login redirect; login again')
  })
  it('handles several terms, preferring the longer match where they overlap', () => {
    const segments = highlightSegments('login redirect', ['log', 'login', 'redirect'])
    expect(segments.filter(s => s.hit).map(s => s.text)).toEqual(['login', 'redirect'])
  })
  it('treats regex characters in a term as plain text', () => {
    expect(highlightSegments('price is (100%) [ok] a.b', ['(100%)', '[ok]', 'a.b']).filter(s => s.hit).map(s => s.text)).toEqual(['(100%)', '[ok]', 'a.b'])
    expect(highlightSegments('abc', ['.']).some(s => s.hit)).toBe(false) // "." is a dot, not "any character"
    expect(highlightSegments('a+b', ['+']).filter(s => s.hit).map(s => s.text)).toEqual(['+'])
  })
  it('is plain text out: markup in a title stays text', () => {
    const segments = highlightSegments('<img src=x onerror=alert(1)> login', ['login'])
    expect(joined(segments)).toBe('<img src=x onerror=alert(1)> login')
    expect(segments.find(s => s.hit)!.text).toBe('login')
  })
  it('returns the text untouched for no terms, no match, or empty text', () => {
    expect(highlightSegments('hello', [])).toEqual([{ text: 'hello', hit: false }])
    expect(highlightSegments('hello', ['zzz'])).toEqual([{ text: 'hello', hit: false }])
    expect(highlightSegments('', ['a'])).toEqual([{ text: '', hit: false }])
    expect(highlightSegments('hello', ['', '  '])).toEqual([{ text: 'hello', hit: false }])
  })
  it('keeps positions right for text whose lowercase form has a different length', () => {
    const text = 'İstanbul login'
    expect(highlightSegments(text, ['login']).map(s => s.text).join('')).toBe(text)
    expect(highlightSegments(text, ['login']).find(s => s.hit)!.text).toBe('login')
  })
})
