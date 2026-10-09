/**
 * Logique serveur partagée par les Netlify Functions comptables.
 * ─────────────────────────────────────────────────────────────────────────────
 * Règles d'inaltérabilité (C. com. art. L123-22, PCG art. 911-1, A47 A-1 LPF) :
 * - une période validée (settings/verrou.dateVerrou) est figée : aucune écriture
 *   ne peut y être créée, modifiée ou supprimée ;
 * - une écriture validée se corrige uniquement par contre-passation, la correction
 *   étant datée dans la période ouverte ;
 * - la validation attribue un numéro d'écriture définitif, continu et chronologique.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export { FieldValue };

export function getAdminApp() {
    if (getApps().length > 0) return getApps()[0];
    const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    return initializeApp({ credential: cert(serviceAccount) });
}

export function getDb() {
    return getFirestore(getAdminApp());
}

export function reponse(statusCode, body) {
    return { statusCode, body: JSON.stringify(body) };
}

/** Vérifie la méthode, le token Firebase et lit le body JSON. Retourne { uid, body } ou { erreur }. */
export async function preparerRequete(event) {
    if (event.httpMethod !== 'POST') return { erreur: reponse(405, { error: 'Method not allowed' }) };
    const idToken = (event.headers['authorization'] ?? '').replace('Bearer ', '').trim();
    if (!idToken) return { erreur: reponse(401, { error: 'Token manquant' }) };
    let uid;
    try {
        const { getAuth } = await import('firebase-admin/auth');
        uid = (await getAuth(getAdminApp()).verifyIdToken(idToken)).uid;
    } catch {
        return { erreur: reponse(401, { error: 'Token invalide' }) };
    }
    try {
        return { uid, body: JSON.parse(event.body ?? '{}') };
    } catch {
        return { erreur: reponse(400, { error: 'Body JSON invalide' }) };
    }
}

export function erreurServeur(err, contexte) {
    console.error(`[${contexte}]`, err);
    let error = err.message || 'Erreur serveur.';
    if (err.code === 5 || err.message?.includes('NOT_FOUND')) {
        error = 'La base de données Firestore n\'est pas encore initialisée (console Firebase > Firestore > Créer une base de données).';
    }
    return reponse(err.statusCode || 500, { ok: false, error });
}

/** Erreur métier renvoyée telle quelle au client. */
export class ErreurCompta extends Error {
    constructor(message, statusCode = 422) {
        super(message);
        this.statusCode = statusCode;
    }
}

// ─── Contrôles ──────────────────────────────────────────────────────────────

export function verifierEquilibre(mouvements) {
    const totalDebit = mouvements.reduce((acc, m) => acc + (Number(m.debit) || 0), 0);
    const totalCredit = mouvements.reduce((acc, m) => acc + (Number(m.credit) || 0), 0);
    const ok = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
    return { ok, totalDebit, totalCredit };
}

