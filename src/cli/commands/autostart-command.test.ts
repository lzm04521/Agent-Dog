// AutostartCommand 内容生成纯函数测试：三平台启动配置文本
import { describe, it, expect } from 'vitest';
import {
  buildWindowsVbs,
  buildLaunchAgentPlist,
  buildSystemdUnit,
} from './autostart-command.js';

describe('buildWindowsVbs', () => {
  it('包含隐藏窗口启动与带引号路径', () => {
    const vbs = buildWindowsVbs('C:\\Program Files\\nodejs\\node.exe', 'C:\\tools\\cli-main.js');
    expect(vbs).toContain('WScript.Shell');
    expect(vbs).toContain('", 0, False');           // 窗口样式 0 = 隐藏
    expect(vbs).toContain('""C:\\Program Files\\nodejs\\node.exe""'); // vbs 内双引号转义
    expect(vbs).toContain('""C:\\tools\\cli-main.js""');
    expect(vbs).toContain('daemon start --no-color');
  });
});

describe('buildLaunchAgentPlist', () => {
  it('生成含 Label/RunAtLoad/ProgramArguments 的合法结构', () => {
    const xml = buildLaunchAgentPlist('/usr/local/bin/node', '/opt/agentdog/cli-main.js', '/tmp/agentdog.log');
    expect(xml).toContain('<string>com.agentdog.daemon</string>');
    expect(xml).toContain('<key>RunAtLoad</key>');
    expect(xml).toContain('<string>/usr/local/bin/node</string>');
    expect(xml).toContain('<string>/opt/agentdog/cli-main.js</string>');
    expect(xml).toContain('<string>daemon</string>');
    expect(xml).toContain('<string>start</string>');
    expect(xml).toContain('<string>/tmp/agentdog.log</string>');
  });
});

describe('buildSystemdUnit', () => {
  it('生成 user service 单元', () => {
    const unit = buildSystemdUnit('/usr/bin/node', '/opt/agentdog/cli-main.js');
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('ExecStart="/usr/bin/node" "/opt/agentdog/cli-main.js" daemon start --no-color');
    expect(unit).toContain('WantedBy=default.target');
  });
});
