'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  apiFetch,
  ApiError,
  approvalsSchema,
  catalogSchema,
  connectorAccountsSchema,
  connectorCatalogSchema,
  executionSchema,
  executionsSchema,
  logsSchema,
  meSchema,
  stepsSchema,
  workflowDetailSchema,
  workflowsSchema,
} from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch('/auth/me', meSchema),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch('/auth/login', meSchema, { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; name: string }) =>
      apiFetch('/auth/register', meSchema, { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/auth/logout', z.null(), { method: 'POST' }),
    onSuccess: () => client.clear(),
  });
}

export function useCreateOrganization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      apiFetch(
        '/organizations',
        z.object({ id: z.string(), name: z.string(), slug: z.string(), plan: z.string() }),
        { method: 'POST', body: input },
      ),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: () => apiFetch('/catalog/templates', catalogSchema),
  });
}

export function useInstallWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { templateVersionId: string }) =>
      apiFetch('/workflows/install', z.object({ installedWorkflowId: z.string() }), {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workflows'] }),
  });
}

export function useCreateWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; definition: Record<string, unknown> }) =>
      apiFetch('/workflows', z.object({ installedWorkflowId: z.string() }), {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workflows'] }),
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiFetch('/workflows', workflowsSchema),
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: ['workflows', id],
    queryFn: () => apiFetch(`/workflows/${id}`, workflowDetailSchema),
  });
}

export function useRunWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) =>
      apiFetch(`/workflows/${workflowId}/executions`, z.object({ executionId: z.string() }), {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['executions'] }),
  });
}

export function useExecutions(options?: { workflowId?: string; refetchMs?: number }) {
  const params = new URLSearchParams();
  if (options?.workflowId) params.set('workflowId', options.workflowId);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return useQuery({
    queryKey: ['executions', options?.workflowId ?? 'all'],
    queryFn: () => apiFetch(`/executions${query}`, executionsSchema),
    refetchInterval: options?.refetchMs ?? 5000,
  });
}

export function useExecution(id: string) {
  return useQuery({
    queryKey: ['executions', 'detail', id],
    queryFn: () =>
      apiFetch(`/executions/${id}`, executionSchema.extend({ context: z.record(z.unknown()) })),
    refetchInterval: (query) =>
      query.state.data && ['succeeded', 'failed', 'cancelled'].includes(query.state.data.status)
        ? false
        : 2000,
  });
}

export function useExecutionSteps(id: string) {
  return useQuery({
    queryKey: ['executions', 'steps', id],
    queryFn: () => apiFetch(`/executions/${id}/steps`, stepsSchema),
    refetchInterval: 2000,
  });
}

export function useExecutionLogs(id: string) {
  return useQuery({
    queryKey: ['executions', 'logs', id],
    queryFn: () => apiFetch(`/executions/${id}/logs`, logsSchema),
    refetchInterval: 3000,
  });
}

export function useApprovals(status = 'pending') {
  return useQuery({
    queryKey: ['approvals', status],
    queryFn: () => apiFetch(`/approvals?status=${status}`, approvalsSchema),
    refetchInterval: 5000,
  });
}

export function useResolveApproval() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      approvalId: string;
      decision: 'approved' | 'rejected';
      comment?: string;
    }) =>
      apiFetch(
        `/approvals/${input.approvalId}/resolve`,
        z.object({ id: z.string(), status: z.string() }).passthrough(),
        { method: 'POST', body: { decision: input.decision, comment: input.comment } },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['approvals'] }),
  });
}

export function useConnectorCatalog() {
  return useQuery({
    queryKey: ['connectors', 'catalog'],
    queryFn: () => apiFetch('/connectors', connectorCatalogSchema),
  });
}

export function useConnectorAccounts() {
  return useQuery({
    queryKey: ['connectors', 'accounts'],
    queryFn: () => apiFetch('/connector-accounts', connectorAccountsSchema),
  });
}

export function useAuthorizeConnector() {
  return useMutation({
    mutationFn: (slug: string) =>
      apiFetch(
        `/connector-accounts/${slug}/authorize`,
        z.object({ authorizationUrl: z.string() }),
        {
          method: 'POST',
        },
      ),
    onSuccess: (data) => {
      window.location.href = data.authorizationUrl;
    },
  });
}

export function useConnectApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { slug: string; name: string; credentials: Record<string, string> }) =>
      apiFetch(`/connector-accounts/${input.slug}/connect`, z.object({ accountId: z.string() }), {
        method: 'POST',
        body: { name: input.name, credentials: input.credentials },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connectors'] }),
  });
}

export function useRevokeConnectorAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch(`/connector-accounts/${accountId}/revoke`, z.object({ revoked: z.boolean() }), {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connectors'] }),
  });
}
