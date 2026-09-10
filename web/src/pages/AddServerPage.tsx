import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, Settings, Plus, Trash2, Terminal, Globe, Waves } from 'lucide-react';
import { useConfigStore } from '../store/configStore';
import { ServerConfig } from '../types/config';
import { apiClient } from '../utils/api';

// Server name validation pattern
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9\-_]+$/;

const TRANSPORT_OPTIONS = [
  {
    value: 'stdio',
    title: 'Stdio',
    desc: '本地命令行子进程',
    icon: Terminal,
  },
  {
    value: 'http-sse',
    title: 'HTTP SSE',
    desc: 'Server-Sent Events 长连接',
    icon: Waves,
  },
  {
    value: 'streamable-http',
    title: 'Streamable HTTP',
    desc: '流式 HTTP（推荐远程）',
    icon: Globe,
  },
] as const;

// 添加/编辑 MCP 服务器独立页面：JSON 与表单双模式，编辑通过 ?name= 进入
export const AddServerPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editName = searchParams.get('name'); // 存在即为编辑模式
  const isEdit = !!editName;

  const [addMode, setAddMode] = useState<'json' | 'form'>('json');
  const [jsonConfig, setJsonConfig] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverConfig, setServerConfig] = useState<Partial<ServerConfig>>({
    enabled: true,
    transport: 'stdio',
    toolsConfig: { mode: 'all' },
  });
  const [jsonError, setJsonError] = useState('');
  const [formError, setFormError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [nameValidation, setNameValidation] = useState<{ valid: boolean; error?: string; suggestions?: string[] }>({ valid: true });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);

  const { servers, addServer, loadConfig, setSelectedServer } = useConfigStore();

  // 编辑模式：加载并预填既有配置
  useEffect(() => {
    if (!isEdit) return;
    const existing = servers.find(s => s.name === editName);
    if (existing) {
      setServerName(existing.name);
      setServerConfig({
        enabled: existing.enabled,
        transport: existing.transport,
        description: existing.description,
        command: existing.command,
        args: existing.args,
        env: existing.env,
        url: existing.url ?? existing.endpoint,
        headers: existing.headers,
        timeout: existing.timeout,
        retries: existing.retries,
        toolsConfig: existing.toolsConfig,
      });
      setAddMode('form');
      setNameValidation({ valid: true });
      setLoaded(true);
    } else {
      // 直接以 URL 进入且 store 未加载时兜底拉取一次
      loadConfig().catch(() => setFormError('加载服务器配置失败'));
    }
  }, [isEdit, editName, servers, loadConfig]);

  // 兜底拉取完成后若找到目标则由上方 effect 预填
  useEffect(() => {
    if (isEdit && !loaded && servers.find(s => s.name === editName)) {
      setLoaded(true);
    }
  }, [isEdit, loaded, servers, editName]);

  const validateServerName = (name: string) => {
    if (!name || name.trim() === '') {
      return { valid: false, error: '服务器名称不能为空' };
    }
    if (name.length > 50) {
      return { valid: false, error: '服务器名称过长（最多 50 个字符）' };
    }
    if (!SERVER_NAME_PATTERN.test(name)) {
      return { valid: false, error: '服务器名称只能包含字母、数字、连字符和下划线', suggestions: generateNameSuggestions(name) };
    }
    return { valid: true };
  };

  const generateNameSuggestions = (invalidName: string): string[] => {
    const suggestions: string[] = [];
    const cleaned = invalidName.replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (cleaned && SERVER_NAME_PATTERN.test(cleaned)) suggestions.push(cleaned);
    const lowerCase = invalidName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '');
    if (lowerCase && SERVER_NAME_PATTERN.test(lowerCase)) suggestions.push(lowerCase);
    return suggestions.slice(0, 3);
  };

  const handleServerNameChange = (value: string) => {
    setServerName(value);
    setNameValidation(validateServerName(value));
  };

  const parseJsonConfig = (jsonText: string) => {
    setJsonError('');
    if (!jsonText.trim()) {
      setJsonError('请输入配置 JSON');
      return null;
    }
    try {
      const parsed = JSON.parse(jsonText);
      let servers: Record<string, any> = {};
      if (parsed.mcpServers) {
        servers = parsed.mcpServers;
      } else if (parsed.servers) {
        servers = parsed.servers;
      } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        servers = parsed;
      } else {
        setJsonError('配置格式无效。请提供有效的 MCP 服务器配置 JSON');
        return null;
      }
      const serverEntries = Object.entries(servers);
      if (serverEntries.length === 0) {
        setJsonError('配置中未找到任何服务器');
        return null;
      }
      return serverEntries.map(([name, config]) => ({ name, config }));
    } catch (error) {
      setJsonError(`JSON 解析错误: ${(error as Error).message}`);
      return null;
    }
  };

  const validateServerConfig = (name: string, config: any) => {
    const errors: string[] = [];
    const nameValidation = validateServerName(name);
    if (!nameValidation.valid) {
      errors.push(`服务器名称 "${name}": ${nameValidation.error}`);
    }
    if (!config.command && !config.endpoint && !config.url) {
      errors.push(`服务器 "${name}" 缺少命令或 URL 字段`);
    }
    if (config.args && !Array.isArray(config.args)) {
      errors.push(`服务器 "${name}" 的 args 必须是数组`);
    }
    if (config.env && typeof config.env !== 'object') {
      errors.push(`服务器 "${name}" 的 env 必须是对象`);
    }
    return errors;
  };

  const handleConfigChange = (field: string, value: any) => {
    setServerConfig(prev => ({ ...prev, [field]: value }));
  };

  // 环境变量管理
  const handleEnvChange = (index: number, field: 'key' | 'value', newValue: string) => {
    const currentEnv = serverConfig.env || {};
    const envEntries = Object.entries(currentEnv);
    if (field === 'key') {
      const oldKey = envEntries[index]?.[0];
      const value = envEntries[index]?.[1] || '';
      const newEnv = { ...currentEnv };
      if (oldKey) delete newEnv[oldKey];
      if (newValue.trim() && isValidEnvVarName(newValue)) {
        newEnv[newValue] = value;
      }
      handleConfigChange('env', newEnv);
    } else {
      const key = envEntries[index]?.[0];
      if (key) {
        handleConfigChange('env', { ...currentEnv, [key]: newValue });
      }
    }
  };

  const isValidEnvVarName = (name: string): boolean => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);

  const addEnvVar = () => {
    const currentEnv = serverConfig.env || {};
    let newKey = 'NEW_VAR';
    let counter = 1;
    while (currentEnv[newKey]) {
      newKey = `NEW_VAR_${counter}`;
      counter++;
    }
    handleConfigChange('env', { ...currentEnv, [newKey]: '' });
  };

  const removeEnvVar = (index: number) => {
    const currentEnv = serverConfig.env || {};
    const keyToRemove = Object.entries(currentEnv)[index]?.[0];
    if (keyToRemove !== undefined) {
      const newEnv = { ...currentEnv };
      delete newEnv[keyToRemove];
      handleConfigChange('env', newEnv);
    }
  };

  // 请求头管理
  const handleHeaderChange = (index: number, field: 'key' | 'value', newValue: string) => {
    const currentHeaders = serverConfig.headers || {};
    const headerEntries = Object.entries(currentHeaders);
    if (field === 'key') {
      const oldKey = headerEntries[index]?.[0];
      const value = headerEntries[index]?.[1] || '';
      const newHeaders = { ...currentHeaders };
      if (oldKey) delete newHeaders[oldKey];
      if (newValue.trim()) {
        newHeaders[newValue] = value;
      }
      handleConfigChange('headers', newHeaders);
    } else {
      const key = headerEntries[index]?.[0];
      if (key) {
        handleConfigChange('headers', { ...currentHeaders, [key]: newValue });
      }
    }
  };

  const addHeader = () => {
    const currentHeaders = serverConfig.headers || {};
    let newKey = 'Header-Name';
    let counter = 1;
    while (currentHeaders[newKey]) {
      newKey = `Header-Name-${counter}`;
      counter++;
    }
    handleConfigChange('headers', { ...currentHeaders, [newKey]: '' });
  };

  const removeHeader = (index: number) => {
    const currentHeaders = serverConfig.headers || {};
    const keyToRemove = Object.entries(currentHeaders)[index]?.[0];
    if (keyToRemove) {
      const newHeaders = { ...currentHeaders };
      delete newHeaders[keyToRemove];
      handleConfigChange('headers', Object.keys(newHeaders).length > 0 ? newHeaders : undefined);
    }
  };

  const handleJsonSubmit = async () => {
    const parsedServers = parseJsonConfig(jsonConfig);
    if (!parsedServers) return;

    let existingNames: string[] = [];
    try {
      const servers = await apiClient.get('/api/servers');
      existingNames = Object.keys(servers);
    } catch (error) {
      console.warn('无法检查服务器名称重复:', error);
    }

    const errors: string[] = [];
    const conflictNames: string[] = [];
    for (const { name, config } of parsedServers) {
      errors.push(...validateServerConfig(name, config));
      if (existingNames.includes(name)) {
        conflictNames.push(name);
      }
    }

    if (conflictNames.length > 0) {
      setJsonError(`检测到服务器名称冲突！以下服务器名称已存在:\n${conflictNames.map(name => `• ${name}`).join('\n')}\n\n请为这些服务器选择其他名称。`);
      return;
    }
    if (errors.length > 0) {
      setJsonError(`发现配置错误:\n${errors.join('\n')}`);
      return;
    }

    setSaving(true);
    try {
      for (const { name, config } of parsedServers) {
        // 未显式指定 transport 时按字段推断
        let transport = config.transport;
        if (!transport) {
          if (config.url || config.endpoint) {
            transport = config.type === 'sse' ? 'http-sse' : 'streamable-http';
          } else {
            transport = 'stdio';
          }
        }
        const finalConfig: any = {
          ...config,
          name,
          enabled: config.enabled !== undefined ? config.enabled : true,
          transport,
          toolsConfig: { mode: 'all' },
        };
        await addServer(name, finalConfig);
      }
      navigate('/mcp');
    } catch (error) {
      const errorMessage = (error as Error).message;
      setJsonError(errorMessage.includes('already exists')
        ? '服务器名称冲突！已存在同名服务器，请选择其他名称。'
        : `添加服务器失败: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFormSubmit = async () => {
    setFormError('');
    if (!serverName.trim() || !nameValidation.valid) {
      setFormError(nameValidation.error || '请输入服务器名称');
      return;
    }

    if (!isEdit) {
      try {
        const servers = await apiClient.get('/api/servers');
        if (Object.keys(servers).includes(serverName.trim())) {
          setFormError(`服务器名称 "${serverName.trim()}" 已存在，请选择其他名称。`);
          return;
        }
      } catch (error) {
        console.warn('无法检查服务器名称重复:', error);
      }
    }

    const finalConfig: any = { name: serverName, ...serverConfig };
    setSaving(true);
    try {
      if (isEdit) {
        await apiClient.put(`/api/servers/${editName}`, { name: serverName, config: finalConfig });
        await loadConfig();
        setSelectedServer(serverName);
      } else {
        await addServer(serverName, finalConfig);
      }
      navigate('/mcp');
    } catch (error) {
      const errorMessage = (error as Error).message;
      setFormError(errorMessage.includes('already exists')
        ? '服务器名称冲突！已存在同名服务器，请选择其他名称。'
        : `${isEdit ? '保存' : '添加'}服务器失败: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  const isStdio = serverConfig.transport === 'stdio';

  return (
    <div className="space-y-4 pb-8">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm btn-square" onClick={() => navigate('/mcp')} title="返回 MCP 服务器">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</h1>
          <p className="text-xs text-base-content/50 mt-0.5">
            {isEdit ? `正在编辑 ${editName}` : '配置一个新的 MCP 服务器接入网关'}
          </p>
        </div>
      </div>

      {/* 模式切换（编辑模式固定表单，避免误用 JSON 重复添加） */}
      {!isEdit && (
        <div className="tabs tabs-boxed w-fit">
          <button
            type="button"
            onClick={() => setAddMode('json')}
            className={`tab flex items-center gap-2 ${addMode === 'json' ? 'tab-active' : ''}`}
          >
            <FileText className="h-4 w-4" />
            <span>JSON 配置</span>
          </button>
          <button
            type="button"
            onClick={() => setAddMode('form')}
            className={`tab flex items-center gap-2 ${addMode === 'form' ? 'tab-active' : ''}`}
          >
            <Settings className="h-4 w-4" />
            <span>表单配置</span>
          </button>
        </div>
      )}

      {addMode === 'json' ? (
        <div className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body">
            <label className="label">
              <span className="label-text font-medium">服务器配置（JSON）</span>
              <span className="label-text-alt text-base-content/50">支持 mcpServers / servers / 单服务器对象三种格式</span>
            </label>
            <textarea
              value={jsonConfig}
              onChange={(e) => setJsonConfig(e.target.value)}
              rows={14}
              className="textarea textarea-bordered w-full font-mono text-sm leading-relaxed"
              placeholder={`{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}`}
            />
            {jsonError && (
              <div className="alert alert-error mt-2">
                <div className="text-sm whitespace-pre-wrap">{jsonError}</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        loaded && (
          <div className="space-y-4">
            {/* 基本信息 */}
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-5">
                <h4 className="font-semibold text-base mb-1">基本信息</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">服务器名称 *</span>
                    </label>
                    <input
                      type="text"
                      value={serverName}
                      onChange={(e) => handleServerNameChange(e.target.value)}
                      className={`input input-bordered w-full ${!nameValidation.valid ? 'input-error' : ''}`}
                      placeholder="例如：playwright, filesystem-server"
                    />
                    {!nameValidation.valid && (
                      <div className="mt-2 text-error text-sm">
                        {nameValidation.error}
                        {nameValidation.suggestions && nameValidation.suggestions.length > 0 && (
                          <div className="mt-1">
                            <span className="text-base-content/70">建议: </span>
                            {nameValidation.suggestions.map((suggestion, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => handleServerNameChange(suggestion)}
                                className="btn btn-link btn-xs p-0 mr-2"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-base-content/50">
                      仅允许字母、数字、连字符和下划线
                    </div>
                  </div>
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">描述</span>
                    </label>
                    <textarea
                      value={serverConfig.description || ''}
                      onChange={(e) => handleConfigChange('description', e.target.value)}
                      rows={2}
                      className="textarea textarea-bordered w-full"
                      placeholder="可选的服务器描述..."
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 传输方式：卡片式选择 */}
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-5">
                <h4 className="font-semibold text-base mb-3">传输方式</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  {TRANSPORT_OPTIONS.map(({ value, title, desc, icon: Icon }) => {
                    const active = serverConfig.transport === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleConfigChange('transport', value)}
                        className={`flex flex-col items-start gap-2 p-4 rounded-box border text-left transition-all ${
                          active
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/40 shadow-sm'
                            : 'border-base-300 bg-base-200/40 hover:border-base-content/30 hover:bg-base-200'
                        }`}
                      >
                        <Icon className={`w-5 h-5 ${active ? 'text-primary' : 'text-base-content/50'}`} />
                        <div className={`font-medium ${active ? 'text-primary' : ''}`}>{title}</div>
                        <div className="text-xs text-base-content/50">{desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 连接配置 */}
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-5">
                <h4 className="font-semibold text-base mb-3">连接配置</h4>
                {isStdio ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="md:col-span-1">
                        <label className="label">
                          <span className="label-text font-medium">命令 *</span>
                        </label>
                        <input
                          type="text"
                          value={serverConfig.command || ''}
                          onChange={(e) => handleConfigChange('command', e.target.value)}
                          className="input input-bordered w-full font-mono"
                          placeholder="npx / node / python"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="label">
                          <span className="label-text font-medium">参数（每行一个）</span>
                        </label>
                        <textarea
                          value={serverConfig.args?.join('\n') || ''}
                          onChange={(e) => handleConfigChange('args', e.target.value.split('\n').filter(Boolean))}
                          rows={3}
                          className="textarea textarea-bordered w-full font-mono"
                          placeholder={'@modelcontextprotocol/server-filesystem\n/path/to/directory'}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label">
                        <span className="label-text font-medium">环境变量</span>
                      </label>
                      <div className="space-y-2">
                        {Object.entries(serverConfig.env || {}).map(([key, value], index) => (
                          <div key={index} className="flex gap-2">
                            <input
                              type="text"
                              value={key}
                              onChange={(e) => handleEnvChange(index, 'key', e.target.value)}
                              className="input input-bordered input-sm flex-1 font-mono"
                              placeholder="变量名"
                            />
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => handleEnvChange(index, 'value', e.target.value)}
                              className="input input-bordered input-sm flex-1 font-mono"
                              placeholder="值"
                            />
                            <button
                              type="button"
                              onClick={() => removeEnvVar(index)}
                              className="btn btn-ghost btn-sm btn-square text-error"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={addEnvVar} className="btn btn-ghost btn-sm gap-2">
                          <Plus className="h-4 w-4" />
                          <span>添加环境变量</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="label">
                        <span className="label-text font-medium">URL *</span>
                      </label>
                      <input
                        type="url"
                        value={serverConfig.url || serverConfig.endpoint || ''}
                        onChange={(e) => handleConfigChange('url', e.target.value)}
                        className="input input-bordered w-full font-mono"
                        placeholder="https://api.example.com/mcp"
                      />
                    </div>
                    <div>
                      <label className="label">
                        <span className="label-text font-medium">请求头</span>
                      </label>
                      <div className="space-y-2">
                        {Object.entries(serverConfig.headers || {}).map(([key, value], index) => (
                          <div key={index} className="flex gap-2">
                            <input
                              type="text"
                              value={key}
                              onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                              className="input input-bordered input-sm flex-1 font-mono"
                              placeholder="Header 名称"
                            />
                            <input
                              type="text"
                              value={value as string}
                              onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                              className="input input-bordered input-sm flex-1 font-mono"
                              placeholder="Header 值"
                            />
                            <button
                              type="button"
                              onClick={() => removeHeader(index)}
                              className="btn btn-ghost btn-sm btn-square text-error"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={addHeader} className="btn btn-ghost btn-sm gap-2">
                          <Plus className="h-4 w-4" />
                          <span>添加请求头</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 高级选项 */}
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-5">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-base">高级选项</h4>
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="btn btn-ghost btn-sm">
                    {showAdvanced ? '隐藏' : '显示'}高级
                  </button>
                </div>
                {showAdvanced && (
                  <div className="grid gap-4 md:grid-cols-2 mt-2">
                    <div>
                      <label className="label">
                        <span className="label-text font-medium">超时（毫秒）</span>
                      </label>
                      <input
                        type="number"
                        value={serverConfig.timeout || ''}
                        onChange={(e) => handleConfigChange('timeout', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="input input-bordered w-full"
                        placeholder="30000"
                      />
                    </div>
                    <div>
                      <label className="label">
                        <span className="label-text font-medium">重试次数</span>
                      </label>
                      <input
                        type="number"
                        value={serverConfig.retries || ''}
                        onChange={(e) => handleConfigChange('retries', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="input input-bordered w-full"
                        placeholder="3"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {formError && (
              <div className="alert alert-error">
                <div className="text-sm">{formError}</div>
              </div>
            )}
          </div>
        )
      )}

      {/* 底部粘性操作条：正常圆角卡片收在内容区内，不越界 */}
      <div className="sticky bottom-4 z-10 glass border border-base-300 rounded-box shadow-lg px-4 py-3 flex items-center justify-end gap-3">
        <button type="button" className="btn btn-ghost rounded-box" onClick={() => navigate('/mcp')}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary rounded-box"
          disabled={saving || (addMode === 'form' && (!loaded || !nameValidation.valid))}
          onClick={addMode === 'json' ? handleJsonSubmit : handleFormSubmit}
        >
          {saving ? '保存中...' : isEdit ? '保存修改' : '添加服务器'}
        </button>
      </div>
    </div>
  );
};
