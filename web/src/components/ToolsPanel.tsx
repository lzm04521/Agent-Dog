import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  ToggleLeft, 
  ToggleRight, 
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { useConfigStore } from '../store/configStore';
import { ServerWithTools, ToolWithConfig } from '../types/config';
import { apiClient } from '../utils/api';

interface ToolsPanelProps {
  server: ServerWithTools;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = ({ server }) => {
  const [tools, setTools] = useState<ToolWithConfig[]>([]);
  const [toolsConfig, setToolsConfig] = useState(server?.toolsConfig || { mode: 'all' });
  const [loading, setLoading] = useState(true);
  const [showAllTools] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const { toggleServerTool, updateServerTools } = useConfigStore();

  useEffect(() => {
    // Check if server exists
    if (!server?.name) {
      setLoading(false);
      setTools([]);
      return;
    }
    
    loadServerTools().then(() => {
      // Ensure blacklist mode is used
      ensureBlacklistMode();
    });
  }, [server?.name, server?.connected, server?.toolCount]);

  const loadServerTools = async () => {
    // Check if server exists
    if (!server?.name) {
      setLoading(false);
      setTools([]);
      return;
    }
    
    setLoading(true);
    try {
      const data = await apiClient.get(`/api/servers/${server?.name}/tools`);
      setTools(data.tools);
      setToolsConfig(data.toolsConfig);
    } catch (error) {
      console.error('加载服务器工具失败:', error);
      setTools([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTool = async (toolName: string) => {
    // Check if server exists
    if (!server?.name) {
      console.warn('无法切换工具: 未找到服务器');
      return;
    }
    
    // Immediately update local state to avoid tool disappearance
    setTools(prevTools => 
      prevTools.map(tool => 
        tool.name === toolName 
          ? { ...tool, enabled: !tool.enabled }
          : tool
      )
    );
    
    try {
      await toggleServerTool(server?.name || '', toolName);
      console.log('工具切换成功，跳过重载以避免界面闪烁');
      // Don't reload, maintain local state to avoid tool disappearance
      // await loadServerTools();
    } catch (error) {
      console.error('切换工具状态失败:', error);
      // Restore original state on failure
      setTools(prevTools => 
        prevTools.map(tool => 
          tool.name === toolName 
            ? { ...tool, enabled: !tool.enabled }
            : tool
        )
      );
    }
  };

  // Always use blacklist mode
  const ensureBlacklistMode = async () => {
    // Check if server exists
    if (!server?.name) {
      return;
    }
    
    if (toolsConfig.mode !== 'blacklist') {
      const newConfig = { ...toolsConfig, mode: 'blacklist' as const };
      setToolsConfig(newConfig);
      try {
        await updateServerTools(server?.name || '', newConfig);
        await loadServerTools();
      } catch (error) {
        console.warn(`Failed to update tools config for ${server?.name}:`, error);
        // Server may have been deleted, ignore error
      }
    }
  };

  const handleBulkToggle = async (enable: boolean) => {
    // Check if server exists
    if (!server?.name) {
      console.warn('无法批量切换工具: 未找到服务器');
      return;
    }
    
    const filteredTools = getFilteredTools();
    for (const tool of filteredTools) {
      if (tool.enabled !== enable) {
        await toggleServerTool(server?.name || '', tool.name);
      }
    }
    await loadServerTools();
  };

  const getFilteredTools = () => {
    let filtered = tools;
    
    if (searchTerm) {
      filtered = filtered.filter(tool => 
        tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tool.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Always show all tools, don't filter disabled tools
    
    return filtered;
  };

  const enabledCount = tools.filter(tool => tool.enabled).length;
  const filteredTools = getFilteredTools();

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="text-base-content/70">正在加载工具列表...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Tool control instructions（置于表头上方） */}
      {tools.length > 0 && (
        <div className="mb-6 alert alert-info">
          <div className="flex items-start space-x-3">
            <AlertCircle className="h-5 w-5" />
            <div className="text-sm">
              <p className="font-medium mb-1">关于工具控制</p>
              <ul className="list-disc list-inside space-y-1">
                <li>已启用的工具将对 MCP 客户端可见可用</li>
                <li>已禁用的工具将从 MCP 客户端隐藏</li>
                <li>更改工具状态后，MCP 客户端可能需要重新连接才能看到变化</li>
                <li>某些工具可能依赖其他工具，请谨慎禁用</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tool control header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium text-base-content">工具列表</h3>
          <p className="text-sm text-base-content/70 mt-1">
            查看并管理 {server?.name} 服务器提供的工具，可禁用不需要的工具
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadServerTools}
            className="btn btn-outline btn-sm flex items-center space-x-2"
          >
            <RefreshCw className="h-4 w-4" />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* Tool statistics and control mode */}
      <div className="bg-base-200 p-4 rounded-lg mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{tools.length}</div>
              <div className="text-sm text-base-content/70">工具总数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-success">{enabledCount}</div>
              <div className="text-sm text-base-content/70">已启用</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-error">{tools.length - enabledCount}</div>
              <div className="text-sm text-base-content/70">已禁用</div>
            </div>
          </div>
        </div>

      </div>

      {/* Tool filtering and batch operations */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <input
              type="text"
              placeholder="搜索工具..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input input-bordered w-full max-w-xs"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2.5 text-base-content/40 hover:text-base-content/60"
              >
                ×
              </button>
            )}
          </div>

        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleBulkToggle(true)}
            className="btn btn-outline btn-sm"
          >
            全部启用
          </button>
          <button
            onClick={() => handleBulkToggle(false)}
            className="btn btn-outline btn-sm"
          >
            全部禁用
          </button>
        </div>
      </div>

      {/* Tool list */}
      <div className="space-y-3">
        {filteredTools.length === 0 ? (
          <div className="text-center py-8 text-base-content/70">
            <Zap className="h-12 w-12 mx-auto mb-4 text-base-content/30" />
            <p className="mb-2">
              {searchTerm ? '未找到匹配的工具' :
               showAllTools ? '该服务器未提供任何工具' : '没有已启用的工具'}
            </p>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="text-primary hover:text-primary-focus text-sm"
              >
                清除搜索
              </button>
            )}
          </div>
        ) : (
          filteredTools.map((tool) => (
            <div
              key={tool.name}
              className={`card border transition-all p-4 ${
                tool.enabled ? 'border-success/30 bg-success/10' : 'border-base-300 bg-base-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h4 className="font-medium text-base-content">{tool.name}</h4>
                    <span className={`badge badge-sm ${
                      tool.enabled ? 'badge-success' : 'badge-ghost'
                    }`}>
                      {tool.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>

                  <p className="text-sm text-base-content/80 mb-3">{tool.description}</p>

                  {tool.inputSchema && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-base-content/70 hover:text-base-content">
                        查看参数结构
                      </summary>
                      <pre className="bg-base-100 p-2 rounded border border-base-300 mt-2 overflow-x-auto text-base-content">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => handleToggleTool(tool.name)}
                    className={`btn btn-ghost btn-sm ${
                      tool.enabled
                        ? 'text-success hover:bg-success/20'
                        : 'text-base-content/40 hover:bg-base-200'
                    }`}
                    title={tool.enabled ? '禁用该工具' : '启用该工具'}
                  >
                    {tool.enabled ? (
                      <ToggleRight className="h-6 w-6" />
                    ) : (
                      <ToggleLeft className="h-6 w-6" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};