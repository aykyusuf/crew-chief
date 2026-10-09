// Run: node --test tests/saver-i18n.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ENGLISH_WORDS,
  LANGUAGES,
  MESSAGES,
  classifyText,
  languageFromName,
  majority,
  pickLanguage,
  stripCode,
  t,
  TURKISH_WORDS,
  unitsFor,
  windowName,
} from '../hooks/saver-i18n.mjs'

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('every language has exactly the English keys and placeholders', () => {
  assert.deepEqual(LANGUAGES.sort(), ['en', 'tr'])
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(MESSAGES[lang]).sort(), Object.keys(MESSAGES.en).sort(), `${lang}: keys`)
    for (const key of Object.keys(MESSAGES.en)) {
      assert.deepEqual(placeholders(MESSAGES[lang][key]), placeholders(MESSAGES.en[key]), `${lang}.${key}: placeholders`)
      assert.ok(MESSAGES[lang][key].length > 0, `${lang}.${key}: empty`)
    }
  }
})

test('the three answer labels differ within each language (they are matched by text)', () => {
  for (const lang of LANGUAGES) {
    const labels = [MESSAGES[lang].answer_on, MESSAGES[lang].answer_not_now, MESSAGES[lang].answer_never]
    assert.equal(new Set(labels).size, 3, lang)
  }
})

test('t fills placeholders and falls back to English', () => {
  assert.equal(t('tr', 'toast_context', { tokens: '160k' }).includes('160k'), true)
  assert.equal(t('xx', 'answer_on'), 'Turn on saver')
  assert.equal(t('tr', 'no_such_key'), 'no_such_key')
  assert.equal(t('en', 'reset_in', {}), ' It resets in {duration}.')
  assert.equal(t('en', 'toast_cap', { model: 'Opus', from: 'xhigh', to: 'medium' }), 'Saver: Opus subagent effort xhigh -> medium')
  assert.equal(t('tr', 'ask', { window: windowName('tr', 'five_hour'), percent: 72, reset: '' }).startsWith('5 saatlik limitin %72 dolu.'), true)
})

test('percent is written the way each language writes it', () => {
  assert.equal(t('en', 'percent', { n: 30 }), '30%')
  assert.equal(t('tr', 'percent', { n: 30 }), '%30')
})

test('windowName and unitsFor', () => {
  assert.equal(windowName('en', 'five_hour'), '5-hour')
  assert.equal(windowName('tr', 'seven_day'), 'haftalık')
  assert.equal(windowName('tr', 'spend_limit'), 'spend_limit')
  assert.deepEqual(unitsFor('tr'), { d: 'g', h: 'sa', m: 'dk', lt: '<1dk' })
  assert.deepEqual(unitsFor('zz'), { d: 'd', h: 'h', m: 'm', lt: '<1m' })
})

test('classifyText: Turkish', () => {
  for (const text of [
    'tamam yaz bakalım',
    'bunu düzelt lütfen',
    'Bu özelliği ekle ve test et',
    'kullanıcı hangi dille konuşuyorsa onu anlasın',
    'şimdi çalıştır',
    'ııı',
    'İyi günler',
    'İYİ GÜNLER',
    'çalıştır',
  ]) assert.equal(classifyText(text), 'tr', text)
})

test('classifyText: English', () => {
  for (const text of ['please fix the failing test', 'can you add this to the README', 'what is going on with the build']) {
    assert.equal(classifyText(text), 'en', text)
  }
})

test('classifyText: too short, mixed, code, commands decide nothing', () => {
  for (const text of ['', '  ', 'hi', 'ok', '/saver on', '/crew-chief:crew-mode solo', 'git status', 'npm test', '{"a":1}', undefined, null, 42]) {
    assert.equal(classifyText(text), undefined, String(text))
  }
  assert.equal(classifyText('ok the'), undefined, 'one word is not enough')
})

test('classifyText: German and French umlauts are not Turkish evidence', () => {
  assert.equal(classifyText('Können Sie das für mich prüfen'), undefined)
  assert.equal(classifyText('où est le déjà vu, français'), undefined)
})

test('classifyText: other languages that share short words with Turkish are never Turkish', () => {
  for (const text of [
    'Je ne sais pas, ne touche pas',
    'Puoi dirmi se mi serve? Ne ho bisogno',
    'Arregla mi código y ve si funciona',
    'ik ben klaar, ben je er?',
    'Ich habe es ihm gesagt, aber er war sauer',
    'ne var ne yok',
  ]) assert.notEqual(classifyText(text), 'tr', text)
})

