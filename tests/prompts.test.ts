/**
 * Unit tests for the prompt-injection safety (node --test).
 * DSH's system-prompt interpolator throws on unknown {{var}} references, so
 * activated templates must be escaped before injection.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safePromptText } from '../src/prompts.ts'

test('safePromptText rewrites {{var}} placeholders to {var}', () => {
  assert.equal(safePromptText('你是{{role}}。主题: {{topic}}'), '你是{role}。主题: {topic}')
})

test('safePromptText trims whitespace inside placeholders', () => {
  assert.equal(safePromptText('a {{ role }} b'), 'a {role} b')
})

test('safePromptText leaves plain text untouched', () => {
  assert.equal(safePromptText('没有占位符的正文'), '没有占位符的正文')
})

test('safePromptText leaves no "{{" trigger behind', () => {
  assert.ok(!safePromptText('{{a}} {{b}}').includes('{{'))
})
