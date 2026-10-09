/**
 * Netlify Function: modifierEcriture
 * ─────────────────────────────────────────────────────────────────────────────
 * Modifie une écriture en respectant l'inaltérabilité :
 * - écriture en brouillard (non validée, période ouverte) : mise à jour directe ;
 * - écriture figée (validée ou dans une période validée) : contre-passation de
 *   l'originale + nouvelle écriture corrigée, toutes deux datées dans la période
 *   ouverte si la date demandée tombe dans la période validée.
 * Si le contenu comptable est identique, rien n'est réécrit.
 *
 * Route : POST /api/modifierEcriture
 * Body : { ecritureId, ecriture: { journal, date, libelle, mouvements, pieceRef?, sourceType?, sourceId? }, motif? }
 * Réponse : { ok, ecritureId, remplacee, annulationId?, date }
 */
import {
    getDb, preparerRequete, reponse, erreurServeur, controlerEcriture, lireVerrou,
    estFigee, controlerPeriodeOuverte, contrePasserDansTx, dateCorrection, nouvelleEcriture,
    memeContenu, isoDepuis, ErreurCompta, FieldValue,
} from '../lib/compta.js';

export const handler = async (event) => {
    const { uid, body, erreur } = await preparerRequete(event);
    if (erreur) return erreur;
    const { ecritureId, motif } = body;
    if (!ecritureId || !body.ecriture) return reponse(400, { error: 'ecritureId et ecriture sont obligatoires' });

    try {
        const db = getDb();
        let resultat;
        await db.runTransaction(async (tx) => {
            const origRef = db.collection('ecritures').doc(ecritureId);
            const snap = await tx.get(origRef);
            if (!snap.exists) throw new ErreurCompta('Écriture introuvable', 404);
            const orig = snap.data();
            if (orig.contrepasseeParId || orig.annuleeParId || orig.sourceType === 'contrepassation') {
                throw new ErreurCompta('Cette écriture a déjà été contre-passée et ne peut plus être modifiée.', 409);
            }
            const { dateVerrou } = await lireVerrou(tx);

            const saisie = {
                journal: body.ecriture.journal || orig.journal,
                date: body.ecriture.date,
                libelle: body.ecriture.libelle,
                pieceRef: body.ecriture.pieceRef ?? orig.pieceRef ?? null,
                sourceType: body.ecriture.sourceType ?? orig.sourceType,
                sourceId: body.ecriture.sourceId !== undefined ? body.ecriture.sourceId : (orig.sourceId ?? null),
            };
            const mouvements = controlerEcriture({ ...saisie, mouvements: body.ecriture.mouvements });

            // Rien de comptable ne change : seules les métadonnées de rattachement sont mises à jour
            if (orig.statut === 'active' && memeContenu(orig, saisie, mouvements)) {
                tx.update(origRef, { sourceType: saisie.sourceType, sourceId: saisie.sourceId, updatedAt: FieldValue.serverTimestamp() });
                resultat = { ecritureId, remplacee: false, date: saisie.date };
                return;
            }

            if (!estFigee(orig, dateVerrou)) {
                // Brouillard : correction directe, sans jamais entrer dans la période validée
                controlerPeriodeOuverte(saisie.date, dateVerrou);
                tx.update(origRef, {
                    ...saisie,
                    date: new Date(saisie.date),
                    mouvements,
                    statut: 'active',
                    updatedAt: FieldValue.serverTimestamp(),
                    modifiedBy: uid,
                });
                resultat = { ecritureId, remplacee: false, date: saisie.date };
                return;
            }

            // Écriture figée : contre-passation + nouvelle écriture dans la période ouverte
            const dateCorr = dateCorrection(dateVerrou);
            const dateNouvelle = dateVerrou && saisie.date <= dateVerrou ? dateCorr : saisie.date;
            const motifTexte = motif || `Correction de l'écriture du ${isoDepuis(orig.date).split('-').reverse().join('/')}`;
            const annulationId = orig.statut === 'active'
                ? contrePasserDansTx(tx, origRef, orig, { motif: motifTexte, uid, date: dateCorr })
                : null;
            const nouvelleRef = db.collection('ecritures').doc();
            tx.set(nouvelleRef, nouvelleEcriture({ ...saisie, date: dateNouvelle, mouvements }, uid, { remplaceId: ecritureId }));
            resultat = { ecritureId: nouvelleRef.id, remplacee: true, annulationId, date: dateNouvelle };
        });
        return reponse(200, { ok: true, ...resultat });
    } catch (err) {
        return erreurServeur(err, 'modifierEcriture');
    }
};
