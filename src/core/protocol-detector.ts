import axios, { AxiosResponse } from 'axios';
import { MCPServerConfig } from '../types/index.js';

export interface ProtocolDetectionResult {
  protocol: 'stdio' | 'http-sse' | 'streamable-http' | 'unknown';
  confidence: number; // 0-100
  reason: string;
  endpoint?: string;
  features?: string[];
  error?: string;
}

export interface ProtocolTestResult {
  protocol: string;
  supported: boolean;
  responseTime: number;
  features: string[];
  error?: string;
}

export class ProtocolDetector {
  private timeout: number = 10000; // 10秒超时
  private userAgent: string = 'AgentDog-ProtocolDetector/2.0.1';

  constructor(timeout?: number) {
    if (timeout) {
      this.timeout = timeout;
    }
  }

  /**
   * 自动检测端点支持的最佳协议
   */
  async detectBestProtocol(endpoint: string, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<ProtocolDetectionResult> {
    console.error(`🔍 Starting protocol detection for: ${endpoint}`);

    // 并行测试所有协议
    const testResults = await Promise.allSettled([
      this.testStreamableHttp(endpoint, options),
      this.testHttpSse(endpoint, options),
      this.testBasicHttp(endpoint, options)
    ]);

    // 分析测试结果
    const results: ProtocolTestResult[] = [];
    
    for (let i = 0; i < testResults.length; i++) {
      const result = testResults[i];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error(`Protocol test ${i} failed:`, result.reason);
      }
    }

    // 选择最佳协议
    return this.selectBestProtocol(results, endpoint);
  }

