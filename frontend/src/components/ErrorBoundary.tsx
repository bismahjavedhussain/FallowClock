import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keeps a WebGL crash from blanking the page: render the fallback instead. */
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Fallow Clock: a view crashed, showing its fallback.', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
