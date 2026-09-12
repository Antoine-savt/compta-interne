import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithCustomToken,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
} from 'firebase/auth';
import { auth } from '../firebase';

const AuthContext = createContext(null);
const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });
        return unsub;
    }, []);

    const login = async (email, password) => {
        // 1. Tenter la connexion sécurisée via Netlify Function (/api/login)
        // avec vérification des identifiants privés (.env.local / Netlify)
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (res.ok && data.customToken) {
                return await signInWithCustomToken(auth, data.customToken);
            }
            if (res.status === 401) {
                throw new Error(data.error || 'Email ou mot de passe incorrect');
            }
        } catch (err) {
            if (err.message.includes('incorrect')) {
                throw err;
            }
        }

        // 2. Fallback Firebase direct
        return signInWithEmailAndPassword(auth, email, password);
    };

    const loginGoogle = () => signInWithPopup(auth, googleProvider);
    const logout = () => signOut(auth);

    return (
        <AuthContext.Provider value={{ user, loading, login, loginGoogle, logout }}>
            {!loading && children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);


