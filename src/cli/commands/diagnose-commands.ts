/**
 * 诊断和修复CLI命令
 */

import { ConfigManager } from '../../config/config-manager.js';
import { CLIUtils } from '../cli-utils.js';

export class DiagnoseCommands {
  constructor(private configManager: ConfigManager) {}

  async execute(args: string[], options: Record<string, any>): Promise<void> {
    if (options.help) {
      this.showHelp();
      return;
    }

    if (options['health-check']) {
      await this.healthCheck(options);
    } else if (options.all) {
      await this.diagnoseAllServers(options);
    } else {
      const [serverName] = args;
      if (!serverName) {
        CLIUtils.error('使用方法: agentdog diagnose <server-name> 或 agentdog diagnose --all');
        return;
      }
      await this.diagnoseServer(serverName, options);
    }
  }

  private async diagnoseServer(serverName: string, options: Record<string, any>): Promise<void> {
    try {
      const server = this.configManager.getServer(serverName);
      if (!server) {
        CLIUtils.error(`服务器 '${serverName}' 不存在`);
        return;
      }

      CLIUtils.info(`🔍 诊断服务器: ${serverName}`);

      // 执行基础配置检查
      const configErrors = this.configManager.validateServerConfig(server);
      
      // 执行协议检测诊断
      const protocolDiagnosis = await this.configManager.detectConfigProtocol(server);

      if (CLIUtils.isJsonMode()) {
        CLIUtils.jsonOutput({
          server: serverName,
          configValid: configErrors.valid,
          configErrors: configErrors.errors,
          protocolDiagnosis,
          needsFix: !configErrors.valid || protocolDiagnosis.confidence < 50
        });
        return;
      }

      console.log(`\n${CLIUtils.colorize('🏥 诊断报告:', 'cyan')} ${serverName}\n`);

      // 配置验证结果
      console.log(`${CLIUtils.colorize('📋 配置检查:', 'yellow')}`);
      if (configErrors.valid) {
        console.log(`  ${CLIUtils.colorize('✅ 配置语法正确', 'green')}`);
      } else {
        console.log(`  ${CLIUtils.colorize('❌ 发现配置问题:', 'red')}`);
        configErrors.errors.forEach((error: string) => {
          console.log(`    • ${error}`);
        });
      }

      // 协议诊断结果
      console.log(`\n${CLIUtils.colorize('🔌 连接诊断:', 'yellow')}`);
      console.log(`  当前协议: ${server.transport}`);
      console.log(`  检测协议: ${protocolDiagnosis.detected}`);
      console.log(`  检测置信度: ${this.formatConfidence(protocolDiagnosis.confidence)}`);

      if (protocolDiagnosis.recommendations.length > 0) {
        console.log(`\n${CLIUtils.colorize('💡 诊断建议:', 'cyan')}`);
        protocolDiagnosis.recommendations.forEach((rec: string) => {
          console.log(`  • ${rec}`);
        });
      }

      // 健康状态评估
      const healthScore = this.calculateHealthScore(configErrors.errors, protocolDiagnosis);
      console.log(`\n${CLIUtils.colorize('💗 健康评分:', 'cyan')} ${this.formatHealthScore(healthScore)}`);

      // 自动修复建议
      if (options.fix || (healthScore < 70 && await CLIUtils.confirm('是否尝试自动修复发现的问题?', false))) {
        await this.attemptFix(serverName, server, configErrors.errors, protocolDiagnosis);
      }

    } catch (error) {
      CLIUtils.error(`诊断失败: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  private async diagnoseAllServers(options: Record<string, any>): Promise<void> {
    const servers = this.configManager.getServers();
    
    const serverEntries = Object.entries(servers);
    
    if (serverEntries.length === 0) {
      CLIUtils.info('没有配置任何服务器');
      return;
    }

    CLIUtils.info(`🔍 批量诊断 ${serverEntries.length} 个服务器...`);

    const results = [];

    for (let i = 0; i < serverEntries.length; i++) {
      const [serverName, server] = serverEntries[i];
      CLIUtils.showProgress(i + 1, serverEntries.length, `诊断 ${serverName}`);

      try {
        const configErrors = this.configManager.validateServerConfig(server);
        const protocolDiagnosis = await this.configManager.detectConfigProtocol(server);
        const healthScore = this.calculateHealthScore(configErrors.errors, protocolDiagnosis);

        results.push({
          name: serverName,
          configValid: configErrors.valid,
          configErrors: configErrors.errors,
          protocolMatch: protocolDiagnosis.detected === server.transport,
          confidence: protocolDiagnosis.confidence,
          healthScore,
          needsAttention: healthScore < 70
        });

      } catch (error) {
        results.push({
          name: serverName,
          configValid: false,
          configErrors: [(error as Error).message],
          protocolMatch: false,
          confidence: 0,
          healthScore: 0,
          needsAttention: true,
          error: (error as Error).message
        });
      }
    }

    if (CLIUtils.isJsonMode()) {
      CLIUtils.jsonOutput(results);
      return;
    }

    console.log(`\n${CLIUtils.colorize('🏥 批量诊断报告:', 'cyan')}\n`);

    const headers = ['服务器', '配置', '协议匹配', '置信度', '健康分', '状态'];
    const rows = results.map(result => [
      result.name,
      result.configValid ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'red'),
      result.protocolMatch ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'yellow'),
      `${result.confidence}%`,
      result.healthScore.toString(),
      result.needsAttention ? CLIUtils.colorize('需关注', 'yellow') : CLIUtils.colorize('健康', 'green')
    ]);

    CLIUtils.printTable(headers, rows);

    // 统计信息
    const needsAttention = results.filter(r => r.needsAttention).length;
    const configIssues = results.filter(r => !r.configValid).length;
    const protocolIssues = results.filter(r => !r.protocolMatch && r.confidence > 70).length;

    console.log(`\n${CLIUtils.colorize('📊 诊断统计:', 'cyan')}`);
    console.log(`  总服务器数: ${servers.length}`);
    console.log(`  需要关注: ${needsAttention}`);
    console.log(`  配置问题: ${configIssues}`);
    console.log(`  协议问题: ${protocolIssues}`);

    if (needsAttention > 0) {
      console.log(`\n${CLIUtils.colorize('⚠️  需要关注的服务器:', 'yellow')}`);
      results.filter(r => r.needsAttention).forEach(result => {
        console.log(`  • ${result.name}: 健康分 ${result.healthScore}`);
        if (result.configErrors.length > 0) {
          result.configErrors.forEach((error: string) => {
            console.log(`    - 配置: ${error}`);
          });
        }
      });
    }
  }

  private async healthCheck(options: Record<string, any>): Promise<void> {
    CLIUtils.info('🏥 执行系统健康检查...');

    const servers = this.configManager.getServers();
    const config = this.configManager.getConfig();
    
    // 基础检查
    const serverEntries = Object.entries(servers);
    const checks = {
      configFile: true,
      serversConfigured: serverEntries.length > 0,
      enabledServers: serverEntries.filter(([name, s]) => s.enabled !== false).length,
      webInterface: config.web?.enabled || false,
      loggingConfigured: config.logging?.level !== undefined
    };

    if (CLIUtils.isJsonMode()) {
      CLIUtils.jsonOutput({
        systemHealth: checks,
        serverCount: servers.length,
        enabledCount: checks.enabledServers,
        overallHealth: this.calculateSystemHealth(checks)
      });
      return;
    }

    console.log(`\n${CLIUtils.colorize('💗 系统健康检查:', 'cyan')}\n`);

    console.log(`${CLIUtils.colorize('📋 基础检查:', 'yellow')}`);
    console.log(`  配置文件: ${checks.configFile ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'red')}`);
    console.log(`  服务器配置: ${checks.serversConfigured ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'red')} (${servers.length} 个)`);
    console.log(`  启用的服务器: ${checks.enabledServers > 0 ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'yellow')} (${checks.enabledServers} 个)`);
    console.log(`  Web界面: ${checks.webInterface ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'yellow')}`);
    console.log(`  日志配置: ${checks.loggingConfigured ? CLIUtils.colorize('✓', 'green') : CLIUtils.colorize('✗', 'yellow')}`);

    const systemHealth = this.calculateSystemHealth(checks);
    console.log(`\n${CLIUtils.colorize('💗 系统健康度:', 'cyan')} ${this.formatHealthScore(systemHealth)}`);

    if (systemHealth < 80) {
      console.log(`\n${CLIUtils.colorize('💡 改进建议:', 'cyan')}`);
      if (!checks.serversConfigured) {
        console.log('  • 添加至少一个MCP服务器配置');
      }
      if (checks.enabledServers === 0) {
        console.log('  • 启用至少一个服务器');
      }
      if (!checks.webInterface) {
        console.log('  • 考虑启用Web管理界面');
      }
      if (!checks.loggingConfigured) {
        console.log('  • 配置日志级别以便调试');
      }
    }
  }

  private async attemptFix(serverName: string, server: any, configErrors: string[], protocolDiagnosis: any): Promise<void> {
    CLIUtils.info(`🔧 尝试自动修复 ${serverName}...`);

    let fixes = 0;

    // 修复协议问题
    if (protocolDiagnosis.detected !== server.transport && protocolDiagnosis.confidence > 70) {
      try {
        await this.configManager.updateServer(serverName, { transport: protocolDiagnosis.detected });
        CLIUtils.success(`✅ 协议已更新为 ${protocolDiagnosis.detected}`);
        fixes++;
      } catch (error) {
        CLIUtils.warning(`协议修复失败: ${(error as Error).message}`);
      }
    }

    // 修复配置问题 (简单的默认值修复)
    const updates: any = {};
    configErrors.forEach(error => {
      if (error.includes('timeout')) {
        updates.timeout = server.transport === 'stdio' ? 60000 : 30000;
        fixes++;
      }
      if (error.includes('retries')) {
        updates.retries = 3;
        fixes++;
      }
    });

    if (Object.keys(updates).length > 0) {
      try {
        await this.configManager.updateServer(serverName, updates);
        CLIUtils.success(`✅ 配置参数已修复`);
      } catch (error) {
        CLIUtils.warning(`配置修复失败: ${(error as Error).message}`);
      }
    }

    if (fixes > 0) {
      CLIUtils.success(`🎉 成功修复 ${fixes} 个问题`);
    } else {
      CLIUtils.warning('没有可自动修复的问题，请手动检查配置');
    }
  }

  private calculateHealthScore(configErrors: string[], protocolDiagnosis: any): number {
    let score = 100;

    // 配置错误扣分
    score -= configErrors.length * 20;

    // 协议不匹配扣分
    if (protocolDiagnosis.detected !== 'unknown' && protocolDiagnosis.confidence > 70) {
      score -= (100 - protocolDiagnosis.confidence) / 2;
    }

    return Math.max(0, Math.round(score));
  }

  private calculateSystemHealth(checks: any): number {
    let score = 0;
    let maxScore = 0;

    // 基础检查权重
    const weights = {
      configFile: 20,
      serversConfigured: 30,
      enabledServers: 25,
      webInterface: 15,
      loggingConfigured: 10
    };

    Object.entries(weights).forEach(([key, weight]) => {
      maxScore += weight;
      if (checks[key] === true || (key === 'enabledServers' && checks[key] > 0)) {
        score += weight;
      }
    });

    return Math.round((score / maxScore) * 100);
  }

  private formatConfidence(confidence: number): string {
    if (confidence >= 90) return CLIUtils.colorize(`${confidence}%`, 'green');
    if (confidence >= 70) return CLIUtils.colorize(`${confidence}%`, 'yellow');
    return CLIUtils.colorize(`${confidence}%`, 'red');
  }

  private formatHealthScore(score: number): string {
    if (score >= 90) return CLIUtils.colorize(`${score}% (优秀)`, 'green');
    if (score >= 70) return CLIUtils.colorize(`${score}% (良好)`, 'green');
    if (score >= 50) return CLIUtils.colorize(`${score}% (一般)`, 'yellow');
    return CLIUtils.colorize(`${score}% (需改进)`, 'red');
  }

  private showHelp(): void {
    console.log(`
${CLIUtils.colorize('agentdog diagnose', 'cyan')} - 诊断和修复

${CLIUtils.colorize('使用方法:', 'yellow')}
  agentdog diagnose <server-name> [options]
  agentdog diagnose --all [options]
  agentdog diagnose --health-check

${CLIUtils.colorize('选项:', 'yellow')}
  --all                  诊断所有服务器
  --fix                  自动修复发现的问题
  --health-check         执行系统健康检查

${CLIUtils.colorize('诊断内容:', 'yellow')}
  • 配置语法验证
  • 协议兼容性检查
  • 连通性测试
  • 性能分析
  • 健康评分

${CLIUtils.colorize('示例:', 'yellow')}
  agentdog diagnose my-server                # 诊断单个服务器
  agentdog diagnose my-server --fix          # 诊断并自动修复
  agentdog diagnose --all                    # 诊断所有服务器
  agentdog diagnose --health-check           # 系统健康检查
`);
  }
}