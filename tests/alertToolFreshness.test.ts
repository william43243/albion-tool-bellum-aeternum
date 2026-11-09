import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('alert tool describes the mandatory same-day rule even when a maximum age is set', () => {
  const source = readFileSync('android/app/src/main/java/com/albion/market/alerts/PriceAlerts.kt', 'utf8');
  const raw = source.match(/getToolDescriptionJsonString\(\)="""(\{[^\n]+\})"""/);
  assert.ok(raw);
  const schema = JSON.parse(raw[1]);
  assert.match(schema.description, /always requires an observation from today/i);
  assert.match(schema.parameters.properties.max_age_minutes.description, /never allows yesterday/i);
  assert.match(source, /put\("requires_observation_today",true\)/);
  const instructions = readFileSync('android/app/src/main/java/com/albion/market/siwc/SiwcEngine.kt', 'utf8');
  assert.match(instructions, /cannot permit yesterday or older data/);
});
