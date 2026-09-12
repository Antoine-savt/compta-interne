import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Login() {
    const { user, login, loginGoogle } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loadingEmail, setLoadingEmail] = useState(false);
    const [loadingGoogle, setLoadingGoogle] = useState(false);
    const [error, setError] = useState('');

    if (user) return <Navigate to="/" replace />;

    async function handleEmailLogin(e) {
        e.preventDefault();
        if (!email.trim() || !password) {
            setError('Veuillez renseigner votre email et mot de passe.');
            return;
        }
        setError('');
        setLoadingEmail(true);
        try {
            await login(email.trim(), password);
        } catch (err) {
            console.error('Erreur login email:', err);
            setError(err.message || 'Email ou mot de passe incorrect.');
        } finally {
            setLoadingEmail(false);
        }
    }

    async function handleGoogle() {
        setError('');
        setLoadingGoogle(true);
        try {
            await loginGoogle();
        } catch (e) {
            console.error('Erreur login Google:', e);
            if (e.code === 'auth/unauthorized-domain') {
                setError('Domaine non autorisé sur Firebase. Utilisez vos identifiants email/mot de passe ci-dessus ou ajoutez ce domaine dans la console Firebase.');
            } else {
                setError('Connexion Google annulée ou échouée.');
            }
        } finally {
            setLoadingGoogle(false);
        }
    }

    const isBusy = loadingEmail || loadingGoogle;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '100vh', padding: 20, background: 'var(--bg)',
        }}>
            <div style={{ width: '100%', maxWidth: 400 }}>

                {/* Logo & Titre */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>
                        Compta<span style={{ color: 'var(--accent)' }}>.</span>
                    </h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 14 }}>
                        Comptabilité interne — Accès sécurisé
                    </p>
                </div>

                {/* Carte de connexion */}
                <div className="card card--elevated" style={{ padding: 32 }}>
                    {error && (
                        <div className="notice notice--danger" style={{ marginBottom: 20, fontSize: 13, textAlign: 'left' }}>
                            {error}
                        </div>
                    )}

                    {/* Formulaire Email / Mot de passe */}
                    <form onSubmit={handleEmailLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                            <label className="form-label" style={{ marginBottom: 6, display: 'block', fontSize: 13 }}>
                                Adresse email
                            </label>
                            <input
                                type="email"
                                className="form-input"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="votre@email.com"
                                required
                                disabled={isBusy}
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="form-label" style={{ marginBottom: 6, display: 'block', fontSize: 13 }}>
                                Mot de passe
                            </label>
                            <input
                                type="password"
                                className="form-input"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••••••"
                                required
                                disabled={isBusy}
                            />
                        </div>

                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={isBusy}
                            style={{
                                width: '100%',
                                padding: '11px 16px',
                                fontSize: 14,
                                fontWeight: 600,
                                marginTop: 4,
                            }}
                        >
                            {loadingEmail ? 'Connexion en cours...' : 'Se connecter'}
                        </button>
                    </form>

                    {/* Séparateur */}
                    <div style={{
                        display: 'flex', alignItems: 'center', margin: '24px 0',
                        color: 'var(--text-muted)', fontSize: 12,
                    }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        <span style={{ padding: '0 12px', textTransform: 'uppercase', letterSpacing: 1 }}>ou</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>

                    {/* Bouton Google */}
                    <button
                        type="button"
                        onClick={handleGoogle}
                        disabled={isBusy}
                        style={{
                            width: '100%', padding: '11px 16px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                            background: 'var(--bg-surface-elevated, #ffffff)',
                            color: '#1f1f1f',
                            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                            fontSize: 14, fontWeight: 500, cursor: isBusy ? 'not-allowed' : 'pointer',
                            transition: 'background 0.15s, opacity 0.15s',
                            opacity: isBusy ? 0.6 : 1,
                            fontFamily: 'inherit',
                        }}
                    >
                        {/* Logo Google SVG */}
                        <svg width="18" height="18" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                            <path fill="none" d="M0 0h48v48H0z" />
                        </svg>
                        {loadingGoogle ? 'Connexion Google...' : 'Continuer avec Google'}
                    </button>

                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 20, textAlign: 'center' }}>
                        Accès réservé aux associés et administrateurs habilités.
                    </p>
                </div>
            </div>
        </div>
    );
}
