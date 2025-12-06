import assert from 'node:assert/strict';
import { buildInitialPromptPayload, buildFollowupPromptPayload, formatTurnsForPrompt } from './prompts.js';
import type { TurnSummary } from '../jsonl.js';

const SAMPLE_TURNS: TurnSummary[] = [
  {
    user: 'Primary prompt',
    agent: 'Main agent begins response line one.',
  },
  {
    user: 'Second user prompt',
    agent: 'Second agent reply',
  },
];

const SAMPLE_LATEST = SAMPLE_TURNS[SAMPLE_TURNS.length - 1];

// Test buildInitialPromptPayload
const initialPayload = buildInitialPromptPayload({
  sessionId: 'test-session-123',
  turns: SAMPLE_TURNS,
  latestTurnSummary: SAMPLE_LATEST,
});

assert.ok(initialPayload.prompt.includes('<conversation>'), 'initial prompt should include conversation wrapper');
assert.ok(initialPayload.prompt.includes('</conversation>'), 'initial prompt should close conversation wrapper');
assert.ok(initialPayload.promptText.includes('# Role'), 'initial prompt should include role section');
assert.ok(initialPayload.promptText.includes('Sage'), 'initial prompt should mention Sage');
assert.ok(initialPayload.promptText.includes('test-session-123'), 'initial prompt should include session ID');
assert.ok(initialPayload.contextText.includes('USER PROMPT'), 'context should include user prompt label');
assert.ok(initialPayload.contextText.includes('CLAUDE RESPONSE'), 'context should include Claude response label');

console.log('buildInitialPromptPayload tests passed');

// Test buildFollowupPromptPayload
const followupPayload = buildFollowupPromptPayload({
  sessionId: 'test-session-123',
  newTurns: SAMPLE_TURNS,
});

assert.ok(followupPayload.prompt.includes('<new_turns>'), 'followup prompt should include new_turns wrapper');
assert.ok(followupPayload.prompt.includes('</new_turns>'), 'followup prompt should close new_turns wrapper');
assert.ok(followupPayload.promptText.includes('# New Turn(s) to Review'), 'followup prompt should include new turns section');
assert.ok(followupPayload.promptText.includes('test-session-123'), 'followup prompt should include session ID');

// Test partial response notice
const partialPayload = buildFollowupPromptPayload({
  sessionId: 'test-session-123',
  newTurns: SAMPLE_TURNS,
  isPartial: true,
});

assert.ok(partialPayload.promptText.includes('# Partial Response Notice'), 'partial followup should include notice');

console.log('buildFollowupPromptPayload tests passed');

// Test formatTurnsForPrompt
const formattedTurns = formatTurnsForPrompt(SAMPLE_TURNS);

assert.ok(formattedTurns.includes('Turn 1'), 'formatted turns should include Turn 1 label');
assert.ok(formattedTurns.includes('Turn 2'), 'formatted turns should include Turn 2 label');
assert.ok(formattedTurns.includes('Primary prompt'), 'formatted turns should include first user prompt');
assert.ok(formattedTurns.includes('Second agent reply'), 'formatted turns should include second agent reply');

// Test partial turn formatting
const partialTurn: TurnSummary = {
  user: 'Partial prompt',
  agent: 'Partial response...',
  isPartial: true,
};
const formattedPartial = formatTurnsForPrompt([partialTurn]);
assert.ok(formattedPartial.includes('content may be incomplete'), 'partial turn should include incomplete notice');

console.log('formatTurnsForPrompt tests passed');

console.log('All agent prompts tests passed');
