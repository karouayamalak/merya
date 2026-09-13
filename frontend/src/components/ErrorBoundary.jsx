import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught an error]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2.5rem',
          margin: '1.5rem',
          backgroundColor: 'var(--color-surface, #FFFFFF)',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--color-border, #E5E7EB)',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.1))',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--color-espresso, #1A1A1A)', marginBottom: '0.75rem' }}>
            {this.props.fallbackTitle || 'Une erreur inattendue est survenue'}
          </h2>
          <p style={{ fontSize: '0.88rem', color: '#666666', marginBottom: '1.5rem', maxWidth: '500px', marginInline: 'auto' }}>
            {this.state.error?.message || 'Un composant a rencontré un problème d\'affichage.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: '0.6rem 1.25rem',
              backgroundColor: 'var(--color-primary, #C5A880)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-md, 6px)',
              fontWeight: '600',
              fontSize: '0.88rem',
              cursor: 'pointer'
            }}
          >
            Réessayer / Recharger
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
