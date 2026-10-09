/**
 * Netlify Function: annulerEcriture
 * ─────────────────────────────────────────────────────────────────────────────
 * Supprime l'effet d'une écriture sans jamais l'effacer :
 * - brouillard (non validée, période ouverte) : statut "annulee", l'écriture sort des comptes ;
 * - écriture figée : contre-passation datée dans la période ouverte.
 * Une écriture déjà annulée ou contre-passée est laissée telle quelle.
 *
 * Route : POST /api/annulerEcriture
 * Body : { ecritureId, motif }
 * Réponse : { ok, mode: "brouillard" | "contrepassation" | "deja_annulee", annulationId? }
 */
import {
    getDb, preparerRequete, reponse, erreurServeur, lireVerrou, estFigee,
    contrePasserDansTx, dateCorrection, ErreurCompta, FieldValue,
} from '../lib/compta.js';

export const handler = async (event) => {
    const { uid, body, erreur } = await preparerRequete(event);
    if (erreur) return erreur;
    const { ecritureId, motif } = body;
    if (!ecritureId) return reponse(400, { error: 'ecritureId obligatoire' });

    try {
        const db = getDb();
        let resultat;
        await db.runTransaction(async (tx) => {
            const ref = db.collection('ecritures').doc(ecritureId);
            const snap = await tx.get(ref);
            if (!snap.exists) throw new ErreurCompta('Écriture introuvable', 404);
            const ec = snap.data();
            const { dateVerrou } = await lireVerrou(tx);

            if (ec.statut !== 'active' || ec.contrepasseeParId || ec.annuleeParId) {
                resultat = { mode: 'deja_annulee' };
                return;
            }
            if (estFigee(ec, dateVerrou)) {
                const annulationId = contrePasserDansTx(tx, ref, ec, { motif: motif || 'Annulation', uid, date: dateCorrection(dateVerrou) });
                resultat = { mode: 'contrepassation', annulationId };
                return;
            }
            tx.update(ref, {
                statut: 'annulee',
                annuleeLeDate: FieldValue.serverTimestamp(),
                annuleeBy: uid,
                motifAnnulation: motif || null,
            });
            resultat = { mode: 'brouillard' };
        });
        return reponse(200, { ok: true, ...resultat });
    } catch (err) {
        return erreurServeur(err, 'annulerEcriture');
    }
};
