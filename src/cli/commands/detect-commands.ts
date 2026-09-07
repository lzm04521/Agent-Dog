/**
 * Protocol detection CLI commands
 */

import { ConfigManager } from '../../config/config-manager.js';
import { CLIUtils } from '../cli-utils.js';

export class DetectCommands {
  constructor(private configManager: ConfigManager) {}

  async execute(args: string[], options: Record<string, any>): Promise<void> {
    if (options.help) {
      this.showHelp();
      return;
    }

    if (options.all) {
      await this.detectAllServers(options);
    } else {
      const [target] = args;
      if (!target) {
        CLIUtils.error('Usage: agentdog detect <server-name|endpoint> or agentdog detect --all');
        return;
      }
      await this.detectTarget(target, options);
    }
  }

  private async detectTarget(target: string, options: Record<string, any>): Promise<void> {
    try {
      // Determine if it's a server name or endpoint URL
      const existingServer = this.configManager.getServer(target);
      
      if (existingServer) {
        // Detect existing server
        await this.detectExistingServer(target, options);
      } else if (target.startsWith('http://') || target.startsWith('https://')) {
        // Detect new endpoint
        await this.detectNewEndpoint(target, options);
      } else {
        // May be a stdio command
        await this.detectStdioCommand(target, options);
      }

    } catch (error) {
      CLIUtils.error(`Protocol detection failed: ${(error as Error).message}`);
      if (CLIUtils.isJsonMode()) {
        CLIUtils.jsonOutput({ success: false, error: (error as Error).message });
      }
      process.exit(1);
    }
  }

  private async detectExistingServer(serverName: string, options: Record<string, any>): Promise<void> {
    const server = this.configManager.getServer(serverName)!;
    
    CLIUtils.info(`🔍 Detecting server: ${serverName}`);
    CLIUtils.verbose(`Endpoint: ${server.endpoint || server.command}`);

    const detection = await this.configManager.detectConfigProtocol(server);

    if (CLIUtils.isJsonMode()) {
      CLIUtils.jsonOutput({
        server: serverName,
        current: server.transport,
        detected: detection.detected,
        confidence: detection.confidence,
        recommendations: detection.recommendations
      });
      return;
    }

    console.log(`\n${CLIUtils.colorize('📊 Detection Results:', 'cyan')}`);
    console.log(`Server: ${CLIUtils.colorize(serverName, 'yellow')}`);
    console.log(`Current Protocol: ${CLIUtils.colorize(server.transport, 'blue')}`);
    console.log(`Detected Protocol: ${CLIUtils.colorize(detection.detected, detection.detected === server.transport ? 'green' : 'yellow')}`);
    console.log(`Confidence: ${this.formatConfidence(detection.confidence)}`);
    
    if (detection.recommendations.length > 0) {
      console.log(`\n${CLIUtils.colorize('💡 Recommendations:', 'cyan')}`);
      detection.recommendations.forEach((rec: string) => {
        console.log(`  • ${rec}`);
      });
    }

    // If a better protocol is detected, ask whether to update
    if (detection.detected !== server.transport && detection.confidence > 70) {
      const shouldUpdate = options.yes || await CLIUtils.confirm(
        `Detected better protocol ${detection.detected}, update configuration?`,
        false
      );

      if (shouldUpdate) {
        await this.configManager.updateServer(serverName, { transport: detection.detected as any });
        CLIUtils.success(`✅ Server '${serverName}' protocol updated to ${detection.detected}`);
      }
    }
  }

