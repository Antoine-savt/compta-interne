/**
 * Netlify Function: contrepasser
 * ─────────────────────────────────────────────────────────────────────────────
 * Correction d'une écriture par contre-passation (jamais par édition directe).
 *
 * Route : POST /api/contrepasser
 * Body JSON : { ecritureId: "docId", motif: "Erreur de montant" }
 *
 * Crée l'écriture inverse (datée dans la période ouverte) ; l'originale reste
 * comptabilisée avec un lien `contrepasseeParId`, si bien que leur effet net est nul.
 * Réponse : { ok: true, annulationId }
 */
import {
    getDb, preparerRequete, reponse, erreurServeur, lireVerrou,
    contrePasserDansTx, dateCorrection, ErreurCompta,
} from '../lib/compta.js';

export const handler = async (event) => {
    const { uid, body, erreur } = await preparerRequete(event);
    if (erreur) return erreur;
    const { ecritureId, motif } = body;
    if (!ecritureId || !motif) return reponse(400, { error: 'ecritureId et motif sont obligatoires' });

    try {
        const db = getDb();
        let annulationId;
        await db.runTransaction(async (tx) => {
            const origRef = db.collection('ecritures').doc(ecritureId);
            const snap = await tx.get(origRef);
            if (!snap.exists) throw new ErreurCompta('Écriture introuvable', 404);
            const orig = snap.data();
            if (orig.statut !== 'active') throw new ErreurCompta('Cette écriture est déjà annulée.', 409);
            const { dateVerrou } = await lireVerrou(tx);
            annulationId = contrePasserDansTx(tx, origRef, orig, { motif, uid, date: dateCorrection(dateVerrou) });
        });
        return reponse(200, { ok: true, annulationId });
    } catch (err) {
        return erreurServeur(err, 'contrepasser');
    }
};
