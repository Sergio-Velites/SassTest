'use client';

import { workflowDefinitionSchema } from '@flowhub/workflow-engine';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import '@xyflow/react/dist/style.css';

import { Button, Card, ErrorBox, Input, Spinner } from '../../../../../components/ui';
import {
  graphDefinitionSchema,
  KIND_STYLES,
  layoutPositions,
} from '../../../../../components/workflow-graph';
import { useUpdateWorkflow, useWorkflow } from '../../../../../lib/hooks';

/**
 * Visual workflow editor. The React Flow state is the working copy; on save
 * it is serialized back to the engine's definition JSON, validated live with
 * workflowDefinitionSchema and published as a new workflow version.
 */

type EditorNodeData = { name: string; kind: string; configText: string; hasError: boolean };
type EditorNode = Node<EditorNodeData>;

const NODE_KINDS = ['trigger', 'action', 'condition', 'ai', 'approval', 'wait', 'transform'];

/** Sensible starting config per node kind (documented shapes from the engine). */
const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  trigger: { type: 'manual' },
  action: { connector: 'slack-mock', action: 'send_message', params: { channel: '#general' } },
  condition: { expression: '{{variables.value}} == true' },
  ai: { template: 'invoice_extract', version: 1, input: {} },
  approval: { title: 'Needs approval', requiredRole: 'admin', timeoutHours: 72 },
  wait: { seconds: 60 },
  transform: { assign: {} },
};

function EditorFlowNode({ data, selected }: NodeProps<EditorNode>) {
  const style = KIND_STYLES[data.kind] ?? {
    badge: 'bg-slate-100 text-slate-600',
    border: 'border-slate-300',
    label: '•',
  };
  const border = data.hasError ? 'border-red-500' : selected ? 'border-slate-900' : style.border;
  return (
    <div className={`min-w-44 max-w-64 rounded-md border-2 bg-white px-3 py-2 shadow-sm ${border}`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>
        {style.label} {data.kind}
      </span>
      <p className="mt-1 truncate text-xs font-medium text-slate-800" title={data.name}>
        {data.name}
      </p>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

const EDITOR_NODE_TYPES = { editorNode: EditorFlowNode };

function buildDefinition(
  base: Record<string, unknown>,
  nodes: EditorNode[],
  edges: Edge[],
): { definition: Record<string, unknown>; jsonErrors: string[] } {
  const jsonErrors: string[] = [];
  const defNodes = nodes.map((node) => {
    let config: unknown = {};
    try {
      config = JSON.parse(node.data.configText || '{}');
    } catch {
      jsonErrors.push(`Nodo ${node.id}: el config no es JSON válido`);
    }
    return { id: node.id, kind: node.data.kind, name: node.data.name, config };
  });
  const defEdges = edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    ...(typeof edge.label === 'string' && edge.label.length > 0 ? { branch: edge.label } : {}),
  }));
  return {
    definition: {
      name: base['name'] ?? 'Workflow',
      description: base['description'] ?? '',
      variables: base['variables'] ?? {},
      nodes: defNodes,
      edges: defEdges,
    },
    jsonErrors,
  };
}

