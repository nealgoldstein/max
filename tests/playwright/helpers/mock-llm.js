// helpers/mock-llm.js — install a deterministic mock for callMax + a
// fixture-recorder for first-run capture.
//
// Two modes:
//
//   PLAYBACK (default)
//     Replace window.callMax with a function that looks up responses
//     by prompt content in `fixtures.json`. If a prompt isn't found,
//     the test fails with a clear message pointing at the missing key.
//
//   RECORD (PLAYWRIGHT_RECORD=1 in env)
//     Wrap the real callMax. On every call, save the (prompt, response)
//     pair to `fixtures.json` so subsequent runs can replay. Use this
//     ONCE with a real Anthropic API key configured to capture the
//     fixtures, then commit them. From then on, tests replay
//     deterministically with no API key needed.
//
// Fixtures are matched by SHA-256 of the prompt content (same approach
// as the app's IDB cache). Different prompts → different keys; rerun
// won't accidentally collide.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const FIXTURE_PATH = path.resolve(__dirname, '..', 'fixtures', 'llm-fixtures.json');

function _loadFixtures() {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function _saveFixtures(obj) {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(obj, null, 2) + '\n');
}

function _hashPrompt(messages, maxTokens) {
  const payload = JSON.stringify({ m: messages, t: maxTokens || 1000 });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Install the LLM mock on the page BEFORE navigation.
 * Call this in beforeEach: `await installLlmMock(page);`
 */
async function installLlmMock(page) {
  const fixtures = _loadFixtures();
  const recordMode = !!process.env.PLAYWRIGHT_RECORD;
  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  // In record mode, seed the API key into localStorage so the real
  // callMax works without a manual setup step. The test origin
  // (http://localhost:8765) is separate from your normal-usage
  // origin, so the key needs to be set explicitly here. In playback
  // mode no key is needed.
  if (recordMode && apiKey) {
    await page.addInitScript((k) => {
      try { localStorage.setItem('max-api-key', k); } catch (e) {}
    }, apiKey);
  }

  // Expose helpers on the test side so the page can talk back to us.
  await page.exposeFunction('__pwLlmLookup', (key) => {
    return fixtures[key] || null;
  });
  await page.exposeFunction('__pwLlmRecord', (key, prompt, response) => {
    fixtures[key] = { prompt: prompt.slice(0, 200), response };
    _saveFixtures(fixtures);
  });
  await page.exposeFunction('__pwHashPrompt', (messages, maxTokens) => {
    return _hashPrompt(messages, maxTokens);
  });

  // Install the override before any inline script runs.
  await page.addInitScript((mode) => {
    window.__PW_LLM_MODE__ = mode;
    // Wait for callMax to be defined, then wrap it.
    const wrap = () => {
      if (typeof window.callMax !== 'function') {
        return setTimeout(wrap, 50);
      }
      const realCallMax = window.callMax;
      window.callMax = async function (messages, maxTokens, timeoutMs) {
        const key = await window.__pwHashPrompt(messages, maxTokens);
        if (window.__PW_LLM_MODE__ === 'record') {
          // Real call → record → return.
          const response = await realCallMax(messages, maxTokens, timeoutMs);
          await window.__pwLlmRecord(key, JSON.stringify(messages), response);
          return response;
        }
        const fixture = await window.__pwLlmLookup(key);
        if (!fixture) {
          throw new Error(
            '[mock-llm] No fixture for prompt key ' + key + '. ' +
            'Run with PLAYWRIGHT_RECORD=1 to capture, then commit fixtures.'
          );
        }
        return fixture.response;
      };
      // Re-inject into the engine's service slot so the FQ pipeline
      // picks up the mock too.
      if (typeof window.MaxEngineTrip !== 'undefined' &&
          typeof window.MaxEngineTrip.injectService === 'function') {
        window.MaxEngineTrip.injectService('llm', window.callMax);
      }
    };
    wrap();
  }, recordMode ? 'record' : 'playback');
}

module.exports = { installLlmMock };
