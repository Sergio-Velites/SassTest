/**
 * Branded ID types. All primary keys are UUIDs, but branding prevents
 * accidentally passing a UserId where an OrganizationId is expected —
 * a critical safeguard in a multi-tenant system.
 */

declare const brand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, 'UserId'>;
export type OrganizationId = Branded<string, 'OrganizationId'>;
export type WorkflowTemplateId = Branded<string, 'WorkflowTemplateId'>;
export type InstalledWorkflowId = Branded<string, 'InstalledWorkflowId'>;
export type WorkflowVersionId = Branded<string, 'WorkflowVersionId'>;
export type WorkflowExecutionId = Branded<string, 'WorkflowExecutionId'>;
export type ExecutionStepId = Branded<string, 'ExecutionStepId'>;
export type ConnectorAccountId = Branded<string, 'ConnectorAccountId'>;
export type ApprovalRequestId = Branded<string, 'ApprovalRequestId'>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
