import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

export const ServerLogs: React.FC<{ serverName: string }> = ({ serverName }) => {
  const logs = useAppStore(state => state.serverLogs[serverName] || []);
  const addServerLog = useAppStore(state => state.addServerLog);
  const [logLevel, setLogLevel] = useState<string>('all');
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  
  console.log(`[ServerLogs] Rendering for server: ${serverName}, logs count: ${logs.length}`, logs);

  // Load historical logs when component mounts or serverName changes
  useEffect(() => {
    const loadHistoricalLogs = async () => {
      // Only load if we don't have logs for this server yet
      if (logs.length > 0) {
        return;
      }

      setIsLoadingHistory(true);
      try {
        const response = await fetch(`/api/logs/${serverName}?limit=100`);
        if (response.ok) {
          const historicalLogs = await response.json();
          console.log(`[ServerLogs] Loaded ${historicalLogs.length} historical logs for ${serverName}`);
          
          // Convert historical logs to the format expected by the store
          historicalLogs.forEach((logEntry: any) => {
            addServerLog({
              serverName,
              stream: logEntry.source || 'system',
              data: `[${logEntry.level.toUpperCase()}] ${logEntry.message}`,
              timestamp: logEntry.timestamp
            });
          });
        } else {
          console.warn(`[ServerLogs] Failed to load historical logs for ${serverName}: ${response.status}`);
        }
      } catch (error) {
        console.error(`[ServerLogs] Error loading historical logs for ${serverName}:`, error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistoricalLogs();
  }, [serverName, logs.length, addServerLog]);

  // Filter logs based on level and debug setting
  const filteredLogs = logs.filter(log => {
    if (!showDebug && log.data?.includes('[DEBUG]')) {
      return false;
    }
    if (logLevel === 'all') return true;
    return log.data?.includes(`[${logLevel.toUpperCase()}]`);
  });

  const getLogStyle = (logData: string, stream: string) => {
    if (logData?.includes('[ERROR]') || stream === 'stderr') {
      return 'text-error';
    }
    if (logData?.includes('[WARN]')) {
      return 'text-warning';
    }
    if (logData?.includes('[DEBUG]')) {
      return 'text-base-content/60';
    }
    if (logData?.includes('[INFO]')) {
      return 'text-success';
    }
    return 'text-base-content';
  };

  const getSourceIcon = (stream: string) => {
    switch (stream) {
      case 'stderr': return '🔴';
      case 'stdout': return '🔵';
      case 'system': return '⚙️';
      default: return '📝';
    }
  };

  return (
    <div className="card bg-base-200">
      {/* Controls */}
      <div className="p-3 border-b border-base-300 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <select 
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value)}
            className="select select-sm bg-base-100 text-base-content"
          >
            <option value="all">全部级别</option>
            <option value="info">信息</option>
            <option value="warn">警告</option>
            <option value="error">错误</option>
            <option value="debug">调试</option>
          </select>
          <label className="label cursor-pointer space-x-2">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="checkbox checkbox-sm"
            />
            <span className="label-text">显示调试日志</span>
          </label>
        </div>
        <div className="text-sm text-base-content/60">
          {filteredLogs.length} / {logs.length} 条日志
        </div>
      </div>

      {/* Log Content */}
      <div className="font-mono text-sm p-4 h-96 overflow-y-auto bg-base-100">
        {isLoadingHistory ? (
          <div className="text-center py-8 text-base-content/60">
            <p className="mb-2">📥 正在加载历史日志...</p>
            <div className="loading loading-dots loading-md">正在为 {serverName} 加载服务器日志...</div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-base-content/60">
            <p>暂无日志记录</p>
            <p className="text-xs mt-2">MCP 服务器连接后运行日志将显示在这里</p>
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div key={index} className={`flex items-start mb-1 ${getLogStyle(log.data, log.stream)}`}>
              <span className="flex-shrink-0 mr-2 text-xs text-base-content/50">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className="flex-shrink-0 mr-2 text-xs">
                {getSourceIcon(log.stream)}
              </span>
              <span className="whitespace-pre-wrap break-all">{log.data}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};