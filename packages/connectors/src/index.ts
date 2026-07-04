/**
 * @flowhub/connectors — connector contract and registry.
 *
 * MVP ships mock connectors only (gmail-mock, slack-mock, drive-mock,
 * http-generic, webhook-inbound). The interface is designed so real
 * OAuth-backed connectors can be added later without touching the engine:
 * credentials are resolved by ConnectorAccountId at execution time and
 * never stored in workflow definitions.
 */

export * from './connector.js';
export * from './mocks.js';
