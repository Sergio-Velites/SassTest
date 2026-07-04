import { z } from 'zod';

/**
 * Workflow definition schema — the JSON contract for a workflow version.
 * A workflow is a directed graph of nodes connected by edges. Definitions
 * are immutable once published: editing creates a new version.
 */

export const NODE_KINDS = [
  'trigger', // entry point: manual, webhook or schedule
  'action', // executes a connector action (send message, create record, ...)
  'condition', // routes execution based on an expression over the context
  'ai', // calls the AI Gateway (classify, extract, draft, decide)
  'approval', // pauses execution until a human approves/rejects
  'wait', // pauses for a duration or until a timestamp
  'transform', // pure data transformation of the execution context
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const workflowNodeSchema = z.object({
  /** Unique within the workflow definition (slug-like, not a UUID). */
  id: z.string().min(1).max(64),
  kind: z.enum(NODE_KINDS),
  name: z.string().min(1).max(200),
  /**
   * Node-kind-specific configuration, validated by the node handler at
   * registration time. E.g. for `action`: { connector: 'slack-mock', action: 'send_message', ... }
   */
  config: z.record(z.unknown()).default({}),
});

export const workflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  /**
   * Optional branch label for edges leaving a condition/approval node,
   * e.g. 'true' / 'false' / 'approved' / 'rejected'. Omitted for linear edges.
   */
  branch: z.string().min(1).max(64).optional(),
});

export const workflowDefinitionSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).default(''),
    nodes: z.array(workflowNodeSchema).min(1),
    edges: z.array(workflowEdgeSchema).default([]),
    /** Declared input variables the trigger accepts. */
    variables: z.record(z.string()).default({}),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    for (const node of def.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate node id: ${node.id}` });
      }
      ids.add(node.id);
    }
    for (const edge of def.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge references unknown node: ${edge.from} -> ${edge.to}`,
        });
      }
    }
    const triggers = def.nodes.filter((n) => n.kind === 'trigger');
    if (triggers.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A workflow must have exactly one trigger node (found ${triggers.length})`,
      });
    }
  });

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(input);
}
