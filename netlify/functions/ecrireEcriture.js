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
 *   journal:    "VT" | "AC" | "BQ" | "OD",
 *   date:       "2026-09-11",          // ISO 8601
 *   libelle:    "Facture 2026-001 – Client XYZ",
 *   pieceRef?:  "2026-001",
 *   sourceType: "facturation" | "depense" | "manuel" | ...,
 *   sourceId?:  "docId",
 *   mouvements: [
 *     { compte: "411", libelle: "Client XYZ",              debit: 120, credit: 0   },
 *     { compte: "706", libelle: "Prestations de services", debit: 0,   credit: 120 },
 *   ]
 * }
 *
 * Contrôles : équilibre, comptes, montants, date hors période validée.
 * Réponse 200 : { ok: true, ecritureId: "xxx" }
 */
import {
    getDb, preparerRequete, reponse, erreurServeur, controlerEcriture,
    lireVerrou, controlerPeriodeOuverte, nouvelleEcriture,
} from '../lib/compta.js';

export { verifierEquilibre } from '../lib/compta.js';

export const handler = async (event) => {
    const { uid, body, erreur } = await preparerRequete(event);
    if (erreur) return erreur;
    if (!body.sourceType) return reponse(400, { error: 'sourceType obligatoire' });

    try {
        const mouvements = controlerEcriture(body);
        const db = getDb();
        let ecritureId;
        await db.runTransaction(async (tx) => {
            const { dateVerrou } = await lireVerrou(tx);
            controlerPeriodeOuverte(body.date, dateVerrou);
            const ref = db.collection('ecritures').doc();
            ecritureId = ref.id;
            tx.set(ref, nouvelleEcriture({ ...body, mouvements }, uid));
        });
        return reponse(200, { ok: true, ecritureId });
    } catch (err) {
        return erreurServeur(err, 'ecrireEcriture');
    }
};