  /**
   * 测试 Streamable HTTP 协议支持
   */
  private async testStreamableHttp(endpoint: string, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<ProtocolTestResult> {
    const startTime = Date.now();
    
    try {
      const response = await axios.post(endpoint, {
        jsonrpc: '2.0',
        id: 'protocol-test',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: {
            name: 'agentdog-detector',
            version: '2.0.1'
          }
        }
      }, {
        timeout: options?.timeout || this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'User-Agent': this.userAgent,
          ...(options?.headers || {})
        },
        validateStatus: (status) => status < 500 // 接受 4xx 错误，可能是认证问题
      });

      const responseTime = Date.now() - startTime;
      const features: string[] = [];

      // 检查响应特征
      if (response.headers['content-type']?.includes('text/event-stream')) {
        features.push('SSE_STREAMING');
      }
      
      if (response.headers['content-type']?.includes('application/json')) {
        features.push('JSON_RESPONSE');
      }

      // 检查 MCP 协议版本
      if (response.data && typeof response.data === 'string') {
        // SSE 格式响应
        if (response.data.includes('event: message')) {
          features.push('SSE_EVENTS');
        }
        if (response.data.includes('2025-03-26')) {
          features.push('MCP_2025_03_26');
        }
      } else if (response.data && response.data.result) {
        // JSON 格式响应
        if (response.data.result.protocolVersion) {
          features.push(`MCP_${response.data.result.protocolVersion.replace(/-/g, '_')}`);
        }
      }

      return {
        protocol: 'streamable-http',
        supported: response.status === 200,
        responseTime,
        features,
        error: response.status !== 200 ? `HTTP ${response.status}` : undefined
      };

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      // 分析错误类型
      let errorMessage = error.message;
      if (error.response) {
        errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused - server not running';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'Connection timeout';
      }

      return {
        protocol: 'streamable-http',
        supported: false,
        responseTime,
        features: [],
        error: errorMessage
      };
    }
  }

  /**
   * 测试 HTTP+SSE 协议支持
   */
  private async testHttpSse(endpoint: string, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<ProtocolTestResult> {
    const startTime = Date.now();
    
    try {
      // 尝试访问 SSE 端点
      const sseEndpoint = `${endpoint}/sse`;
      const response = await axios.get(sseEndpoint, {
        timeout: Math.min(options?.timeout || this.timeout, 5000), // SSE 连接用较短超时
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'User-Agent': this.userAgent,
          ...(options?.headers || {})
        },
        validateStatus: (status) => status < 500
      });

      const responseTime = Date.now() - startTime;
      const features: string[] = [];

      if (response.headers['content-type']?.includes('text/event-stream')) {
        features.push('SSE_ENDPOINT');
      }

      // 检查是否有端点事件
      if (response.data && typeof response.data === 'string') {
        if (response.data.includes('event: endpoint')) {
          features.push('DYNAMIC_ENDPOINTS');
        }
        if (response.data.includes('sessionId')) {
          features.push('SESSION_SUPPORT');
        }
      }

      // 尝试 POST 端点
      try {
        const postResponse = await axios.post(`${endpoint}/mcp`, {
          jsonrpc: '2.0',
          id: 'test',
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' }
        }, {
          timeout: 3000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent
          },
          validateStatus: () => true
        });

        if (postResponse.status < 500) {
          features.push('HTTP_POST_ENDPOINT');
        }
      } catch {
        // POST 端点测试失败，但不影响 SSE 检测
      }

      return {
        protocol: 'http-sse',
        supported: response.status === 200 && features.includes('SSE_ENDPOINT'),
        responseTime,
        features,
        error: response.status !== 200 ? `HTTP ${response.status}` : undefined
      };

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      return {
        protocol: 'http-sse',
        supported: false,
        responseTime,
        features: [],
        error: error.response ? `HTTP ${error.response.status}` : error.message
      };
    }
  }

  /**
   * 测试基础 HTTP 支持（作为后备）
   */
  private async testBasicHttp(endpoint: string, options?: {
    timeout?: number;
    headers?: Record<string, string>;
  }): Promise<ProtocolTestResult> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(endpoint, {
        timeout: options?.timeout || this.timeout,
        headers: {
          'User-Agent': this.userAgent,
          ...(options?.headers || {})
        },
        validateStatus: () => true
      });

      const responseTime = Date.now() - startTime;
      const features: string[] = [];

      // 检查 HTTP 特征
      if (response.headers['content-type']?.includes('application/json')) {
        features.push('JSON_SUPPORT');
      }
      
      if (response.headers['server']) {
        features.push(`SERVER_${response.headers['server'].replace(/\s+/g, '_')}`);
      }

      // 检查是否返回 MCP 相关信息
      if (response.data && typeof response.data === 'object') {
        if (response.data.jsonrpc) {
          features.push('JSONRPC_SUPPORT');
        }
        if (response.data.result || response.data.error) {
          features.push('MCP_RESPONSE_FORMAT');
        }
      }

      return {
        protocol: 'basic-http',
        supported: response.status < 400,
        responseTime,
        features,
        error: response.status >= 400 ? `HTTP ${response.status}` : undefined
      };

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      return {
        protocol: 'basic-http',
        supported: false,
        responseTime,
        features: [],
        error: error.response ? `HTTP ${error.response.status}` : error.message
      };
    }
  }

  /**
   * 选择最佳协议
   */
  private selectBestProtocol(results: ProtocolTestResult[], endpoint: string): ProtocolDetectionResult {
    // 协议优先级权重
    const protocolWeights = {
      'streamable-http': 100,  // 最新协议，最高优先级
      'http-sse': 70,          // 传统协议，中等优先级
      'basic-http': 30         // 基础协议，最低优先级
    };

    let bestResult: ProtocolDetectionResult = {
      protocol: 'unknown',
      confidence: 0,
      reason: 'No protocols detected'
    };

    for (const result of results) {
      if (!result.supported) {
        continue;
      }

      // 计算置信度
      let confidence = protocolWeights[result.protocol as keyof typeof protocolWeights] || 0;
      
      // 根据响应时间调整 (响应时间越快，置信度越高)
      if (result.responseTime < 1000) {
        confidence += 10;
      } else if (result.responseTime > 5000) {
        confidence -= 10;
      }

      // 根据功能特征调整
      confidence += result.features.length * 5;

      // 特殊加分
      if (result.features.includes('MCP_2025_03_26')) {
        confidence += 20; // 最新协议版本
      }
      if (result.features.includes('SSE_STREAMING')) {
        confidence += 15; // 流式支持
      }
      if (result.features.includes('SESSION_SUPPORT')) {
        confidence += 10; // 会话支持
      }

      // 更新最佳结果
      if (confidence > bestResult.confidence) {
        bestResult = {
          protocol: result.protocol as any,
          confidence: Math.min(confidence, 100),
          reason: this.generateReasonText(result),
          endpoint,
          features: result.features,
          error: result.error
        };
      }
    }

    console.error(`🎯 Best protocol for ${endpoint}: ${bestResult.protocol} (confidence: ${bestResult.confidence}%)`);
    console.error(`📋 Reason: ${bestResult.reason}`);
    
    return bestResult;
  }

  /**
   * 生成检测原因说明
   */
  private generateReasonText(result: ProtocolTestResult): string {
    const reasons: string[] = [];
    
    if (result.protocol === 'streamable-http') {
      reasons.push('Latest MCP protocol (2025-03-26)');
      if (result.features.includes('SSE_STREAMING')) {
        reasons.push('Supports streaming responses');
      }
      if (result.features.includes('JSON_RESPONSE')) {
        reasons.push('JSON response format');
      }
    } else if (result.protocol === 'http-sse') {
      reasons.push('Traditional MCP HTTP+SSE protocol');
      if (result.features.includes('DYNAMIC_ENDPOINTS')) {
        reasons.push('Dynamic endpoint discovery');
      }
      if (result.features.includes('SESSION_SUPPORT')) {
        reasons.push('Session management');
      }
    } else {
      reasons.push('Basic HTTP endpoint');
    }

    if (result.responseTime < 1000) {
      reasons.push(`Fast response (${result.responseTime}ms)`);
    }

    return reasons.join(', ');
  }

  /**
   * 为 stdio 协议生成配置建议
   */
  generateStdioSuggestion(command: string): ProtocolDetectionResult {
    return {
      protocol: 'stdio',
      confidence: 95,
      reason: 'Command-based MCP server',
      features: ['PROCESS_COMMUNICATION', 'DIRECT_EXECUTION']
    };
  }

  /**
   * 批量检测多个端点
   */
  async detectMultipleEndpoints(endpoints: string[]): Promise<Map<string, ProtocolDetectionResult>> {
    const results = new Map<string, ProtocolDetectionResult>();
    
    console.error(`🔍 Batch protocol detection for ${endpoints.length} endpoints`);
    
    const detectionPromises = endpoints.map(async (endpoint) => {
      try {
        const result = await this.detectBestProtocol(endpoint);
        results.set(endpoint, result);
      } catch (error) {
        results.set(endpoint, {
          protocol: 'unknown',
          confidence: 0,
          reason: `Detection failed: ${(error as Error).message}`,
          error: (error as Error).message
        });
      }
    });

    await Promise.allSettled(detectionPromises);
    
    console.error(`✅ Batch detection completed: ${results.size} results`);
    return results;
  }
}