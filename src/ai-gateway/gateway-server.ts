// AiGatewayServer：AI API 网关宿主（daemon 内组件，独立端口）
// 对外提供 Anthropic Messages 方言端点，按 slug:model 寻址路由到上游供应商。
import express from 'express';
import { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { ConfigManager } from '../config/config-manager.js';
import { createGatewayAuth } from './auth.js';
import { anthropicError } from './anthropic-errors.js';
import { resolveModel, ModelRouteError } from './model-router.js';
import { passthroughMessages } from './passthrough.js';
import { handleCountTokens } from './count-tokens.js';

const DEFAULT_PORT = 62125;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 32 * 1024 * 1024; // Claude Code 携带截图 base64

export class AiGatewayServer {
  private app: express.Application;
  private server?: HttpServer;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json({ limit: `${MAX_BODY_BYTES / 1024 / 1024}mb` }));

    this.app.use((req, res, next) => {
      const gateway = this.configManager.getAIGatewayConfig();
      if (!gateway?.apiKey) {
        // 未配置（不应到达此处，start 前会生成）
        anthropicError(res, 503, 'api_error', 'AI gateway not configured');
        return;
      }
      createGatewayAuth(gateway.apiKey)(req, res, next);
    });

    this.app.post('/v1/messages', this.handleMessages.bind(this));
    this.app.post('/v1/messages/count_tokens', this.handleCountTokensRoute.bind(this));

    // JSON 解析 / body 超限错误兜底
    this.app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err.type === 'entity.too.large') {
        anthropicError(res, 413, 'invalid_request_error', 'request body exceeds 32MB limit');
        return;
      }
      if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        anthropicError(res, 400, 'invalid_request_error', `invalid JSON: ${err.message}`);
        return;
      }
      anthropicError(res, 500, 'api_error', err.message);
    });
  }

  private handleMessages(req: express.Request, res: express.Response): void {
    try {
      const model = (req.body?.model as string) || '';
      const { provider, model: upstreamModel } = resolveModel(model, this.configManager.getAIProviders());

      switch (provider.dialect) {
        case 'anthropic':
          void passthroughMessages(req, res, provider, upstreamModel);
          break;
        case 'openai':
        case 'gemini':
          // IR 转换通道在后续任务接入
          anthropicError(res, 501, 'api_error', `dialect "${provider.dialect}" not yet supported`);
          break;
      }
    } catch (error) {
      if (error instanceof ModelRouteError) {
        anthropicError(res, 400, 'invalid_request_error', error.message);
        return;
      }
      anthropicError(res, 500, 'api_error', (error as Error).message);
    }
  }

  private handleCountTokensRoute(req: express.Request, res: express.Response): void {
    try {
      const model = (req.body?.model as string) || '';
      const { provider, model: upstreamModel } = resolveModel(model, this.configManager.getAIProviders());
      void handleCountTokens(req, res, provider, upstreamModel);
    } catch (error) {
      if (error instanceof ModelRouteError) {
        anthropicError(res, 400, 'invalid_request_error', error.message);
        return;
      }
      anthropicError(res, 500, 'api_error', (error as Error).message);
    }
  }

  async start(): Promise<void> {
    const gateway = this.configManager.getAIGatewayConfig();
    if (!gateway?.enabled) {
      console.log('[AI-GATEWAY] Disabled, not starting');
      return;
    }
    // 首次启用自动生成对外 apiKey
    if (!gateway.apiKey) {
      gateway.apiKey = `ad-sk-${randomUUID()}`;
      await this.configManager.setAIGateway(gateway);
      console.log('[AI-GATEWAY] Generated gateway API key');
    }

    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(gateway.port, gateway.host || DEFAULT_HOST, () => resolve());
      this.server.once('error', reject);
    });
    console.log(`[AI-GATEWAY] AI API gateway listening on ${gateway.host}:${gateway.port}`);
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = undefined;
    console.log('[AI-GATEWAY] AI API gateway stopped');
  }

  isRunning(): boolean {
    return !!this.server && this.server.listening;
  }

  getPort(): number | undefined {
    return this.configManager.getAIGatewayConfig()?.port ?? DEFAULT_PORT;
  }
}
