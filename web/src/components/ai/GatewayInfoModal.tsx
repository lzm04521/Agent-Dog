import React, { useState } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';

const codeBoxClass = 'font-mono text-xs bg-base-200/70 border border-base-300/60 rounded-field px-2 py-1 break-all';

// 网关配置信息弹窗：apiKey 管理、各方言端点地址（同端口按前缀区分）、监听与运行状态
export const GatewayInfoModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { gatewayStatus, updateGateway } = useProviderStore();
  const [resetting, setResetting] = useState(false);

  if (!gatewayStatus) {
    return null;
  }

  const base = `http://${gatewayStatus.host}:${gatewayStatus.port}`;

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const resetApiKey = async () => {
    if (!window.confirm('重置后旧 apiKey 立即失效，已接入的客户端需要更新配置。继续？')) {
      return;
    }
    setResetting(true);
    try {
      await updateGateway({ resetApiKey: true });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">AI API 网关 · 配置信息</h3>
          <button className="btn btn-ghost btn-sm btn-square" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid gap-3">
          <div>
            <div className="text-xs text-base-content/50 mb-1.5">apiKey（客户端认证用）</div>
            <div className="flex items-center gap-2 min-w-0">
              <code className={`${codeBoxClass} flex-1 min-w-0`}>{gatewayStatus.apiKey}</code>
              <button className="btn btn-ghost btn-xs btn-square shrink-0" onClick={() => copy(gatewayStatus.apiKey)} title="复制 apiKey">
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                className="btn btn-ghost btn-xs btn-square text-warning shrink-0"
                onClick={resetApiKey}
                disabled={resetting}
                title="重置 apiKey"
              >
                {resetting ? <span className="loading loading-spinner loading-xs"></span> : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs text-base-content/50 mb-1.5">Anthropic 网关地址</div>
            <div className="flex items-center gap-2 min-w-0">
              <code className={`${codeBoxClass} flex-1 min-w-0`}>{base}/anthropic</code>
              <button className="btn btn-ghost btn-xs btn-square shrink-0" onClick={() => copy(`${base}/anthropic`)} title="复制地址">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-xs text-base-content/40 mt-1">Claude Code 设 ANTHROPIC_BASE_URL 指向 {base}/anthropic</div>
          </div>

          <div>
            <div className="text-xs text-base-content/50 mb-1.5">OpenAI 网关地址</div>
            <div className="flex items-center gap-2 min-w-0">
              <code className={`${codeBoxClass} flex-1 min-w-0`}>{base}/openai/v1</code>
              <button className="btn btn-ghost btn-xs btn-square shrink-0" onClick={() => copy(`${base}/openai/v1`)} title="复制地址">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-xs text-base-content/40 mt-1">
              Cherry Studio / Cline 等 OpenAI 兼容客户端 base URL 指向 {base}/openai/v1，API key 填网关 apiKey，模型列表经 /v1/models 自动发现
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-base-content/50 mb-1.5">监听（与 Web 管理界面同端口）</div>
              <code className={codeBoxClass}>{gatewayStatus.host}:{gatewayStatus.port}</code>
            </div>
            <div>
              <div className="text-xs text-base-content/50 mb-1.5">运行状态</div>
              <span className={`badge ${gatewayStatus.running ? 'badge-success' : 'badge-warning'} badge-sm`}>
                {gatewayStatus.running ? '运行中' : '已启用（未运行）'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-xs text-base-content/40 mt-4">
          模型寻址格式：<code className="font-mono">slug:modelId</code>（如 <code className="font-mono">deepseek:deepseek-chat</code>），按供应商 slug 路由到上游。
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>关闭</button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
};
