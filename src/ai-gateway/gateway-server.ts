// AI API 网关（daemon 内组件）：按 slug:model 寻址路由到上游供应商。
// 对外路由带方言前缀（/anthropic、/openai 两种方言入口），两种宿主形态共用 createGatewayRouter：
// 1) Web 端口挂载（常态）：DaemonWebServer 把 router 挂在 Web 管理端口（61125）上；
// 2) 独立端口（回退）：Web 服务未启动时 AiGatewayServer 自行监听 aiGateway.port。
import express from 'express';
import { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { ConfigManager } from '../config/config-manager.js';
import { createGatewayAuth } from './auth.js';
import { anthropicError } from './anthropic-errors.js';
import { resolveModel, ModelRouteError } from './model-router.js';
import { passthroughMessages, passthroughOpenAI } from './passthrough.js';
import { handleCountTokens } from './count-tokens.js';
import { buildAnthropicModelsList, buildOpenAIModelsList } from './models-list.js';
import { handleIRChannel, anthropicIngress, openaiIngress } from './ir-channel.js';
import { openaiCodec, geminiCodec, anthropicCodec } from './dialects.js';
import { openaiError } from './openai-errors.js';
import { beginCallLog, patchCallLog, requestExcerptOf } from './call-log.js';

const DEFAULT_PORT = 62125;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 32 * 1024 * 1024; // Claude Code 携带截图 base64

// 网关方言路径：挂到 Web 端口时仅对这些前缀生效，/api 与静态资源不经过网关中间件
const GATEWAY_PATHS = ['/anthropic', '/openai', '/v1/messages', '/v1/models'];

function isGatewayPath(pathName: string): boolean {
  return GATEWAY_PATHS.some(p => pathName === p || pathName.startsWith(`${p}/`));
}

function handleMessages(configManager: ConfigManager, req: express.Request, res: express.Response): void {
  beginCallLog(res, { ingress: 'anthropic', path: req.path, model: (req.body?.model as string) || '' });
  try {
    const model = (req.body?.model as string) || '';
    const { provider, model: upstreamModel } = resolveModel(model, configManager.getAIProviders());
    patchCallLog(res, { providerName: provider.slug, upstreamModel });

    switch (provider.dialect) {
      case 'anthropic':
        void passthroughMessages(req, res, provider, upstreamModel);
        break;
      case 'openai':
        void handleIRChannel(req, res, provider, upstreamModel, openaiCodec, anthropicIngress);
        break;
      case 'gemini':
        void handleIRChannel(req, res, provider, upstreamModel, geminiCodec, anthropicIngress);
        break;
    }
  } catch (error) {
    if (error instanceof ModelRouteError) {
      patchCallLog(res, { error: error.message, requestExcerpt: requestExcerptOf(req) });
      anthropicError(res, 400, 'invalid_request_error', error.message);
      return;
    }
    patchCallLog(res, { error: (error as Error).message, requestExcerpt: requestExcerptOf(req) });
    anthropicError(res, 500, 'api_error', (error as Error).message);
  }
}

function handleCountTokensRoute(configManager: ConfigManager, req: express.Request, res: express.Response): void {
  beginCallLog(res, { ingress: 'anthropic', path: req.path, model: (req.body?.model as string) || '' });
  try {
    const model = (req.body?.model as string) || '';
    const { provider, model: upstreamModel } = resolveModel(model, configManager.getAIProviders());
    patchCallLog(res, { providerName: provider.slug, upstreamModel });
    void handleCountTokens(req, res, provider, upstreamModel);
  } catch (error) {
    if (error instanceof ModelRouteError) {
      patchCallLog(res, { error: error.message, requestExcerpt: requestExcerptOf(req) });
      anthropicError(res, 400, 'invalid_request_error', error.message);
      return;
    }
    patchCallLog(res, { error: (error as Error).message, requestExcerpt: requestExcerptOf(req) });
    anthropicError(res, 500, 'api_error', (error as Error).message);
  }
}

function isOpenAIPath(pathName: string): boolean {
  return pathName === '/openai' || pathName.startsWith('/openai/');
}

// OpenAI 入口方言：openai 上游直通（P1），anthropic/gemini 上游走 IR
function handleOpenAIMessages(configManager: ConfigManager, req: express.Request, res: express.Response): void {
  beginCallLog(res, { ingress: 'openai', path: req.path, model: (req.body?.model as string) || '' });
  try {
    const n = req.body?.n;
    if (typeof n === 'number' && n > 1) {
      patchCallLog(res, { error: 'n > 1 is not supported' });
      openaiError(res, 400, 'invalid_request_error', 'n > 1 is not supported; the gateway serves a single completion');
      return;
    }
    const model = (req.body?.model as string) || '';
    const { provider, model: upstreamModel } = resolveModel(model, configManager.getAIProviders());
    patchCallLog(res, { providerName: provider.slug, upstreamModel });
    switch (provider.dialect) {
      case 'openai':
        void passthroughOpenAI(req, res, provider, upstreamModel);
        break;
      case 'anthropic':
        void handleIRChannel(req, res, provider, upstreamModel, anthropicCodec, openaiIngress);
        break;
      case 'gemini':
        void handleIRChannel(req, res, provider, upstreamModel, geminiCodec, openaiIngress);
        break;
    }
  } catch (error) {
    if (error instanceof ModelRouteError) {
      patchCallLog(res, { error: error.message, requestExcerpt: requestExcerptOf(req) });
      openaiError(res, 400, 'invalid_request_error', error.message, 'model_not_found');
      return;
    }
    patchCallLog(res, { error: (error as Error).message, requestExcerpt: requestExcerptOf(req) });
    openaiError(res, 500, 'api_error', (error as Error).message);
  }
}

// /v1/models 模型列表：只读配置快照，无 body、无上游请求
function handleModelsList(configManager: ConfigManager, format: 'anthropic' | 'openai') {
  return (_req: express.Request, res: express.Response): void => {
    const providers = configManager.getAIProviders();
    res.status(200).json(format === 'openai' ? buildOpenAIModelsList(providers) : buildAnthropicModelsList(providers));
  };
}

// 网关路由器：路径门控（32MB 解析 + apiKey 认证只作用于方言路径），
// 认证/启用状态每次请求实时读配置，设置变更即时生效无需重启监听
export function createGatewayRouter(configManager: ConfigManager): express.Router {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!isGatewayPath(req.path)) {
      next();
      return;
    }
    express.json({ limit: `${MAX_BODY_BYTES / 1024 / 1024}mb` })(req, res, next);
  });

  router.use((req, res, next) => {
    if (!isGatewayPath(req.path)) {
      next();
      return;
    }
    const gateway = configManager.getAIGatewayConfig();
    if (!gateway?.enabled) {
      if (isOpenAIPath(req.path)) {
        openaiError(res, 503, 'api_error', 'AI gateway not enabled');
      } else {
        anthropicError(res, 503, 'api_error', 'AI gateway not enabled');
      }
      return;
    }
    if (!gateway.apiKey) {
      // 未配置（不应到达此处，启用时会自动生成）
      if (isOpenAIPath(req.path)) {
        openaiError(res, 503, 'api_error', 'AI gateway not configured');
      } else {
        anthropicError(res, 503, 'api_error', 'AI gateway not configured');
      }
      return;
    }
    createGatewayAuth(gateway.apiKey)(req, res, next);
  });

  // 方言前缀路由：anthropic / openai 入口端点（同端口按路径区分协议）
  router.post('/anthropic/v1/messages', (req, res) => handleMessages(configManager, req, res));
  router.post('/anthropic/v1/messages/count_tokens', (req, res) => handleCountTokensRoute(configManager, req, res));
  router.post('/openai/v1/chat/completions', (req, res) => handleOpenAIMessages(configManager, req, res));
  // 裸路径为 1.2.0 起已发布的 Anthropic 端点，保留为兼容别名（同一 handler）
  router.post('/v1/messages', (req, res) => handleMessages(configManager, req, res));
  router.post('/v1/messages/count_tokens', (req, res) => handleCountTokensRoute(configManager, req, res));
  router.get('/anthropic/v1/models', handleModelsList(configManager, 'anthropic'));
  router.get('/openai/v1/models', handleModelsList(configManager, 'openai'));
  router.get('/v1/models', handleModelsList(configManager, 'anthropic')); // 裸路径别名（与裸 /v1/messages 对称）

  // JSON 解析 / body 超限错误兜底（错误体格式按入口方言前缀选）
  router.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const openaiIngressReq = isOpenAIPath(_req.path);
    if (err.type === 'entity.too.large') {
      if (openaiIngressReq) {
        openaiError(res, 413, 'invalid_request_error', 'request body exceeds 32MB limit');
      } else {
        anthropicError(res, 413, 'invalid_request_error', 'request body exceeds 32MB limit');
      }
      return;
    }
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      if (openaiIngressReq) {
        openaiError(res, 400, 'invalid_request_error', `invalid JSON: ${err.message}`);
      } else {
        anthropicError(res, 400, 'invalid_request_error', `invalid JSON: ${err.message}`);
      }
      return;
    }
    if (openaiIngressReq) {
      openaiError(res, 500, 'api_error', err.message);
    } else {
      anthropicError(res, 500, 'api_error', err.message);
    }
  });
  return router;
}

// 独立监听形态（回退）：Web 服务不启动时使用
export class AiGatewayServer {
  private app: express.Application;
  private server?: HttpServer;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.app = express();
    this.app.use(createGatewayRouter(configManager));
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
