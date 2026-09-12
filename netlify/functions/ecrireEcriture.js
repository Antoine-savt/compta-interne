/**
 * Netlify Function: ecrireEcriture
 * ─────────────────────────────────────────────────────────────────────────────
 * Fonction serveur centrale (garde-fou comptable).
 * Toutes les écritures générées par l'application passent ici — jamais
 * directement dans Firestore depuis le client.
 *
 * Route : POST /api/ecrireEcriture
 *
 * Body JSON attendu :
 * {
 *   journal:    "VE" | "AC" | "BQ" | "OD",
 *   date:       "2026-09-11",          // ISO 8601
 *   libelle:    "Facture 2026-001 – Client XYZ",
 *   pieceRef?:  "2026-001",
 *   sourceType: "facture" | "depense" | "manuel" | "contrepassation",
 *   sourceId?:  "docId",
 *   mouvements: [
 *     { compte: "411", libelle: "Client XYZ",              debit: 120, credit: 0   },
 *     { compte: "706", libelle: "Prestations de services", debit: 0,   credit: 120 },
 *   ]
 * }
 *
 * Réponse 200 : { ok: true, ecritureId: "xxx" }
 * Réponse 422 : { ok: false, error: "Écriture déséquilibrée : débit 120, crédit 130" }
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ─── Initialisation Firebase Admin (singleton) ────────────────────────────────
function getAdminApp() {
    if (getApps().length > 0) return getApps()[0];
    const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    return initializeApp({ credential: cert(serviceAccount) });
}

// ─── Logique pure — testable sans serveur ─────────────────────────────────────

/**
 * Vérifie que la somme des débits == somme des crédits.
 * @param {Array<{debit: number, credit: number}>} mouvements
 * @returns {{ ok: boolean, totalDebit: number, totalCredit: number }}
 */
export function verifierEquilibre(mouvements) {
    const totalDebit = mouvements.reduce((acc, m) => acc + (m.debit ?? 0), 0);
    const totalCredit = mouvements.reduce((acc, m) => acc + (m.credit ?? 0), 0);
    const ok = Math.abs(totalDebit - totalCredit) < 0.001; // tolérance arrondi flottant
    return { ok, totalDebit, totalCredit };
}

// ─── Handler Netlify ─────────────────────────────────────────────────────────

export const handler = async (event) => {
    // Méthode
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Auth — vérification du token Firebase
    const authHeader = event.headers['authorization'] ?? '';
    const idToken = authHeader.replace('Bearer ', '').trim();
    if (!idToken) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Token manquant' }) };
    }

    let uid;
    try {
        const adminApp = getAdminApp();
        const { getAuth } = await import('firebase-admin/auth');
        const decoded = await getAuth(adminApp).verifyIdToken(idToken);
        uid = decoded.uid;
    } catch {
        return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };
    }

    // Parse body
    let body;
    try {
        body = JSON.parse(event.body ?? '{}');
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Body JSON invalide' }) };
    }

    const { journal, date, libelle, mouvements, sourceType, sourceId, pieceRef } = body;

    // Validation champs obligatoires
    if (!journal || !date || !libelle || !Array.isArray(mouvements) || mouvements.length < 2) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Champs obligatoires manquants (journal, date, libelle, mouvements ≥ 2)' }),
        };
    }
    if (!sourceType) {
        return { statusCode: 400, body: JSON.stringify({ error: 'sourceType obligatoire' }) };
    }

    // ── GARDE-FOU : équilibre débit/crédit ────────────────────────────────────
    const { ok, totalDebit, totalCredit } = verifierEquilibre(mouvements);
    if (!ok) {
        return {
            statusCode: 422,
            body: JSON.stringify({
                ok: false,
                error: `Écriture déséquilibrée : débit ${totalDebit.toFixed(2)} €, crédit ${totalCredit.toFixed(2)} €. Aucune écriture n'a été créée.`,
            }),
        };
    }

    // ── Écriture Firestore dans une transaction atomique ──────────────────────
    try {
        const adminApp = getAdminApp();
        const db = getFirestore(adminApp);

        let ecritureId;
        await db.runTransaction(async (tx) => {
            const ref = db.collection('ecritures').doc();
            ecritureId = ref.id;
            tx.set(ref, {
                journal,
                date: new Date(date),
                libelle,
                mouvements,
                sourceType,
                sourceId: sourceId ?? null,
                pieceRef: pieceRef ?? null,
                statut: 'active',
                saisieMode: sourceType === 'manuel' ? 'manuel' : 'formulaire',
                createdBy: uid,
                createdAt: FieldValue.serverTimestamp(),
            });
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, ecritureId }),
        };
    } catch (err) {
        console.error('[ecrireEcriture] Firestore error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ ok: false, error: 'Erreur serveur lors de l\'écriture en base.' }),
        };
    }
};