/** Normalise et contrôle une écriture saisie. Lève ErreurCompta si invalide. */
export function controlerEcriture({ journal, date, libelle, mouvements }) {
    if (!journal || !date || !libelle || !Array.isArray(mouvements) || mouvements.length < 2) {
        throw new ErreurCompta('Champs obligatoires manquants (journal, date, libellé, au moins 2 lignes).', 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || isNaN(new Date(date).getTime())) {
        throw new ErreurCompta(`Date invalide : ${date} (format attendu AAAA-MM-JJ).`, 400);
    }
    const lignes = mouvements.map((m) => ({
        compte: String(m.compte ?? '').trim(),
        libelle: String(m.libelle ?? '').trim(),
        debit: +(Number(m.debit) || 0).toFixed(2),
        credit: +(Number(m.credit) || 0).toFixed(2),
    }));
    const invalide = lignes.find((m) => !/^[1-7]\d{2,7}$/.test(m.compte) || m.debit < 0 || m.credit < 0 || (m.debit > 0 && m.credit > 0));
    if (invalide) {
        throw new ErreurCompta(`Ligne d'écriture invalide (compte ${invalide.compte || 'manquant'}) : compte du plan comptable à 3 chiffres minimum, montants positifs, débit OU crédit.`);
    }
    const { ok, totalDebit, totalCredit } = verifierEquilibre(lignes);
    if (!ok) {
        throw new ErreurCompta(`Écriture déséquilibrée : débit ${totalDebit.toFixed(2)} €, crédit ${totalCredit.toFixed(2)} €. Aucune écriture n'a été enregistrée.`);
    }
    return lignes.filter((m) => m.debit > 0 || m.credit > 0);
}

// ─── Dates et période validée ───────────────────────────────────────────────

/** Date du jour à Paris au format AAAA-MM-JJ. */
export function aujourdhuiParis() {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

/** Date AAAA-MM-JJ d'un champ date Firestore (Timestamp ou Date), lue à l'heure de Paris. */
export function isoDepuis(date) {
    const d = date?.toDate ? date.toDate() : new Date(date);
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
}

export function lendemain(iso) {
    return new Date(Date.parse(iso) + 86400000).toISOString().slice(0, 10);
}

/** Lit settings/verrou, dans la transaction `tx` si elle est fournie. */
export async function lireVerrou(tx) {
    const ref = getDb().collection('settings').doc('verrou');
    const snap = tx ? await tx.get(ref) : await ref.get();
    return snap.exists ? { compteurs: {}, ...snap.data() } : { dateVerrou: null, compteurs: {} };
}

/** Une écriture est figée si elle est validée ou datée dans la période validée. */
export function estFigee(ecriture, dateVerrou) {
    return !!ecriture.validee || (!!dateVerrou && isoDepuis(ecriture.date) <= dateVerrou);
}

/** Refuse une date tombant dans la période validée. */
export function controlerPeriodeOuverte(date, dateVerrou) {
    if (dateVerrou && date <= dateVerrou) {
        throw new ErreurCompta(`La période jusqu'au ${date.split('-').reverse().join('/')} est validée et ne peut plus recevoir d'écriture. Datez l'opération après le ${dateVerrou.split('-').reverse().join('/')}.`, 409);
    }
}

/** Première date à laquelle une correction peut être passée (période ouverte). */
export function dateCorrection(dateVerrou) {
    const auj = aujourdhuiParis();
    return dateVerrou && auj <= dateVerrou ? lendemain(dateVerrou) : auj;
}

// ─── Écritures ──────────────────────────────────────────────────────────────

export function nouvelleEcriture({ journal, date, libelle, mouvements, sourceType, sourceId, pieceRef }, uid, extra = {}) {
    return {
        journal,
        date: new Date(date),
        libelle,
        mouvements,
        sourceType: sourceType ?? 'manuel',
        sourceId: sourceId ?? null,
        pieceRef: pieceRef ?? null,
        statut: 'active',
        validee: false,
        saisieMode: sourceType === 'manuel' ? 'manuel' : 'formulaire',
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        ...extra,
    };
}

/**
 * Contre-passe `orig` dans la transaction `tx` : crée l'écriture inverse (active) et lie l'originale,
 * qui reste comptabilisée. Retourne l'id de l'écriture inverse.
 */
export function contrePasserDansTx(tx, origRef, orig, { motif, uid, date }) {
    if (orig.contrepasseeParId || orig.annuleeParId) throw new ErreurCompta('Cette écriture est déjà contre-passée.', 409);
    if (orig.sourceType === 'contrepassation') throw new ErreurCompta('Une contre-passation ne peut pas être elle-même contre-passée.', 409);
    const inverseRef = getDb().collection('ecritures').doc();
    tx.set(inverseRef, nouvelleEcriture({
        journal: orig.journal,
        date,
        libelle: `CONTRE-PASSATION — ${orig.libelle} — ${motif}`,
        mouvements: (orig.mouvements ?? []).map((m) => ({ compte: m.compte, libelle: m.libelle, debit: m.credit ?? 0, credit: m.debit ?? 0 })),
        sourceType: 'contrepassation',
        sourceId: origRef.id,
        pieceRef: orig.pieceRef ?? null,
    }, uid));
    tx.update(origRef, {
        contrepasseeParId: inverseRef.id,
        annuleeLeDate: FieldValue.serverTimestamp(),
        motifContrepassation: motif,
    });
    return inverseRef.id;
}

/** Deux écritures portent-elles la même information comptable ? */
export function memeContenu(orig, saisie, mouvementsControles) {
    const norm = (ms) => JSON.stringify((ms ?? []).map((m) => [String(m.compte).trim(), String(m.libelle ?? '').trim(), +(+m.debit || 0).toFixed(2), +(+m.credit || 0).toFixed(2)]));
    return isoDepuis(orig.date) === saisie.date
        && (orig.libelle ?? '') === saisie.libelle
        && (orig.journal ?? '') === saisie.journal
        && (orig.pieceRef ?? null) === (saisie.pieceRef ?? orig.pieceRef ?? null)
        && norm(orig.mouvements) === norm(mouvementsControles);
}
