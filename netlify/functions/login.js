/**
 * Netlify Function: login
 * ─────────────────────────────────────────────────────────────────────────────
 * Permet une authentification sécurisée par identifiants administrateur
 * définis dans les variables d'environnement (.env.local / Netlify).
 * Génère un token d'authentification Firebase (Custom Token) sans dépendre
 * de Google OAuth ou des restrictions de domaine.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function getAdminApp() {
    if (getApps().length > 0) return getApps()[0];
    const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    return initializeApp({ credential: cert(serviceAccount) });
}

export async function handler(event) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Méthode non autorisée' }),
        };
    }

    let body;
    try {
        body = JSON.parse(event.body ?? '{}');
    } catch {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Format JSON invalide' }),
        };
    }

    const { email, password } = body;
    if (!email || !password) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Email et mot de passe requis' }),
        };
    }

    const adminEmail = process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Identifiants admin non configurés dans les variables d\'environnement (ADMIN_EMAIL, ADMIN_PASSWORD)',
            }),
        };
    }

    // Vérification stricte des identifiants privés
    if (email.trim().toLowerCase() !== adminEmail.trim().toLowerCase() || password !== adminPassword) {
        return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Email ou mot de passe incorrect' }),
        };
    }

    try {
        getAdminApp();
        const auth = getAuth();
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(email.trim().toLowerCase());
        } catch (e) {
            // Création automatique si l'utilisateur n'existe pas encore
            userRecord = await auth.createUser({
                email: email.trim().toLowerCase(),
                emailVerified: true,
                displayName: 'Administrateur',
            });
        }

        // Génération du Custom Token Firebase
        const customToken = await auth.createCustomToken(userRecord.uid);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true, customToken }),
        };
    } catch (err) {
        console.error('Erreur Firebase Auth dans /api/login:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Erreur lors de la génération de session' }),
        };
    }
}
