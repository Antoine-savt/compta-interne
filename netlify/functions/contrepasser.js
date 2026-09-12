/**
 * Netlify Function: contrepasser
 * ─────────────────────────────────────────────────────────────────────────────
 * Correction d'une écriture par contre-passation (jamais par édition directe).
 *
 * Route : POST /api/contrepasser
 *
 * Body JSON :
 * {
 *   ecritureId: "docId",
 *   motif:      "Erreur de montant — correction du 2026-09-11"
 * }
 *
 * Ce que ça fait :
 * 1. Lit l'écriture originale
 * 2. Crée une nouvelle écriture avec débit↔crédit inversés (passe par ecrireEcriture)
 * 3. Marque l'écriture originale : statut="annulee", annuleeParId, annuleeLeDate
 * 4. Retourne { ok: true, annulationId } pour permettre la re-saisie ensuite
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifierEquilibre } from './ecrireEcriture.js';

function getAdminApp() {
    if (getApps().length > 0) return getApps()[0];
    const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    return initializeApp({ credential: cert(serviceAccount) });
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Auth
    const idToken = (event.headers['authorization'] ?? '').replace('Bearer ', '').trim();
    if (!idToken) return { statusCode: 401, body: JSON.stringify({ error: 'Token manquant' }) };

    let uid;
    try {
        const adminApp = getAdminApp();
        const { getAuth } = await import('firebase-admin/auth');
        const decoded = await getAuth(adminApp).verifyIdToken(idToken);
        uid = decoded.uid;
    } catch {
        return { statusCode: 401, body: JSON.stringify({ error: 'Token invalide' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body ?? '{}');
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Body JSON invalide' }) };
    }

    const { ecritureId, motif } = body;
    if (!ecritureId || !motif) {
        return { statusCode: 400, body: JSON.stringify({ error: 'ecritureId et motif sont obligatoires' }) };
    }

    const adminApp = getAdminApp();
    const db = getFirestore(adminApp);

    // Lire l'écriture originale
    const origRef = db.collection('ecritures').doc(ecritureId);
    const origSnap = await origRef.get();
    if (!origSnap.exists) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Écriture introuvable' }) };
    }
    const orig = origSnap.data();
    if (orig.statut === 'annulee') {
        return { statusCode: 409, body: JSON.stringify({ error: 'Cette écriture est déjà annulée' }) };
    }

    // Construire les mouvements inversés
    const mouvementsInverses = (orig.mouvements ?? []).map((m) => ({
        compte: m.compte,
        libelle: m.libelle,
        debit: m.credit,   // inversion débit ↔ crédit
        credit: m.debit,
    }));

    // Vérification d'équilibre (redondante mais sécurisante)
    const { ok } = verifierEquilibre(mouvementsInverses);
    if (!ok) {
        return { statusCode: 422, body: JSON.stringify({ error: 'Contre-passation déséquilibrée — contacter le support.' }) };
    }

    // Écriture de la contre-passation + marquage de l'originale — dans une seule transaction
    const today = new Date().toISOString().split('T')[0];
    let annulationId;

    try {
        await db.runTransaction(async (tx) => {
            // Nouvelle écriture d'annulation
            const annulRef = db.collection('ecritures').doc();
            annulationId = annulRef.id;
            tx.set(annulRef, {
                journal: orig.journal,
                date: new Date(today),
                libelle: `CONTRE-PASSATION — ${orig.libelle} — ${motif}`,
                mouvements: mouvementsInverses,
                sourceType: 'contrepassation',
                sourceId: ecritureId,
                pieceRef: orig.pieceRef ?? null,
                statut: 'active',
                saisieMode: 'formulaire',
                createdBy: uid,
                createdAt: FieldValue.serverTimestamp(),
            });

            // Marquage de l'écriture originale
            tx.update(origRef, {
                statut: 'annulee',
                annuleeParId: annulationId,
                annuleeLeDate: FieldValue.serverTimestamp(),
            });
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, annulationId }),
        };
    } catch (err) {
        console.error('[contrepasser] error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ ok: false, error: 'Erreur serveur lors de la contre-passation.' }),
        };
    }
};