export default function WorkflowEditPage() {
  const params = useParams<{ workflowId: string }>();
  const workflow = useWorkflow(params.workflowId);
  const update = useUpdateWorkflow();
  const router = useRouter();

  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState('action');
  const [loaded, setLoaded] = useState(false);

  // Hydrate the editor once from the persisted definition.
  useEffect(() => {
    if (loaded || !workflow.data) return;
    const parsed = graphDefinitionSchema.safeParse(workflow.data.definition);
    if (!parsed.success) return;
    const positions = layoutPositions(parsed.data);
    setNodes(
      parsed.data.nodes.map((node) => ({
        id: node.id,
        type: 'editorNode',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          name: node.name,
          kind: node.kind,
          configText: JSON.stringify(node.config ?? {}, null, 2),
          hasError: false,
        },
      })),
    );
    setEdges(
      parsed.data.edges.map((edge, i) => ({
        id: `e${i}-${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        ...(edge.branch ? { label: edge.branch } : {}),
        labelStyle: { fontSize: 10, fill: '#64748b' },
      })),
    );
    setLoaded(true);
  }, [loaded, workflow.data, setNodes, setEdges]);

  // Live validation: engine schema + per-node JSON parse errors.
  const validation = useMemo(() => {
    if (!workflow.data) return { issues: [] as string[], errorNodeIds: new Set<string>() };
    const { definition, jsonErrors } = buildDefinition(workflow.data.definition, nodes, edges);
    const issues = [...jsonErrors];
    const result = workflowDefinitionSchema.safeParse(definition);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        issues.push(`${where}${issue.message}`);
      }
    }
    // Highlight nodes mentioned by id in any issue (schema messages include ids).
    const errorNodeIds = new Set<string>();
    for (const node of nodes) {
      if (issues.some((i) => i.includes(node.id))) errorNodeIds.add(node.id);
      // Issues addressed by array index (nodes.3.x) map back to the node.
      const index = nodes.indexOf(node);
      if (issues.some((i) => i.startsWith(`nodes.${index}.`))) errorNodeIds.add(node.id);
    }
    return { issues, errorNodeIds };
  }, [workflow.data, nodes, edges]);

  // Reflect validation on the canvas. Returning the previous array when
  // nothing changed lets React bail out — otherwise this effect and the
  // validation memo feed each other forever.
  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const hasError = validation.errorNodeIds.has(node.id);
        if (node.data.hasError === hasError) return node;
        changed = true;
        return { ...node, data: { ...node.data, hasError } };
      });
      return changed ? next : current;
    });
  }, [validation.errorNodeIds, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge({ ...connection, labelStyle: { fontSize: 10, fill: '#64748b' } }, current),
      ),
    [setEdges],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  function patchSelectedNode(patch: Partial<EditorNodeData>) {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    );
  }

  function addNode() {
    const base = newKind;
    let i = 1;
    while (nodes.some((n) => n.id === `${base}-${i}`)) i += 1;
    const id = `${base}-${i}`;
    const maxY = nodes.reduce((max, n) => Math.max(max, n.position.y), 0);
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'editorNode',
        position: { x: 0, y: maxY + 130 },
        data: {
          name: `Nuevo ${base}`,
          kind: base,
          configText: JSON.stringify(DEFAULT_CONFIGS[base] ?? {}, null, 2),
          hasError: false,
        },
      },
    ]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((n) => n.id !== selectedNodeId));
    setEdges((current) =>
      current.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
  }

  function save() {
    if (!workflow.data || validation.issues.length > 0) return;
    const { definition } = buildDefinition(workflow.data.definition, nodes, edges);
    update.mutate(
      { workflowId: params.workflowId, definition },
      { onSuccess: () => router.push(`/workflows/${params.workflowId}`) },
    );
  }

  if (workflow.isLoading) return <Spinner />;
  if (workflow.error) return <ErrorBox message={workflow.error.message} />;
  if (!workflow.data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Editar: {workflow.data.name}</h1>
          <p className="text-sm text-slate-500">
            Cada guardado publica una nueva versión (actual: v{workflow.data.currentVersion}).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push(`/workflows/${params.workflowId}`)}
          >
            Cancelar
          </Button>
          <Button
            disabled={validation.issues.length > 0 || update.isPending}
            onClick={save}
            data-testid="save-version"
          >
            {update.isPending ? 'Guardando…' : 'Guardar nueva versión'}
          </Button>
        </div>
      </div>
      {update.error ? <ErrorBox message={update.error.message} /> : null}

      {validation.issues.length > 0 ? (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
          data-testid="validation-issues"
        >
          <p className="mb-1 font-semibold">La definición aún no es válida:</p>
          <ul className="list-inside list-disc">
            {validation.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[560px] rounded-md border border-slate-200" data-testid="workflow-editor">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={EDITOR_NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_e, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Añadir nodo">
            <div className="flex items-center gap-2">
              <select
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
                data-testid="new-node-kind"
              >
                {NODE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <Button onClick={addNode} data-testid="add-node">
                Añadir
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Conecta nodos arrastrando desde el punto inferior de un nodo al superior de otro.
            </p>
          </Card>

          {selectedNode ? (
            <Card title={`Nodo: ${selectedNode.id}`}>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-500">Nombre</label>
                <Input
                  value={selectedNode.data.name}
                  onChange={(e) => patchSelectedNode({ name: e.target.value })}
                  data-testid="node-name"
                />
                <label className="text-xs font-medium text-slate-500">
                  Config (JSON del tipo {selectedNode.data.kind})
                </label>
                <textarea
                  className="h-48 w-full rounded-md border border-slate-300 p-2 font-mono text-xs focus:border-slate-500 focus:outline-none"
                  value={selectedNode.data.configText}
                  onChange={(e) => patchSelectedNode({ configText: e.target.value })}
                  data-testid="node-config"
                />
                <Button variant="danger" onClick={deleteSelectedNode} data-testid="delete-node">
                  Eliminar nodo
                </Button>
              </div>
            </Card>
          ) : selectedEdge ? (
            <Card title="Conexión">
              <div className="flex flex-col gap-2">
                <p className="text-xs text-slate-500">
                  {selectedEdge.source} → {selectedEdge.target}
                </p>
                <label className="text-xs font-medium text-slate-500">
                  Rama (true/false/approved/rejected — vacío para lineal)
                </label>
                <Input
                  value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                  onChange={(e) =>
                    setEdges((current) =>
                      current.map((edge) =>
                        edge.id === selectedEdgeId ? { ...edge, label: e.target.value } : edge,
                      ),
                    )
                  }
                  data-testid="edge-branch"
                />
                <Button
                  variant="danger"
                  onClick={() => {
                    setEdges((current) => current.filter((e) => e.id !== selectedEdgeId));
                    setSelectedEdgeId(null);
                  }}
                >
                  Eliminar conexión
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-slate-500">
                Selecciona un nodo o una conexión para editar su configuración.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
