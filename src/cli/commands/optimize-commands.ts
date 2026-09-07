/**
 * 性能优化CLI命令
 */

import { ConfigManager } from '../../config/config-manager.js';
import { CLIUtils } from '../cli-utils.js';

export class OptimizeCommands {
  constructor(private configManager: ConfigManager) {}

  async execute(args: string[], options: Record<string, any>): Promise<void> {
    if (options.help) {
      this.showHelp();
      return;
    }

    if (options.all) {
      await this.optimizeAllServers(options);
    } else {
      const [serverName] = args;
      if (!serverName) {
        CLIUtils.error('使用方法: agentdog optimize <server-name> 或 agentdog optimize --all');
        return;
      }
      await this.optimizeServer(serverName, options);
    }
  }

  private async optimizeServer(serverName: string, options: Record<string, any>): Promise<void> {
    try {
      const server = this.configManager.getServer(serverName);
      if (!server) {
        CLIUtils.error(`服务器 '${serverName}' 不存在`);
        return;
      }

      CLIUtils.info(`⚡ 优化服务器配置: ${serverName}`);

      const optimization = await this.configManager.optimizeServerConfig(serverName);

      if (CLIUtils.isJsonMode()) {
        CLIUtils.jsonOutput(optimization);
        return;
      }

      console.log(`\n${CLIUtils.colorize('📊 优化分析:', 'cyan')}`);
      console.log(`服务器: ${CLIUtils.colorize(serverName, 'yellow')}`);
      
      if (optimization.changes.length === 0) {
        CLIUtils.success('✅ 配置已经是最优状态，无需优化');
        return;
      }

      console.log(`\n${CLIUtils.colorize('🔧 建议的优化:', 'cyan')}`);
      optimization.changes.forEach((change: any, index: number) => {
        console.log(`  ${index + 1}. ${change}`);
      });

      if (options.preview) {
        console.log(`\n${CLIUtils.colorize('🔍 优化前后对比:', 'cyan')}`);
        this.showConfigDiff(optimization.original, optimization.optimized);
      }

      if (options.apply || (!options.preview && await CLIUtils.confirm('是否应用这些优化?', true))) {
        await this.configManager.updateServer(serverName, optimization.optimized);
        CLIUtils.success(`✅ 服务器 '${serverName}' 优化完成`);
        CLIUtils.info(`应用了 ${optimization.changes.length} 项优化`);
      } else {
        CLIUtils.info('优化已取消');
      }

    } catch (error) {
      CLIUtils.error(`优化失败: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  private async optimizeAllServers(options: Record<string, any>): Promise<void> {
    const servers = this.configManager.getServers();
    
    const serverEntries = Object.entries(servers);
    
    if (serverEntries.length === 0) {
      CLIUtils.info('没有配置任何服务器');
      return;
    }

    CLIUtils.info(`⚡ 批量优化 ${serverEntries.length} 个服务器...`);

    const results = [];
    let totalOptimizations = 0;

    for (let i = 0; i < serverEntries.length; i++) {
      const [serverName, server] = serverEntries[i];
      CLIUtils.showProgress(i + 1, serverEntries.length, `优化 ${serverName}`);

      try {
        const optimization = await this.configManager.optimizeServerConfig(serverName);
        results.push({
          name: server.name,
          changes: optimization.changes.length,
          optimization
        });
        totalOptimizations += optimization.changes.length;
      } catch (error) {
        results.push({
          name: server.name,
          changes: 0,
          error: (error as Error).message
        });
      }
    }

    if (CLIUtils.isJsonMode()) {
      CLIUtils.jsonOutput(results.map(r => ({
        server: r.name,
        optimizations: r.changes,
        success: !r.error,
        error: r.error
      })));
      return;
    }

    console.log(`\n${CLIUtils.colorize('📊 批量优化结果:', 'cyan')}\n`);

    const headers = ['服务器', '优化项数', '状态'];
    const rows = results.map(result => [
      result.name,
      result.changes.toString(),
      result.error ? 
        CLIUtils.colorize('错误', 'red') : 
        (result.changes > 0 ? CLIUtils.colorize('可优化', 'yellow') : CLIUtils.colorize('最优', 'green'))
    ]);

    CLIUtils.printTable(headers, rows);

    console.log(`\n${CLIUtils.colorize('📈 统计信息:', 'cyan')}`);
    console.log(`  总服务器数: ${servers.length}`);
    console.log(`  可优化服务器: ${results.filter(r => r.changes > 0).length}`);
    console.log(`  总优化项: ${totalOptimizations}`);

    if (totalOptimizations > 0) {
      if (options.preview) {
        console.log(`\n${CLIUtils.colorize('🔍 详细优化列表:', 'cyan')}`);
        results.forEach(result => {
          if (result.changes > 0 && result.optimization) {
            console.log(`\n${CLIUtils.colorize(result.name, 'yellow')}:`);
            result.optimization.changes.forEach((change: string, index: number) => {
              console.log(`  ${index + 1}. ${change}`);
            });
          }
        });
      }

      if (options.apply || (!options.preview && await CLIUtils.confirm(`应用所有 ${totalOptimizations} 项优化?`, false))) {
        let applied = 0;
        for (const result of results) {
          if (result.changes > 0 && result.optimization) {
            try {
              await this.configManager.updateServer(result.name, result.optimization.optimized);
              applied++;
            } catch (error) {
              CLIUtils.warning(`应用 ${result.name} 的优化失败: ${(error as Error).message}`);
            }
          }
        }
        CLIUtils.success(`✅ 成功优化 ${applied} 个服务器`);
      }
    }
  }

  private showConfigDiff(original: any, optimized: any): void {
    const fields = ['transport', 'timeout', 'retries', 'sessionMode'];
    
    fields.forEach(field => {
      const oldValue = original[field];
      const newValue = optimized[field];
      
      if (oldValue !== newValue) {
        console.log(`  ${field}:`);
        console.log(`    ${CLIUtils.colorize(`- ${oldValue || '(未设置)'}`, 'red')}`);
        console.log(`    ${CLIUtils.colorize(`+ ${newValue}`, 'green')}`);
      }
    });
  }

  private showHelp(): void {
    console.log(`
${CLIUtils.colorize('agentdog optimize', 'cyan')} - 性能优化

${CLIUtils.colorize('使用方法:', 'yellow')}
  agentdog optimize <server-name> [options]
  agentdog optimize --all [options]

${CLIUtils.colorize('选项:', 'yellow')}
  --all                  优化所有服务器
  --apply                自动应用优化建议 (跳过确认)
  --preview              仅预览优化结果，不应用

${CLIUtils.colorize('优化内容:', 'yellow')}
  • 协议类型优化 (基于检测结果)
  • 超时时间调优 (根据协议类型)
  • 重试次数优化 (平衡速度和可靠性)
  • 会话模式配置 (提升性能)

${CLIUtils.colorize('示例:', 'yellow')}
  agentdog optimize my-server                # 优化单个服务器
  agentdog optimize my-server --preview      # 预览优化建议
  agentdog optimize --all                    # 优化所有服务器
  agentdog optimize --all --apply            # 批量应用所有优化
`);
  }
}