import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Login() {
    const { user, loginGoogle } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (user) return <Navigate to="/" replace />;

    async function handleGoogle() {
        setError(''); setLoading(true);
        try {
            await loginGoogle();
        } catch (e) {
            setError('Connexion annulée ou erreur. Réessayez.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '100vh', padding: 20, background: 'var(--bg)',
        }}>
            <div style={{ width: '100%', maxWidth: 380 }}>

                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: 36 }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}></div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>
                        Compta<span style={{ color: 'var(--accent)' }}>.</span>
                    </h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 14 }}>
                        Comptabilité interne  accès privé
                    </p>
                </div>

                {/* Carte */}
                <div className="card card--elevated" style={{ padding: 32, textAlign: 'center' }}>
                    {error && (
                        <div className="notice notice--danger" style={{ marginBottom: 20 }}>
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleGoogle}
                        disabled={loading}
                        style={{
                            width: '100%', padding: '12px 20px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                            background: 'white', color: '#1f1f1f',
                            border: 'none', borderRadius: 'var(--radius)',
                            fontSize: 15, fontWeight: 600, cursor: 'pointer',
                            transition: 'opacity 0.15s',
                            opacity: loading ? 0.6 : 1,
                            fontFamily: 'inherit',
                        }}
                    >
                        {/* Logo Google SVG */}
                        <svg width="20" height="20" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                            <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                        {loading ? 'Connexion' : 'Se connecter avec Google'}
                    </button>

                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
                        Seuls les comptes autorisés peuvent accéder à cette application.
                    </p>
                </div>
            </div>
        </div>
    );
}