  private async detectNewEndpoint(endpoint: string, options: Record<string, any>): Promise<void> {
    CLIUtils.info(`🔍 Detecting new endpoint: ${endpoint}`);

    // Use AutoConfigGenerator directly for endpoint detection
    const { AutoConfigGenerator } = await import('../../core/auto-config-generator.js');
    const generator = new AutoConfigGenerator();
    const suggestion = await generator.generateConfig(
      'temp-detection',
      endpoint,
      {
        timeout: options.timeout ? parseInt(options.timeout) : undefined
      }
    );

    if (CLIUtils.isJsonMode()) {
      CLIUtils.jsonOutput({
        endpoint,
        detected: suggestion.config.transport,
        confidence: suggestion.confidence,
        config: suggestion.config,
        alternatives: suggestion.alternatives,
        warnings: suggestion.warnings,
        optimizations: suggestion.optimizations
      });
      return;
    }

    console.log(`\n${CLIUtils.colorize('📊 Detection Results:', 'cyan')}`);
    console.log(`Endpoint: ${CLIUtils.colorize(endpoint, 'yellow')}`);
    console.log(`Recommended Protocol: ${CLIUtils.colorize(suggestion.config.transport, 'green')}`);
    console.log(`Confidence: ${this.formatConfidence(suggestion.confidence)}`);
    
    if (options.detailed) {
      console.log(`\n${CLIUtils.colorize('🔧 Suggested Configuration:', 'cyan')}`);
      console.log(`  Transport Protocol: ${suggestion.config.transport}`);
      console.log(`  Timeout: ${suggestion.config.timeout}ms`);
      console.log(`  Retry Count: ${suggestion.config.retries}`);
      console.log(`  Session Mode: ${suggestion.config.sessionMode || 'Default'}`);
    }

    if (suggestion.alternatives.length > 0) {
      console.log(`\n${CLIUtils.colorize('🔄 Alternatives:', 'cyan')}`);
      suggestion.alternatives.forEach((alt, index) => {
        console.log(`  ${index + 1}. ${alt.transport} - ${alt.description}`);
      });
    }

    if (suggestion.warnings.length > 0) {
      console.log(`\n${CLIUtils.colorize('⚠️  Warnings:', 'yellow')}`);
      suggestion.warnings.forEach(warning => {
        console.log(`  • ${warning}`);
      });
    }

    if (suggestion.optimizations.length > 0) {
      console.log(`\n${CLIUtils.colorize('💡 Optimization Suggestions:', 'cyan')}`);
      suggestion.optimizations.forEach(opt => {
        console.log(`  • ${opt}`);
      });
    }

    // Ask whether to add server
    if (!options['no-add']) {
      const shouldAdd = await CLIUtils.confirm(
        'Add new server based on detection results?',
        false
      );

      if (shouldAdd) {
        const { createInterface } = await import('readline');
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const serverName = await new Promise<string>((resolve) => {
          rl.question('Please enter server name: ', resolve);
        });
        rl.close();

        if (serverName.trim()) {
          await this.configManager.addServer(serverName.trim(), suggestion.config);
          CLIUtils.success(`✅ Server '${serverName.trim()}' added successfully`);
        }
      }
    }
  }

  private async detectStdioCommand(command: string, options: Record<string, any>): Promise<void> {
    CLIUtils.info(`🔍 Detecting stdio command: ${command}`);

    // For stdio commands, we directly suggest stdio protocol
    const suggestion = {
      protocol: 'stdio',
      confidence: 95,
      reason: 'Command-based MCP server detected',
      features: ['PROCESS_COMMUNICATION', 'DIRECT_EXECUTION']
    };

    if (CLIUtils.isJsonMode()) {
      CLIUtils.jsonOutput({
        command,
        detected: suggestion.protocol,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        features: suggestion.features
      });
      return;
    }

    console.log(`\n${CLIUtils.colorize('📊 Detection Results:', 'cyan')}`);
    console.log(`Command: ${CLIUtils.colorize(command, 'yellow')}`);
    console.log(`Recommended Protocol: ${CLIUtils.colorize('stdio', 'green')}`);
    console.log(`Confidence: ${this.formatConfidence(suggestion.confidence)}`);
    console.log(`Reason: ${suggestion.reason}`);

    console.log(`\n${CLIUtils.colorize('🔧 Suggested Configuration:', 'cyan')}`);
    console.log(`  Transport Protocol: stdio`);
    console.log(`  Command: ${command}`);
    console.log(`  Timeout: 60000ms (stdio recommends longer)`);
  }