test('classifyText: a Turkish name in English text is not Turkish', () => {
  for (const text of ['Ping Ayşe about it', 'Ask Barış to review the PR', 'Thanks Çağrı, see Işık for the rest']) {
    assert.notEqual(classifyText(text), 'tr', text)
  }
  assert.equal(classifyText('please ask Barış to review the PR and fix the failing test'), 'en')
})

test('classifyText: a Turkish sentence around a pasted English error is Turkish', () => {
  assert.equal(
    classifyText('Lütfen bu hatayı düzelt: TypeError: cannot read property of undefined in the function that is called from the main file'),
    'tr',
  )
})

test('classifyText: code, stack traces and fenced blocks are not prose', () => {
  assert.equal(classifyText('const a = 1;\nfor (const x of y) { if (x) return }'), undefined)
  assert.equal(classifyText('Traceback (most recent call last):\n  File "a.py", line 3, in <module>\n    foo()\nNameError: name x is not defined'), undefined)
  assert.equal(classifyText('    at Object.<anonymous> (/app/index.js:3:9)\n    at Module._compile (node:internal/modules/cjs/loader:1)'), undefined)
  assert.equal(classifyText('```py\nif not this and that:\n    print(1)\n```'), undefined)
  assert.equal(classifyText('```py\nprint(1)\n```\nbunu düzelt lütfen'), 'tr')
  assert.equal(stripCode('keep this\n```\ndrop\n```\nand this'), 'keep this\nand this')
})

test('the awk word lists in plugin-notices.sh are the JS word lists', () => {
  const sh = readFileSync(new URL('../scripts/plugin-notices.sh', import.meta.url), 'utf8')
  const lists = [...sh.matchAll(/n = split\("([^"]+)", [ab], " "\)/g)].map((m) => new Set(m[1].split(' ')))
  assert.equal(lists.length, 2)
  assert.deepEqual([...lists[0]].sort(), [...TURKISH_WORDS].sort())
  assert.deepEqual([...lists[1]].sort(), [...ENGLISH_WORDS].sort())
})

test('classifyText: a Turkish prompt full of English tech words is still Turkish', () => {
  assert.equal(classifyText('commit at ve push et, sonra test çalıştır'), 'tr')
  assert.equal(classifyText('bu fonksiyonu refactor et ve test yaz'), 'tr')
  assert.equal(classifyText('bu fonksiyonu refactor et'), 'tr')
})

test('majority', () => {
  assert.equal(majority([]), undefined)
  assert.equal(majority(['tr']), 'tr')
  assert.equal(majority(['tr', 'en']), undefined)
  assert.equal(majority(['en', 'tr', 'tr', 'en', 'tr']), 'tr')
  assert.equal(majority(['en', 'en', 'tr']), 'en')
})

test('languageFromName', () => {
  for (const n of ['tr', 'TR', 'turkish', 'Turkish', 'türkçe', 'TÜRKÇE', 'Türkçe', 'Turkce', ' turkish ']) assert.equal(languageFromName(n), 'tr', n)
  for (const n of ['en', 'english', 'English', 'ingilizce']) assert.equal(languageFromName(n), 'en', n)
  for (const n of ['japanese', 'french', 'turkmen', 'Türkmençe', 'trinidad', '', undefined, null, 5]) assert.equal(languageFromName(n), undefined, String(n))
})

test('pickLanguage follows the agreed order', () => {
  assert.deepEqual(pickLanguage({}), { lang: 'en', source: 'default' })
  assert.deepEqual(pickLanguage({ locale: 'tr_TR.UTF-8' }), { lang: 'tr', source: 'locale' })
  assert.deepEqual(pickLanguage({ locale: 'en_US.UTF-8' }), { lang: 'en', source: 'default' })
  assert.deepEqual(pickLanguage({ locale: 'tr_TR.UTF-8', stored: 'en' }), { lang: 'en', source: 'stored' })
  assert.deepEqual(pickLanguage({ stored: 'tr', votes: [] }), { lang: 'tr', source: 'stored' })
  assert.deepEqual(pickLanguage({ stored: 'en', votes: ['tr', 'tr'] }), { lang: 'tr', source: 'prompts' })
  assert.deepEqual(pickLanguage({ votes: ['tr', 'tr'], setting: 'english' }), { lang: 'en', source: 'setting' })
  assert.deepEqual(pickLanguage({ votes: ['en'], setting: 'japanese', locale: 'tr_TR' }), { lang: 'en', source: 'prompts' })
  assert.deepEqual(pickLanguage({ setting: 'turkish', override: 'en' }), { lang: 'en', source: 'override' })
  assert.deepEqual(pickLanguage({ override: 'klingon', setting: 'turkish' }), { lang: 'tr', source: 'setting' })
  assert.deepEqual(pickLanguage({ stored: 'xx', locale: 'trx' }), { lang: 'en', source: 'default' })
})
