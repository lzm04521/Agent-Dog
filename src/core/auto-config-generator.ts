import { ProtocolDetector, ProtocolDetectionResult } from './protocol-detector.js';
import { MCPServerConfig } from '../types/index.js';

export interface AutoConfigOptions {
  timeout?: number;
  headers?: Record<string, string>;
  preferredProtocols?: string[];
  enableSessionMode?: boolean;
}

export interface ConfigSuggestion {
  config: MCPServerConfig;
  confidence: number;
  alternatives: MCPServerConfig[];
  warnings: string[];
  optimizations: string[];
}

export class AutoConfigGenerator {
  private detector: ProtocolDetector;

  constructor() {
    this.detector = new ProtocolDetector();
  }

  /**
   * 根据端点自动生成配置
   */
  async generateConfig(
    name: string,
    endpoint: string,
    options?: AutoConfigOptions
  ): Promise<ConfigSuggestion> {
    console.error(`🔧 Generating auto-config for ${name}: ${endpoint}`);

    // 检测协议
    const detection = await this.detector.detectBestProtocol(endpoint, {
      timeout: options?.timeout,
      headers: options?.headers
    });

    // 生成主配置
    const config = this.createConfigFromDetection(name, endpoint, detection, options);
    
    // 生成替代配置
    const alternatives = this.generateAlternativeConfigs(name, endpoint, detection, options);
    
    // 生成警告和优化建议
    const warnings = this.generateWarnings(detection);
    const optimizations = this.generateOptimizations(detection, options);

    return {
      config,
      confidence: detection.confidence,
      alternatives,
      warnings,
      optimizations
    };
  }

  /**
   * 从检测结果创建配置
   */
  private createConfigFromDetection(
    name: string,
    endpoint: string,
    detection: ProtocolDetectionResult,
    options?: AutoConfigOptions
  ): MCPServerConfig {
    const baseConfig: MCPServerConfig = {
      name,
      enabled: true,
      transport: detection.protocol === 'unknown' ? 'streamable-http' : detection.protocol,
      timeout: options?.timeout || 30000,
      retries: 3,
      description: `Auto-detected ${detection.protocol} server`
    };

    // 根据协议类型添加特定配置
    switch (detection.protocol) {
      case 'streamable-http':
        return {
          ...baseConfig,
          endpoint,
          sessionMode: options?.enableSessionMode !== false ? 'auto' : 'disabled',
          headers: {
            'User-Agent': 'AgentDog/2.0.1-AutoConfig',
            ...(options?.headers || {})
          }
        };

      case 'http-sse':
        const sseEndpoint = detection.features?.includes('DYNAMIC_ENDPOINTS') 
          ? `${endpoint}/sse` 
          : `${endpoint}/sse`;
        
        return {
          ...baseConfig,
          endpoint,
          sseEndpoint,
          sessionMode: detection.features?.includes('SESSION_SUPPORT') ? 'auto' : 'disabled',
          sseReconnectInterval: 5000,
          httpKeepAlive: true,
          headers: {
            'User-Agent': 'AgentDog/2.0.1-AutoConfig',
            ...(options?.headers || {})
          }
        };

      case 'stdio':
        return {
          ...baseConfig,
          command: endpoint, // endpoint 作为命令
          args: [],
          timeout: 60000 // stdio 需要更长超时
        };

      default:
        // 未知协议，默认使用 streamable-http
        return {
          ...baseConfig,
          transport: 'streamable-http',
          endpoint,
          sessionMode: 'auto',
          headers: {
            'User-Agent': 'AgentDog/2.0.1-AutoConfig',
            ...(options?.headers || {})
          }
        };
    }
  }

  /**
   * 生成替代配置方案
   */
  private generateAlternativeConfigs(
    name: string,
    endpoint: string,
    detection: ProtocolDetectionResult,
    options?: AutoConfigOptions
  ): MCPServerConfig[] {
    const alternatives: MCPServerConfig[] = [];

    // 如果主协议是 streamable-http，提供 http-sse 作为备选
    if (detection.protocol === 'streamable-http') {
      alternatives.push({
        name: `${name}-alt-sse`,
        enabled: false,
        transport: 'http-sse',
        endpoint,
        sseEndpoint: `${endpoint}/sse`,
        timeout: 30000,
        retries: 3,
        sessionMode: 'auto',
        description: `Alternative HTTP+SSE configuration for ${name}`
      });
    }

    // 如果主协议是 http-sse，提供 streamable-http 作为备选
    if (detection.protocol === 'http-sse') {
      alternatives.push({
        name: `${name}-alt-streamable`,
        enabled: false,
        transport: 'streamable-http',
        endpoint,
        timeout: 30000,
        retries: 3,
        sessionMode: 'auto',
        description: `Alternative Streamable HTTP configuration for ${name}`
      });
    }

    // 总是提供一个基础配置作为最后备选
    if (detection.protocol !== 'streamable-http') {
      alternatives.push({
        name: `${name}-fallback`,
        enabled: false,
        transport: 'streamable-http',
        endpoint,
        timeout: 45000, // 更长超时用于慢速服务器
        retries: 5,
        sessionMode: 'disabled',
        description: `Fallback configuration for ${name}`
      });
    }

    return alternatives;
  }

