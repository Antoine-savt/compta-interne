/**
 * Helpers partagés : calculs TVA, numérotation factures, récurrences.
 */
import { collection, query, orderBy, limitToLast, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// ─── TVA ─────────────────────────────────────────────────────────────────────

export function calculerMontantsTVA(montantTTC, tauxTVA) {
    const taux = tauxTVA / 100;
    const ht = +(montantTTC / (1 + taux)).toFixed(2);
    const tva = +(montantTTC - ht).toFixed(2);
    return { ht, tva, ttc: montantTTC };
}

export function calculerTTCdepuisHT(montantHT, tauxTVA) {
    const taux = tauxTVA / 100;
    const ttc = +(montantHT * (1 + taux)).toFixed(2);
    const tva = +(ttc - montantHT).toFixed(2);
    return { ht: montantHT, tva, ttc };
}

// ─── Numérotation factures ────────────────────────────────────────────────────

/**
 * Génère le prochain numéro de facture au format AAAA-NNN.
 * Ex : "2026-001", "2026-042".
 * Lit la dernière facture de l'année en cours pour incrémenter.
 */
export async function genererNumeroFacture() {
    const year = new Date().getFullYear();
    const q = query(
        collection(db, 'factures'),
        where('annee', '==', year),
        orderBy('numeroSeq', 'desc'),
        limitToLast(1)
    );
    const snap = await getDocs(q);
    const next = snap.empty ? 1 : (snap.docs[0].data().numeroSeq ?? 0) + 1;
    return { numero: `${year}-${String(next).padStart(3, '0')}`, numeroSeq: next, annee: year };
}

// ─── Récurrence ───────────────────────────────────────────────────────────────

/**
 * Calcule la prochaine échéance à partir d'une date de départ et d'une config de récurrence.
 */
export function prochaineEcheance(dateDepart, intervalleNombre, intervalleUnite) {
    const d = new Date(dateDepart);
    switch (intervalleUnite) {
        case 'jour': d.setDate(d.getDate() + intervalleNombre); break;
        case 'semaine': d.setDate(d.getDate() + intervalleNombre * 7); break;
        case 'mois': d.setMonth(d.getMonth() + intervalleNombre); break;
        case 'annee': d.setFullYear(d.getFullYear() + intervalleNombre); break;
    }
    return d;
}

/**
 * Détermine si un élément récurrent (ligne ou dépense) devrait être en mode
 * "montant fixe" automatiquement ou demander confirmation.
 * Règle : si occurrencesPassees < 3 → variable (false), sinon → fixe (true).
 */
export function doitEtreFixe(occurrencesPassees) {
    return occurrencesPassees >= 3;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

let _settingsCache = null;

export async function getSettings() {
    if (_settingsCache) return _settingsCache;
    const snap = await getDoc(doc(db, 'settings', 'config'));
    _settingsCache = snap.exists() ? snap.data() : { statutTVA: 'franchise', tauxTVADefaut: 20 };
    return _settingsCache;
}

export function invalidateSettingsCache() {
    _settingsCache = null;
}

// ─── Formatage ────────────────────────────────────────────────────────────────

export function formatMontant(n) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n ?? 0);
}

export function formatDate(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return new Intl.DateTimeFormat('fr-FR').format(d);
}
