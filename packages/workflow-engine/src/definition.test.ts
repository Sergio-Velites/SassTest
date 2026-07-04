import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseWorkflowDefinition } from './definition.js';

const validDefinition = {
  name: 'Invoice Intake Demo (minimal)',
  description: 'Trigger -> classify -> done',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual trigger', config: { type: 'manual' } },
    {
      id: 'classify',
      kind: 'ai',
      name: 'Classify document',
      config: { prompt: 'invoice-classify' },
    },
  ],
  edges: [{ from: 'start', to: 'classify' }],
};

test('accepts a valid workflow definition', () => {
  const def = parseWorkflowDefinition(validDefinition);
  assert.equal(def.nodes.length, 2);
  assert.equal(def.edges[0]?.from, 'start');
});

test('rejects duplicate node ids', () => {
  const bad = {
    ...validDefinition,
    nodes: [...validDefinition.nodes, { id: 'start', kind: 'wait', name: 'dup', config: {} }],
  };
  assert.throws(() => parseWorkflowDefinition(bad), /Duplicate node id/);
});

test('rejects edges pointing at unknown nodes', () => {
  const bad = { ...validDefinition, edges: [{ from: 'start', to: 'ghost' }] };
  assert.throws(() => parseWorkflowDefinition(bad), /unknown node/);
});

test('requires exactly one trigger node', () => {
  const bad = {
    ...validDefinition,
    nodes: validDefinition.nodes.filter((n) => n.kind !== 'trigger'),
    edges: [],
  };
  assert.throws(() => parseWorkflowDefinition(bad), /exactly one trigger/);
});
