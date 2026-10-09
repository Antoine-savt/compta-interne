/**
 * Netlify Function: validerPeriode
 * ─────────────────────────────────────────────────────────────────────────────
 * Valide (fige) toutes les écritures jusqu'à une date incluse :
 * - numéro d'écriture définitif, continu et chronologique par exercice (AAAA-00001...) ;
 * - date de validation (ValidDate du FEC) ;
 * - la période ne pourra plus recevoir ni modification ni nouvelle écriture.
 * La date de verrouillage ne peut qu'avancer et ne peut pas dépasser aujourd'hui.
 *
 * Route : POST /api/validerPeriode
 * Body : { dateVerrou: "2026-09-30" }
 * Réponse : { ok, dateVerrou, nbValidees, premierNumero, dernierNumero }
 */
import {
    getDb, preparerRequete, reponse, erreurServeur, lireVerrou, aujourdhuiParis,
    isoDepuis, ErreurCompta, FieldValue,
} from '../lib/compta.js';

export const handler = async (event) => {
    const { uid, body, erreur } = await preparerRequete(event);
    if (erreur) return erreur;
    const { dateVerrou } = body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateVerrou ?? ''))) return reponse(400, { error: 'dateVerrou attendue au format AAAA-MM-JJ' });

    try {
        const db = getDb();
        let resultat;
        await db.runTransaction(async (tx) => {
            const verrou = await lireVerrou(tx);
            if (verrou.dateVerrou && dateVerrou <= verrou.dateVerrou) {
                throw new ErreurCompta(`La période est déjà validée jusqu'au ${verrou.dateVerrou.split('-').reverse().join('/')}.`, 409);
            }
            if (dateVerrou > aujourdhuiParis()) throw new ErreurCompta('Impossible de valider une période future.');

            const snap = await tx.get(db.collection('ecritures'));
            const aValider = snap.docs
                .map((d) => ({ ref: d.ref, data: d.data() }))
                .filter(({ data }) => !data.validee && isoDepuis(data.date) <= dateVerrou)
                // Les brouillons annulés (sans contre-passation) ne font pas partie de la comptabilité
                .filter(({ data }) => data.statut === 'active' || data.annuleeParId)
                .sort((a, b) => (
                    isoDepuis(a.data.date).localeCompare(isoDepuis(b.data.date))
                    || (a.data.createdAt?.toMillis?.() ?? 0) - (b.data.createdAt?.toMillis?.() ?? 0)
                ));

            if (aValider.length > 450) throw new ErreurCompta('Trop d\'écritures à valider en une fois : validez une période plus courte.');

            const compteurs = { ...(verrou.compteurs || {}) };
            const numeros = [];
            aValider.forEach(({ ref, data }) => {
                const annee = isoDepuis(data.date).slice(0, 4);
                compteurs[annee] = (compteurs[annee] || 0) + 1;
                const numero = `${annee}-${String(compteurs[annee]).padStart(5, '0')}`;
                numeros.push(numero);
                tx.update(ref, {
                    validee: true,
                    numeroEcriture: numero,
                    validatedAt: FieldValue.serverTimestamp(),
                    validatedBy: uid,
                });
            });

            tx.set(db.collection('settings').doc('verrou'), {
                dateVerrou,
                compteurs,
                historique: FieldValue.arrayUnion({ dateVerrou, nbValidees: aValider.length, uid, at: new Date().toISOString() }),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            resultat = { dateVerrou, nbValidees: aValider.length, premierNumero: numeros[0] ?? null, dernierNumero: numeros[numeros.length - 1] ?? null };
        });
        return reponse(200, { ok: true, ...resultat });
    } catch (err) {
        return erreurServeur(err, 'validerPeriode');
    }
};
