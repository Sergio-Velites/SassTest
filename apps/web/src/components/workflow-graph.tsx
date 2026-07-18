'use client';

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useMemo } from 'react';
import { z } from 'zod';

import '@xyflow/react/dist/style.css';

/**
 * Read-only graph view of a workflow definition. The definition arrives as
 * untyped JSON from the API, so it is re-validated here with a lightweight
 * schema (the API already validated it with the engine's full schema).
 */

export const graphDefinitionSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      name: z.string(),
      config: z.record(z.unknown()).optional(),
    }),
  ),
  edges: z
    .array(z.object({ from: z.string(), to: z.string(), branch: z.string().optional() }))
    .default([]),
});

export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;

export const KIND_STYLES: Record<string, { badge: string; border: string; label: string }> = {
  trigger: { badge: 'bg-violet-100 text-violet-700', border: 'border-violet-300', label: '⚡' },
  action: { badge: 'bg-blue-100 text-blue-700', border: 'border-blue-300', label: '🔌' },
  condition: { badge: 'bg-amber-100 text-amber-700', border: 'border-amber-300', label: '🔀' },
  ai: { badge: 'bg-fuchsia-100 text-fuchsia-700', border: 'border-fuchsia-300', label: '✨' },
  approval: { badge: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-300', label: '✋' },
  wait: { badge: 'bg-slate-100 text-slate-600', border: 'border-slate-300', label: '⏳' },
  transform: { badge: 'bg-cyan-100 text-cyan-700', border: 'border-cyan-300', label: '🧮' },
};

type FlowNodeData = { name: string; kind: string; detail: string };

function WorkflowFlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const style = KIND_STYLES[data.kind] ?? {
    badge: 'bg-slate-100 text-slate-600',
    border: 'border-slate-300',
    label: '•',
  };
  return (
    <div
      className={`min-w-44 max-w-64 rounded-md border bg-white px-3 py-2 shadow-sm ${style.border}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>
          {style.label} {data.kind}
        </span>
      </div>
      <p className="mt-1 truncate text-xs font-medium text-slate-800" title={data.name}>
        {data.name}
      </p>
      {data.detail ? (
        <p className="truncate text-[10px] text-slate-400" title={data.detail}>
          {data.detail}
        </p>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

const NODE_TYPES = { workflowNode: WorkflowFlowNode };

const LAYER_HEIGHT = 130;
const NODE_SPACING_X = 240;

/** Layered top-down auto-layout: depth = longest path from the trigger. */
export function layoutPositions(
  definition: GraphDefinition,
): Map<string, { x: number; y: number }> {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of definition.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of definition.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  // Longest-path layering via repeated relaxation (graphs are small; cycles
  // are cut off by the iteration bound so a malformed definition cannot hang).
  const depth = new Map<string, number>();
  for (const node of definition.nodes) {
    depth.set(node.id, (incoming.get(node.id) ?? 0) === 0 ? 0 : 1);
  }
  for (let i = 0; i < definition.nodes.length; i += 1) {
    let changed = false;
    for (const edge of definition.edges) {
      const candidate = (depth.get(edge.from) ?? 0) + 1;
      if (candidate > (depth.get(edge.to) ?? 0) && candidate <= definition.nodes.length) {
        depth.set(edge.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const layers = new Map<number, string[]>();
  for (const node of definition.nodes) {
    const d = depth.get(node.id) ?? 0;
    const layer = layers.get(d) ?? [];
    layer.push(node.id);
    layers.set(d, layer);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of definition.nodes) {
    const d = depth.get(node.id) ?? 0;
    const layer = layers.get(d) ?? [];
    const index = layer.indexOf(node.id);
    positions.set(node.id, {
      x: (index - (layer.length - 1) / 2) * NODE_SPACING_X,
      y: d * LAYER_HEIGHT,
    });
  }
  return positions;
}

function layoutGraph(definition: GraphDefinition): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const positions = layoutPositions(definition);
  const nodes: Node<FlowNodeData>[] = definition.nodes.map((node) => {
    const config = node.config ?? {};
    const detail =
      node.kind === 'action'
        ? [config['connector'], config['action']].filter(Boolean).join(' · ')
        : node.kind === 'ai'
          ? String(config['template'] ?? '')
          : node.kind === 'condition'
            ? String(config['expression'] ?? '')
            : '';
    return {
      id: node.id,
      type: 'workflowNode',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { name: node.name, kind: node.kind, detail },
    };
  });

  const edges: Edge[] = definition.edges.map((edge, i) => ({
    id: `e${i}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    ...(edge.branch ? { label: edge.branch } : {}),
    labelStyle: { fontSize: 10, fill: '#64748b' },
    style: { stroke: '#94a3b8' },
  }));

  return { nodes, edges };
}

export function WorkflowGraph({ definition }: { definition: Record<string, unknown> }) {
  const parsed = useMemo(() => graphDefinitionSchema.safeParse(definition), [definition]);
  const graph = useMemo(
    () => (parsed.success ? layoutGraph(parsed.data) : { nodes: [], edges: [] }),
    [parsed],
  );

  if (!parsed.success) {
    return (
      <p className="text-sm text-slate-500">
        La definición no tiene el formato de grafo esperado — revisa el JSON más abajo.
      </p>
    );
  }

  return (
    <div className="h-96 rounded-md border border-slate-200" data-testid="workflow-graph">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={NODE_TYPES}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
