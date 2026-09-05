import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { ServiceCommands } from './service-commands';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const CLI = join(homedir(), '.npm-global', 'node_modules', '@keysqiu', 'mcpdog', 'dist', 'cli', 'cli-main.js');
const CONFIG = join(homedir(), '.mcpdog', 'mcpdog.config.json');

describe('ServiceCommands 内容构造', () => {
  it('VBS 应以隐藏窗口启动 daemon 并转义引号', () => {
    const vbs = ServiceCommands.buildVbsScript(NODE, CLI, CONFIG);

    // Run 第 2 参数 0 = 隐藏窗口，False = 不等待；VBS 字符串内引号转义为 ""
    expect(vbs).toContain(', 0, False');
    expect(vbs).toContain('daemon start');
    expect(vbs).toContain(`--config ""${CONFIG}""`);
    expect(vbs).toContain(`""${NODE}""`);
  });

  it('plist 应包含 RunAtLoad/KeepAlive 与 daemon 启动参数', () => {
    const plist = ServiceCommands.buildPlistXml(NODE, CLI, CONFIG);

    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<string>com.keysqiu.mcpdog.daemon</string>');
    expect(plist).toContain(`<string>${CLI}</string>`);
    expect(plist).toContain('daemon');
    expect(plist).toContain('start');
    expect(plist).toContain(`<string>${CONFIG}</string>`);
  });

  it('systemd unit 应包含 ExecStart 与 Restart 策略', () => {
    const unit = ServiceCommands.buildSystemdUnit(NODE, CLI, CONFIG);

    expect(unit).toContain(`ExecStart=${NODE} ${CLI} daemon start --config ${CONFIG}`);
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
  });
});
