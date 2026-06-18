import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelChain } from '../src/routes/llm.js';
const DEFAULTS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
test('empty env → built-in defaults only', () => {
    assert.deepEqual(buildModelChain({}), DEFAULTS);
});
test('MAX_MODEL leads the chain', () => {
    const chain = buildModelChain({ MAX_MODEL: 'claude-opus-4-8' });
    assert.equal(chain[0], 'claude-opus-4-8');
    // defaults still present as fallbacks
    DEFAULTS.forEach((m) => assert.ok(chain.includes(m)));
});
test('MAX_MODEL_FALLBACKS inserted after primary, before defaults', () => {
    const chain = buildModelChain({
        MAX_MODEL: 'primary',
        MAX_MODEL_FALLBACKS: 'fb1, fb2 ',
    });
    assert.deepEqual(chain, ['primary', 'fb1', 'fb2', ...DEFAULTS]);
});
test('de-dupes while preserving order', () => {
    const chain = buildModelChain({
        MAX_MODEL: 'claude-sonnet-4-6',
        MAX_MODEL_FALLBACKS: 'claude-sonnet-4-6, claude-haiku-4-5-20251001',
    });
    // sonnet appears once (as primary), haiku once
    assert.deepEqual(chain, DEFAULTS);
});
test('blank/whitespace entries are ignored', () => {
    const chain = buildModelChain({ MAX_MODEL: '   ', MAX_MODEL_FALLBACKS: ' , ,' });
    assert.deepEqual(chain, DEFAULTS);
});
test('chain is never empty (always has a usable model)', () => {
    assert.ok(buildModelChain({}).length >= 1);
});
//# sourceMappingURL=llm-model-chain.test.js.map