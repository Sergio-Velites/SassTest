import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';

import { createLogger } from './index.js';

function captureSink(): { sink: Writable; lines: () => Array<Record<string, unknown>> } {
  const raw: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      raw.push(chunk.toString());
      callback();
    },
  });
  return {
    sink,
    lines: () =>
      raw
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

test('logs structured JSON with level, message and base fields', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger('info', { app: 'test' }, sink);
  logger.info('hello', { n: 1 });
  const [line] = lines();
  assert.equal(line?.['level'], 'info');
  assert.equal(line?.['message'], 'hello');
  assert.equal(line?.['app'], 'test');
  assert.equal(line?.['n'], 1);
});

test('sensitive fields are redacted at any depth', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger('info', {}, sink);
  logger.info('with secrets', { apiKey: 'sk-123', nested: { authorization: 'Bearer x' } });
  const [line] = lines();
  assert.equal(line?.['apiKey'], '[REDACTED]');
  assert.deepEqual(line?.['nested'], { authorization: '[REDACTED]' });
});

test('minLevel filters lower-severity logs', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger('warn', {}, sink);
  logger.debug('nope');
  logger.info('nope');
  logger.warn('yes');
  assert.equal(lines().length, 1);
  assert.equal(lines()[0]?.['message'], 'yes');
});

test('child loggers inherit and redact bound fields', () => {
  const { sink, lines } = captureSink();
  const logger = createLogger('info', { app: 'api' }, sink);
  const child = logger.child({ organizationId: 'org-1', sessionToken: 'abc' });
  child.info('scoped');
  const [line] = lines();
  assert.equal(line?.['organizationId'], 'org-1');
  assert.equal(line?.['sessionToken'], '[REDACTED]');
  assert.equal(line?.['app'], 'api');
});