  /**
   * 生成配置警告
   */
  private generateWarnings(detection: ProtocolDetectionResult): string[] {
    const warnings: string[] = [];

    if (detection.confidence < 50) {
      warnings.push(`Low confidence detection (${detection.confidence}%). Manual verification recommended.`);
    }

    if (detection.protocol === 'unknown') {
      warnings.push('Could not detect a supported MCP protocol. Using default configuration.');
    }

    if (detection.protocol === 'http-sse') {
      warnings.push('HTTP+SSE protocol is deprecated. Consider upgrading to Streamable HTTP if supported.');
    }

    if (detection.error) {
      warnings.push(`Detection encountered errors: ${detection.error}`);
    }

    if (!detection.features?.length) {
      warnings.push('No advanced features detected. Server may have limited functionality.');
    }

    return warnings;
  }

  /**
   * 生成优化建议
   */
  private generateOptimizations(
    detection: ProtocolDetectionResult,
    options?: AutoConfigOptions
  ): string[] {
    const optimizations: string[] = [];

    // 响应时间优化
    if (detection.features?.some(f => f.includes('responseTime')) || true) {
      // 假设我们从测试结果中获得了响应时间信息
      optimizations.push('Consider adjusting timeout values based on server response time.');
    }

    // 会话管理优化
    if (detection.features?.includes('SESSION_SUPPORT')) {
      optimizations.push('Enable session mode for better performance and state management.');
    }

    // 流式传输优化
    if (detection.features?.includes('SSE_STREAMING')) {
      optimizations.push('Server supports streaming. Consider enabling streaming for large responses.');
    }

    // 重连优化
    if (detection.protocol === 'http-sse') {
      optimizations.push('Adjust sseReconnectInterval based on network conditions (current: 5000ms).');
    }

    // 并发优化
    if (detection.confidence > 80) {
      optimizations.push('High confidence detection. Consider reducing retry count for faster failover.');
    }

    return optimizations;
  }

  /**
   * 批量生成多个端点的配置
   */
  async generateMultipleConfigs(
    endpoints: { name: string; endpoint: string; options?: AutoConfigOptions }[]
  ): Promise<Map<string, ConfigSuggestion>> {
    const results = new Map<string, ConfigSuggestion>();
    
    console.error(`🔧 Generating configs for ${endpoints.length} endpoints`);

    const configPromises = endpoints.map(async ({ name, endpoint, options }) => {
      try {
        const suggestion = await this.generateConfig(name, endpoint, options);
        results.set(name, suggestion);
      } catch (error) {
        // 生成失败时的默认配置
        results.set(name, {
          config: {
            name,
            enabled: false,
            transport: 'streamable-http',
            endpoint,
            timeout: 30000,
            retries: 3,
            description: 'Auto-config generation failed'
          },
          confidence: 0,
          alternatives: [],
          warnings: [`Config generation failed: ${(error as Error).message}`],
          optimizations: []
        });
      }
    });

    await Promise.allSettled(configPromises);
    
    console.error(`✅ Generated ${results.size} configurations`);
    return results;
  }

  /**
   * 验证生成的配置
   */
  async validateGeneratedConfig(config: MCPServerConfig): Promise<{
    valid: boolean;
    errors: string[];
    suggestions: string[];
  }> {
    const errors: string[] = [];
    const suggestions: string[] = [];

    // 基础验证
    if (!config.name) {
      errors.push('Server name is required');
    }

    if (!config.transport || !['stdio', 'http-sse', 'streamable-http'].includes(config.transport)) {
      errors.push('Invalid or missing transport type');
    }

    // 传输特定验证
    switch (config.transport) {
      case 'stdio':
        if (!config.command) {
          errors.push('Command is required for stdio transport');
        }
        if (config.timeout && config.timeout < 30000) {
          suggestions.push('Consider increasing timeout for stdio servers (recommended: 60000ms)');
        }
        break;

      case 'http-sse':
        if (!config.endpoint) {
          errors.push('Endpoint is required for http-sse transport');
        }
        if (!config.sseEndpoint) {
          suggestions.push('SSE endpoint not specified, will use default /sse path');
        }
        break;

      case 'streamable-http':
        if (!config.endpoint) {
          errors.push('Endpoint is required for streamable-http transport');
        }
        if (!config.sessionMode) {
          suggestions.push('Session mode not specified, will use auto-detection');
        }
        break;
    }

    // 通用优化建议
    if (config.timeout && config.timeout < 10000) {
      suggestions.push('Timeout may be too low for network requests (recommended: 30000ms+)');
    }

    if (config.retries && config.retries > 5) {
      suggestions.push('High retry count may cause slow failover (recommended: 3-5)');
    }

    return {
      valid: errors.length === 0,
      errors,
      suggestions
    };
  }
}