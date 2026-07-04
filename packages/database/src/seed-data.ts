import { parseWorkflowDefinition, type WorkflowDefinition } from '@flowhub/workflow-engine';

/** Plan catalog (PRD §9.1 — prices are placeholders, no real charging). */
export const PLAN_SEED = [
  {
    slug: 'free',
    name: 'Free / Developer',
    priceCents: 0,
    limits: { maxUsers: 1, maxInstalledWorkflows: 2, maxExecutionsPerMonth: 50, aiBudgetUsd: 1 },
  },
  {
    slug: 'starter',
    name: 'Starter',
    priceCents: 2900,
    limits: {
      maxUsers: 5,
      maxInstalledWorkflows: 10,
      maxExecutionsPerMonth: 1000,
      aiBudgetUsd: 10,
    },
  },
  {
    slug: 'pro',
    name: 'Pro',
    priceCents: 9900,
    limits: {
      maxUsers: 20,
      maxInstalledWorkflows: 50,
      maxExecutionsPerMonth: 10000,
      aiBudgetUsd: 50,
    },
  },
  {
    slug: 'business',
    name: 'Business',
    priceCents: 29900,
    limits: {
      maxUsers: 100,
      maxInstalledWorkflows: 200,
      maxExecutionsPerMonth: 100000,
      aiBudgetUsd: 250,
    },
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    priceCents: 0,
    limits: {
      maxUsers: -1,
      maxInstalledWorkflows: -1,
      maxExecutionsPerMonth: -1,
      aiBudgetUsd: -1,
    },
  },
] as const;

/** Fine-grained permission catalog (enforced post-MVP; seeded now). */
export const PERMISSION_SEED = [
  { key: 'workflows:read', description: 'View catalog, installed workflows and executions' },
  { key: 'workflows:execute', description: 'Trigger workflow executions manually' },
  { key: 'workflows:install', description: 'Install and configure workflows' },
  { key: 'workflows:edit', description: 'Edit installed workflow definitions' },
  { key: 'approvals:resolve', description: 'Approve or reject approval requests' },
  { key: 'connectors:manage', description: 'Connect and revoke connector accounts' },
  { key: 'members:manage', description: 'Invite members and change roles' },
  { key: 'marketplace:publish', description: 'Publish workflow templates to the marketplace' },
] as const;

/**
 * Invoice Intake Demo — canonical definition, kept in sync with
 * docs/workflows/invoice-intake-demo.md. Validated at seed time.
 */
export const INVOICE_INTAKE_DEFINITION: WorkflowDefinition = parseWorkflowDefinition({
  name: 'Invoice Intake Demo',
  description:
    'Recibe un email con PDF, clasifica con IA, extrae datos, aprueba por umbral y registra en contabilidad (todo mock).',
  variables: { approvalThresholdEur: '500' },
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual trigger', config: { type: 'manual' } },
    {
      id: 'receive-email',
      kind: 'action',
      name: 'Receive email with PDF',
      config: { connector: 'gmail-mock', action: 'fetch_email_with_attachment' },
    },
    {
      id: 'classify',
      kind: 'ai',
      name: 'Classify: is it an invoice?',
      config: {
        promptTemplate: 'invoice-classify@1',
        input: { document: '{{nodes.receive-email.attachmentText}}' },
      },
    },
    {
      id: 'is-invoice',
      kind: 'condition',
      name: 'Is invoice?',
      config: { expression: '{{nodes.classify.isInvoice}} == true' },
    },
    {
      id: 'notify-not-invoice',
      kind: 'action',
      name: 'Notify: not an invoice',
      config: {
        connector: 'slack-mock',
        action: 'send_message',
        params: { channel: '#finance', text: 'Documento recibido no es una factura.' },
      },
    },
    {
      id: 'extract',
      kind: 'ai',
      name: 'Extract invoice fields',
      config: {
        promptTemplate: 'invoice-extract@1',
        input: { document: '{{nodes.receive-email.attachmentText}}' },
      },
    },
    {
      id: 'amount-check',
      kind: 'condition',
      name: 'Amount < threshold?',
      config: {
        expression: '{{nodes.extract.totalAmount}} < {{variables.approvalThresholdEur}}',
      },
    },
    {
      id: 'approval',
      kind: 'approval',
      name: 'Finance approval',
      config: {
        title: 'Aprobar factura de {{nodes.extract.vendor}}',
        requiredRole: 'member',
        expiresInHours: 72,
        payloadFrom: 'extract',
      },
    },
    {
      id: 'register',
      kind: 'action',
      name: 'Register in accounting',
      config: { connector: 'accounting-mock', action: 'create_entry', params: { from: 'extract' } },
    },
    {
      id: 'notify-rejected',
      kind: 'action',
      name: 'Notify rejection',
      config: {
        connector: 'slack-mock',
        action: 'send_message',
        params: { channel: '#finance', text: 'Factura rechazada en aprobación.' },
      },
    },
    {
      id: 'notify-registered',
      kind: 'action',
      name: 'Notify registered',
      config: {
        connector: 'slack-mock',
        action: 'send_message',
        params: { channel: '#finance', text: 'Factura registrada correctamente.' },
      },
    },
  ],
  edges: [
    { from: 'start', to: 'receive-email' },
    { from: 'receive-email', to: 'classify' },
    { from: 'classify', to: 'is-invoice' },
    { from: 'is-invoice', to: 'extract', branch: 'true' },
    { from: 'is-invoice', to: 'notify-not-invoice', branch: 'false' },
    { from: 'extract', to: 'amount-check' },
    { from: 'amount-check', to: 'register', branch: 'true' },
    { from: 'amount-check', to: 'approval', branch: 'false' },
    { from: 'approval', to: 'register', branch: 'approved' },
    { from: 'approval', to: 'notify-rejected', branch: 'rejected' },
    { from: 'register', to: 'notify-registered' },
  ],
});

/** System AI prompt templates for the demo (mock provider serves canned outputs). */
export const AI_PROMPT_SEED = [
  {
    slug: 'invoice-classify',
    version: 1,
    template:
      'You are an accounts-payable assistant. Decide whether the following document is an invoice.\n\nDocument:\n{{document}}\n\nAnswer with JSON matching the output schema.',
    outputSchema: {
      type: 'object',
      properties: {
        isInvoice: { type: 'boolean' },
        confidence: { type: 'number' },
      },
      required: ['isInvoice', 'confidence'],
    },
    modelHint: 'small-fast',
  },
  {
    slug: 'invoice-extract',
    version: 1,
    template:
      'Extract the vendor name, total amount (EUR), issue date and VAT amount from this invoice.\n\nDocument:\n{{document}}\n\nAnswer with JSON matching the output schema.',
    outputSchema: {
      type: 'object',
      properties: {
        vendor: { type: 'string' },
        totalAmount: { type: 'number' },
        date: { type: 'string' },
        vatAmount: { type: 'number' },
      },
      required: ['vendor', 'totalAmount', 'date', 'vatAmount'],
    },
    modelHint: 'small-fast',
  },
] as const;
