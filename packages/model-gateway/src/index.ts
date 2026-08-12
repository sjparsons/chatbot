import { loadConfig, type GatewayConfig } from "./config.js";
import { consoleLogger, silentLogger, type Logger } from "./logging.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createMockProvider } from "./providers/mock.js";
import type { Gateway } from "./types.js";

export interface CreateGatewayOptions {
  config?: Partial<GatewayConfig>;
  /** Overrides the payload log. Mostly here so tests can capture it. */
  logger?: Logger;
}

/**
 * Builds the gateway chat-api talks to.
 *
 * The provider choice is config, not a code path the caller picks: `mock` keeps
 * tests hermetic and lets `npm run dev` run without credentials, `anthropic`
 * is the real thing.
 */
export function createGateway({
  config: overrides = {},
  logger,
}: CreateGatewayOptions = {}): Gateway {
  const config = loadConfig(overrides);
  const log = logger ?? (config.logPayloads ? consoleLogger : silentLogger);

  return config.provider === "mock"
    ? createMockProvider(config, { logger: log })
    : createAnthropicProvider(config, { logger: log });
}

export { loadConfig } from "./config.js";
export { GatewayError } from "./errors.js";
export { consoleLogger, silentLogger } from "./logging.js";
export { createAnthropicProvider } from "./providers/anthropic.js";
export { createMockProvider } from "./providers/mock.js";

export type { GatewayConfig, ProviderName } from "./config.js";
export type { GatewayErrorCode } from "./errors.js";
export type { Logger, ModelLogEvent } from "./logging.js";
export type { ModelClient, ModelStreamEvent } from "./providers/anthropic.js";
export type {
  Gateway,
  GenerateOptions,
  Message,
  SystemPrompt,
} from "./types.js";
