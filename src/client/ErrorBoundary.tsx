/**
 * 简单 React 错误边界: 子组件抛错时只在此区域显示错误信息与重试按钮,
 * 不再让整个工作台页签(甚至整个应用树)白屏卸载。
 */
import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error('[dsh-workbench] 组件异常:', error)
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ border: '1px solid #e2544d', background: '#2a1718', borderRadius: 8, padding: 12, fontSize: 12, color: '#e2544d' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {this.props.label ?? '组件'}渲染异常
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error.message}</div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8, background: '#171b22', border: '1px solid #2a3140', color: '#dbe2ee', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