  private async detectAllServers(options: Record<string, any>): Promise<void> {
    const servers = this.configManager.getServers();
    
    if (Object.keys(servers).length === 0) {
      CLIUtils.info('No servers configured');
      return;
    }

    CLIUtils.info(`🔍 Batch detecting protocols for ${Object.keys(servers).length} servers...`);

    const results = await this.configManager.auditAllServerProtocols();

    if (CLIUtils.isJsonMode()) {
      const jsonResults = Object.entries(results).map(([name, result]) => ({
        server: name,
        ...result
      }));
      CLIUtils.jsonOutput(jsonResults);
      return;
    }

    console.log(`\n${CLIUtils.colorize('📊 Batch Detection Results:', 'cyan')}\n`);

    const headers = ['Server', 'Current Protocol', 'Detected Protocol', 'Confidence', 'Status', 'Recommendation'];
    const rows: string[][] = [];

    for (const [serverName, result] of Object.entries(results)) {
      const status = result.needsUpdate ? 
        CLIUtils.colorize('Needs Update', 'yellow') : 
        CLIUtils.colorize('OK', 'green');
      
      const mainRecommendation = result.recommendations[0] || 'None';
      
      rows.push([
        serverName,
        result.current,
        result.detected,
        this.formatConfidence(result.confidence),
        status,
        mainRecommendation.length > 40 ? mainRecommendation.substring(0, 37) + '...' : mainRecommendation
      ]);
    }

    CLIUtils.printTable(headers, rows);

    // Statistics
    const needsUpdate = Object.values(results).filter((r: any) => r.needsUpdate).length;
    const highConfidence = Object.values(results).filter((r: any) => r.confidence > 80).length;

    console.log(`\n${CLIUtils.colorize('📈 Statistics:', 'cyan')}`);
    console.log(`  Total Servers: ${Object.keys(servers).length}`);
    console.log(`  Need Update: ${needsUpdate}`);
    console.log(`  High Confidence Detection: ${highConfidence}`);

    if (needsUpdate > 0) {
      const shouldUpdate = options.yes || await CLIUtils.confirm(
        `Found ${needsUpdate} servers that can be optimized, batch update?`,
        false
      );

      if (shouldUpdate) {
        let updated = 0;
        for (const [serverName, result] of Object.entries(results)) {
          if (result.needsUpdate) {
            try {
              await this.configManager.updateServer(serverName, { 
                transport: result.detected as any 
              });
              updated++;
              CLIUtils.verbose(`✅ Updated server '${serverName}' protocol to ${result.detected}`);
            } catch (error) {
              CLIUtils.warning(`Failed to update server '${serverName}': ${(error as Error).message}`);
            }
          }
        }
        CLIUtils.success(`✅ Successfully updated ${updated} server configurations`);
      }
    }
  }

  private formatConfidence(confidence: number): string {
    if (confidence >= 90) {
      return CLIUtils.colorize(`${confidence}% (Very High)`, 'green');
    } else if (confidence >= 70) {
      return CLIUtils.colorize(`${confidence}% (High)`, 'green');
    } else if (confidence >= 50) {
      return CLIUtils.colorize(`${confidence}% (Medium)`, 'yellow');
    } else {
      return CLIUtils.colorize(`${confidence}% (Low)`, 'red');
    }
  }

  private showHelp(): void {
    console.log(`
${CLIUtils.colorize('agentdog detect', 'cyan')} - 协议检测

${CLIUtils.colorize('使用方法:', 'yellow')}
  agentdog detect <server-name|endpoint> [options]
  agentdog detect --all [options]

${CLIUtils.colorize('选项:', 'yellow')}
  --all                  检测所有配置的服务器
  --timeout <ms>         检测超时时间 (默认: 10000)
  --detailed             显示详细检测信息
  --no-add               不询问是否添加新服务器
  --yes                  自动确认所有操作

${CLIUtils.colorize('示例:', 'yellow')}
  agentdog detect my-server                      # 检测现有服务器
  agentdog detect https://api.example.com        # 检测新端点
  agentdog detect "node mcp-server.js"           # 检测stdio命令
  agentdog detect --all                          # 检测所有服务器
  agentdog detect --all --yes                    # 批量检测并自动更新
  agentdog detect new-api --detailed             # 详细检测信息

${CLIUtils.colorize('输出说明:', 'yellow')}
  置信度 90%+: 极高可信度，强烈建议使用
  置信度 70-89%: 高可信度，建议使用
  置信度 50-69%: 中等可信度，可以尝试
  置信度 <50%: 低可信度，需要手动验证
`);
  }
}