import React, { useState } from 'react';
import { Copy, RefreshCw, KeyRound } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';

// 网关设置：开关 / 端口 / apiKey 管理 + Claude Code 接入卡片（核心 UX：一键复制完整环境变量）
export const GatewaySettings: React.FC = () => {
  const { gatewayStatus, updateGateway } = useProviderStore();
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!gatewayStatus) {
    return null;
  }

  const endpoint = `http://${gatewayStatus.host}:${gatewayStatus.port}`;
  const claudeCodeEnv = [
    `ANTHROPIC_BASE_URL=${endpoint}`,
    `ANTHROPIC_API_KEY=${gatewayStatus.apiKey}`,
    `# 模型名格式：供应商slug:模型Id，如 deepseek:deepseek-chat`,
    `ANTHROPIC_MODEL=<slug>:<modelId>`,
    `ANTHROPIC_SMALL_FAST_MODEL=<slug>:<modelId>`,
  ].join('\n');

  const copyEnv = async () => {
    await navigator.clipboard.writeText(claudeCodeEnv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleEnabled = async () => {
    await updateGateway({ enabled: !gatewayStatus.enabled });
  };

  const resetApiKey = async () => {
    if (!window.confirm('重置后旧 apiKey 立即失效，已接入的 Claude Code 需要更新配置。继续？')) {
      return;
    }
    setResetting(true);
    try {
      await updateGateway({ resetApiKey: true });
    } finally {
      setResetting(false);
    }
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(gatewayStatus.apiKey);
  };

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300/50">
      <div className="card-body p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="card-title text-base">AI API 网关</h2>
            <p className="text-sm text-base-content/70 mt-0.5">
              Anthropic Messages 兼容端点，Claude Code 统一接入任意供应商
            </p>
          </div>
          <div className="flex items-center gap-3">
            {gatewayStatus.enabled && (
              <span className={`badge ${gatewayStatus.running ? 'badge-success' : 'badge-warning'} badge-sm`}>
                {gatewayStatus.running ? '运行中' : '已启用（未运行）'}
              </span>
            )}
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={gatewayStatus.enabled}
              onChange={toggleEnabled}
            />
          </div>
        </div>

        {gatewayStatus.enabled && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="form-control">
                <label className="label py-1"><span className="label-text">监听地址</span></label>
                <input className="input input-bordered input-sm" value={endpoint} readOnly />
              </div>
              <div className="form-control">
                <label className="label py-1"><span className="label-text">对外 API Key</span></label>
                <div className="join">
                  <input className="input input-bordered input-sm join-item flex-1 font-mono" value={gatewayStatus.apiKey} readOnly />
                  <button className="btn btn-ghost btn-sm join-item" onClick={copyKey} title="复制">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button className="btn btn-ghost btn-sm join-item text-warning" onClick={resetApiKey} disabled={resetting} title="重置 apiKey">
                    {resetting ? <span className="loading loading-spinner loading-xs"></span> : <RefreshCw className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Claude Code 接入卡片：前缀寻址模式下最易配错 ANTHROPIC_MODEL，直接给可复制配置 */}
            <div className="mt-3 rounded-lg bg-base-200/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="w-4 h-4 text-primary" />
                  Claude Code 接入配置
                </div>
                <button className="btn btn-primary btn-xs" onClick={copyEnv}>
                  {copied ? '已复制' : (<><Copy className="w-3 h-3" /> 复制环境变量</>)}
                </button>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap text-base-content/80 leading-relaxed">{claudeCodeEnv}</pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
